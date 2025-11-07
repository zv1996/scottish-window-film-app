// src/tools/submitIntake.ts
// Aggregates the intake values, calls recommendation & pricing tools when possible,
// and returns a Results Panel JSON plus a brief text summary. No SKU coupling.

import { z } from "zod";
import { buildResultsPanel, buildTextSummary } from "../ui/resultsPanel.js";
import { intakeToRecommendArgs, intakeToEstimateArgs, type IntakeValues, type Goal } from "../ui/intakePanel.js";

// --- Helpers to enrich & de‑dupe recommendations before building the panel ---
function extractRecommendations(payload: any): any[] {
  if (!payload) return [];
  // Try common shapes
  const sc = (payload as any)?.structuredContent ?? payload;
  const candidates =
    sc?.recommendations ?? sc?.data?.recommendations ?? sc?.result?.recommendations ?? sc?.items ?? [];
  return Array.isArray(candidates) ? candidates : [];
}

function toDisplayTitle(r: any): string {
  const parts = [r?.brand, r?.series, r?.product_name ?? r?.name ?? r?.sku]
    .filter(Boolean)
    .map((s) => String(s).trim());
  // de-dupe adjacent equal parts
  const compact: string[] = [];
  for (const p of parts) if (!compact.length || compact[compact.length - 1] !== p) compact.push(p);
  return compact.join(" — ");
}

function toSubtitle(r: any): string | undefined {
  const tags: string[] = [];
  const use = Array.isArray(r?.use_cases) ? r.use_cases : [];
  if (use.length) tags.push(use.join(", "));
  const loc = Array.isArray(r?.install_location) ? r.install_location.join("/") : r?.install_location;
  if (loc) tags.push(String(loc));
  if (r?.price_tier) tags.push(String(r.price_tier));
  if (!tags.length) return undefined;
  return tags.join(" • ");
}

function stableKey(r: any): string {
  return (
    r?.sku ||
    [r?.brand, r?.series, r?.product_name ?? r?.name].filter(Boolean).join("|") ||
    JSON.stringify(r)
  );
}

function enrichAndDedupe(recs: any[]): any[] {
  const seen = new Set<string>();
  const out: any[] = [];
  for (const r of recs) {
    const key = stableKey(r);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      ...r,
      title: toDisplayTitle(r),
      subtitle: toSubtitle(r),
      href: r?.product_url ?? r?.brand_page_url ?? undefined,
    });
  }
  // keep it tidy and stable
  return out.slice(0, 5);
}

// Descriptor-style export (matches the pattern used by other tools)
export const submitIntake = {
  name: "submit_intake_panel",
  description:
    "Takes the intake panel values, generates film recommendations, and optionally a price estimate if square footage is provided.",
  // IMPORTANT: provide a raw Zod SHAPE, not an instantiated z.object,
  // because the MCP SDK wraps this internally.
  inputSchema: {
    // flat fields (accepted directly)
    property_type: z.enum(["residential", "commercial"]).optional(),
    goals: z
      .array(
        z.enum(["heat", "glare", "privacy", "uv", "security", "decorative"]) 
      )
      .optional(),
    application: z
      .enum([
        "living_room",
        "bedroom",
        "kitchen",
        "bathroom",
        "office",
        "conference_room",
        "storefront",
        "lobby",
        "server_room",
        "warehouse",
        "other",
      ])
      .optional(),
    vlt_preference: z.enum(["brighter", "neutral", "darker"]).optional(),
    budget_level: z.enum(["value", "mid", "premium"]).optional(),
    install_location: z.enum(["interior", "exterior"]).optional(),
    sun_exposure: z.enum(["low", "medium", "high"]).optional(),
    orientation: z.enum(["north", "east", "south", "west"]).optional(),
    square_feet: z.number().int().positive().optional(),
    city: z.string().optional(),

    // nested form (also accepted)
    values: z.any().optional(),
  } as any,

  // Handler: attempt to call local tool handlers if available; otherwise return normalized args
  handler: async (args: any) => {
    // Accept both shapes: flat and { values: {...} }
    const flat: Partial<IntakeValues> = {
      property_type: args?.property_type,
      goals: args?.goals,
      application: args?.application,
      vlt_preference: args?.vlt_preference,
      budget_level: args?.budget_level,
      install_location: args?.install_location,
      sun_exposure: args?.sun_exposure,
      orientation: args?.orientation,
      square_feet: typeof args?.square_feet === "string" ? Number(args.square_feet) : args?.square_feet,
      city: args?.city,
    };

    const mergedRaw: Partial<IntakeValues> = {
      ...(args?.values ?? {}),
      ...flat,
    };

    // Normalize/clean
    const normalizedGoals: Goal[] | undefined =
      Array.isArray(mergedRaw.goals) && mergedRaw.goals.length
        ? (mergedRaw.goals as unknown as Goal[])
        : undefined;

    const normalizedValues: Partial<IntakeValues> = {
      ...mergedRaw,
      goals: normalizedGoals,
    };

    // Build arguments for each underlying tool
    const recArgs = intakeToRecommendArgs(normalizedValues);
    const estArgs = intakeToEstimateArgs(normalizedValues);

    // Try to call local tool handlers if they are exported in-process
    let recommendResult: any = null;
    let estimateResult: any = null;
    let selectedTitles: string[] = [];

    try {
      // Dynamic import to avoid circular import issues
      const recMod = await import("./recommendFilms.js");
      const recHandler =
        (recMod as any)?.recommendFilms?.handler ||
        (recMod as any)?.handler ||
        (recMod as any)?.default?.handler;
      if (typeof recHandler === "function") {
        recommendResult = await recHandler(recArgs);
      }
    
      // Enrich & de‑dupe recs so the panel shows full product names instead of brand‑only
      try {
        const recs = extractRecommendations(recommendResult);
        if (recs.length) {
          const better = enrichAndDedupe(recs);
          selectedTitles = better.map((r: any) => r?.title).filter(Boolean).slice(0, 5) as string[];
          // preserve original envelope but replace the recommendations array
          if (recommendResult?.structuredContent) {
            recommendResult = {
              ...recommendResult,
              structuredContent: {
                ...recommendResult.structuredContent,
                recommendations: better,
              },
            };
          } else {
            recommendResult = {
              ...(recommendResult ?? {}),
              recommendations: better,
            } as any;
          }
        }
      } catch {
        // non‑fatal; fall back to whatever the tool returned
      }
    } catch (_e) {
      // Swallow; we'll fall back to returning the normalized args
    }

    try {
      if (estArgs && typeof (estArgs as any).square_feet === "number") {
        const estMod = await import("./estimatePrice.js");
        const estHandler =
          (estMod as any)?.estimatePrice?.handler ||
          (estMod as any)?.handler ||
          (estMod as any)?.default?.handler;
        if (typeof estHandler === "function") {
          // Pricing no longer depends on SKUs; pass normalized args only
          estimateResult = await estHandler(estArgs as any);
        }
      }
    } catch (_e) {
      // Optional; pricing is not mandatory
    }

    // If we managed to compute either, build a results panel
    if (recommendResult || estimateResult) {
      const panel = buildResultsPanel(
        // many tool handlers return { structuredContent: {...} } as the canonical JSON — prefer that
        (recommendResult?.structuredContent ?? recommendResult) as any,
        (estimateResult?.structuredContent ?? estimateResult) as any,
        normalizedValues as any
      );
      const summary = buildTextSummary(
        (recommendResult?.structuredContent ?? recommendResult) as any,
        (estimateResult?.structuredContent ?? estimateResult) as any,
        normalizedValues as any
      );
      return {
        content: [{ type: "text", text: summary }],
        structuredContent: { resultsPanel: panel, summary, recArgs, estArgs, selectedTitles },
      };
    }

    // Fallback: return normalized args so the client can call the underlying tools explicitly
    return {
      content: [
        {
          type: "text",
          text:
            "I prepared your answers. I can call the recommendation and pricing tools next, or you can review/edit first.",
        },
      ],
      structuredContent: {
        prepared: true,
        recArgs,
        estArgs,
        note:
          "Underlying handlers were not available in-process; the client can call `recommend_films` and `estimate_price` using these args.",
        selectedTitles: [],
      },
    };
  },
};

// Helper to register with the server in src/server.ts
export function registerSubmitIntake(server: any) {
  server.registerTool(
    "submit_intake_panel",
    {
      name: submitIntake.name,
      description: submitIntake.description,
      inputSchema: submitIntake.inputSchema,
    } as any,
    submitIntake.handler
  );
}