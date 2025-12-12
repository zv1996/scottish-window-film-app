// src/tools/submitIntake.ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { recommendFilms } from "./recommendFilms.js";
import { estimatePrice } from "./estimatePrice.js";

/**
 * Normalize free-text application into our enum buckets used by scoring.
 * - Strips numbers/punctuation
 * - Splits on commas/and
 * - Matches by priority (living_room > bedroom > kitchen > ... > other)
 * - Maps "loft" -> bedroom
 */
function normalizeApplicationText(input?: string | null): string | undefined {
  if (!input) return undefined;

  const PRIORITY: Array<[string, string]> = [
    ["living room", "living_room"],
    ["family room", "living_room"],
    ["living", "living_room"],
    ["bedroom", "bedroom"],
    ["loft", "bedroom"],              // treat loft like a bedroom
    ["kitchen", "kitchen"],
    ["bathroom", "bathroom"],
    ["office", "office"],
    ["conference room", "conference_room"],
    ["conference", "conference_room"],
    ["storefront", "storefront"],
    ["lobby", "lobby"],
    ["server room", "server_room"],
    ["server", "server_room"],
    ["warehouse", "warehouse"],
    ["other", "other"],
  ];

  // normalize: lowercase, strip digits/punct except spaces
  const cleaned = input
    .toLowerCase()
    .replace(/[0-9]+/g, " ")
    .replace(/[^\p{L}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  // split on common conjunctions to catch multi-area strings
  const parts = cleaned.split(/\b(?:and|&|,)\b/).map(s => s.trim()).filter(Boolean);

  // search by priority across all parts
  for (const [needle, mapped] of PRIORITY) {
    for (const p of parts) {
      if (p.includes(needle)) return mapped;
    }
  }

  // final pass: if the whole string contains a needle
  for (const [needle, mapped] of PRIORITY) {
    if (cleaned.includes(needle)) return mapped;
  }

  return "other";
}

// helper: normalize estimatePrice tool response
function unwrapEstimate(r: any) {
  const sc = r?.structuredContent ?? {};
  return {
    quotes: Array.isArray(sc.quotes) ? sc.quotes : [],
    range_text: typeof sc.price_range === "string" ? sc.price_range : undefined,
  };
}

/**
 * Register the submit_intake_panel tool.
 * NOTE:
 *  - We pass a Zod *shape* (not a prebuilt z.object) so the server wrapper can build its own schema.
 *  - We inline descriptor/handler so there is no stray `descriptor`/`exports` reference in ESM.
 */
export function registerSubmitIntake(server: McpServer) {
  const inputSchema = {
    property_type: z.enum(["residential", "commercial"]).optional(),
    goals: z
      .array(z.enum(["heat", "glare", "privacy", "uv", "security", "decorative"]))
      .optional(),
    // free text from UI:
    application_text: z.string().optional(),
    // legacy enum (if present we prefer this; otherwise bucketize application_text):
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
    // allow single value or array for multi‑orientation UI
    orientation: z
      .union([
        z.enum(["north", "east", "south", "west"]),
        z.array(z.enum(["north", "east", "south", "west"])),
      ])
      .optional(),
    square_feet: z.number().int().positive().optional(),
    city: z.string().optional(),
  };

  const descriptor = {
    name: "submit_intake_panel",
    description:
      "Takes intake answers and returns a results panel with film recommendations and an installed price range.",
    inputSchema,
  };

  const handler = async (args: any) => {
    // Normalize orientation to an array for multi-orientation scoring
    const rawOri = args.orientation;
    const orientation: ("north" | "east" | "south" | "west")[] =
      Array.isArray(rawOri)
        ? rawOri
        : (typeof rawOri === "string" && rawOri ? [rawOri] : []);

    const applicationEnum =
      args.application ?? normalizeApplicationText(args.application_text) ?? "other";

    const application_note = typeof args.application_text === "string" ? args.application_text : undefined;

    // Build args for recommend + estimate
    const recArgs = {
      property_type: args.property_type ?? "residential",
      goals: Array.isArray(args.goals) ? args.goals : [],
      application: applicationEnum,
      vlt_preference: args.vlt_preference ?? "neutral",
      budget_level: args.budget_level ?? "mid",
      install_location: args.install_location ?? "interior",
      sun_exposure: args.sun_exposure ?? "medium",
      orientation,
    };

    const sq = typeof args.square_feet === "number"
      ? args.square_feet
      : Number(String(args.square_feet ?? "").replace(/[^\d.]/g, "")) || undefined;

    const estArgs = {
      square_feet: sq,
      property_type: recArgs.property_type,
    };

    // Run recommend + estimate with broadening if starved
    let rec: any = await recommendFilms.handler(recArgs as any);

    // Helpers to work with the recommendFilms tool response shape
    const getRecs = (r: any) => r?.structuredContent?.recommendations ?? [];
    const countRecs = (r: any) => (Array.isArray(getRecs(r)) ? getRecs(r).length : 0);
    const haveFew = (r: any) => countRecs(r) < 3;

    if (haveFew(rec)) {
      // 1) relax VLT preference
      const r1 = await recommendFilms.handler({ ...recArgs, vlt_preference: undefined } as any);
      rec = haveFew(rec) || countRecs(r1) > countRecs(rec) ? r1 : rec;
    }
    if (haveFew(rec)) {
      // 2) relax install location
      const r2 = await recommendFilms.handler({ ...recArgs, vlt_preference: undefined, install_location: undefined } as any);
      rec = haveFew(rec) || countRecs(r2) > countRecs(rec) ? r2 : rec;
    }
    if (haveFew(rec)) {
      // 3) drop application specificity
      const r3 = await recommendFilms.handler({ ...recArgs, vlt_preference: undefined, install_location: undefined, application: "other" } as any);
      rec = haveFew(rec) || countRecs(r3) > countRecs(rec) ? r3 : rec;
    }

    // Price estimate (only when square footage provided)
    const estResp: any = typeof estArgs.square_feet === "number"
      ? await estimatePrice.handler(estArgs as any)
      : undefined;

    const { quotes, range_text } = unwrapEstimate(estResp);

    const top = getRecs(rec).slice(0, 5);

    // Map items with robust field fallbacks to tolerate catalog variants
    const items = top.map((t: any) => {
      const brand = t.brand ?? t.manufacturer ?? "";
      const line  = t.line ?? t.series ?? t.collection ?? "";
      const name  = t.name ?? t.product_name ?? t.model ?? "";
      const category = t.category ?? "solar_control";
      const tier = t.tier ?? t.price_tier ?? "mid";
      const exteriorCap = (t.exterior_capable ?? t.exterior_ok) ? "exterior-capable" : "interior-only";
      return {
        kind: "item",
        title: `${brand} • ${line} • ${name}`.replace(/\s+•\s+$/, "").replace(/^•\s+/, ""),
        subtitle: `${category} • ${tier} tier • ${exteriorCap}`,
      };
    });

    const priceRange =
      range_text
        ? range_text
        : (quotes.length
            ? `$${Math.round(quotes[0].subtotal_low).toLocaleString()} – $${Math.round(
                quotes[quotes.length - 1].subtotal_high
              ).toLocaleString()}`
            : "—");

    const filmCards = top.map((t: any) => {
      const brand = t.brand ?? t.manufacturer ?? "";
      const line  = t.line ?? t.series ?? t.collection ?? "";
      const name  = t.name ?? t.product_name ?? t.model ?? "";
      const category = t.category ?? "solar_control";
      const tier = t.tier ?? t.price_tier ?? "mid";
      const exteriorCap = (t.exterior_capable ?? t.exterior_ok) ? "exterior-capable" : "interior-only";
      return {
        brand,
        line,
        name,
        category,
        tier,
        exteriorCap,
        priceRange,
      };
    });

    // Chip summary for results description
    const chips = [
      ...(recArgs.goals ?? []),
      recArgs.property_type,
      recArgs.application,
      `${recArgs.vlt_preference} look`,
      `${recArgs.budget_level} budget`,
      `${recArgs.install_location} install`,
      `${recArgs.sun_exposure} sun`,
      orientation.length ? `${orientation.join("/")} facing` : undefined,
      typeof estArgs.square_feet === "number" ? `${estArgs.square_feet} sq ft` : undefined,
      args.city,
    ].filter(Boolean);

    const resultsPanel = {
      kind: "panel",
      id: "swt_results_panel_v1",
      title: "Recommended Window Films",
      description: chips.join("  •  "),
      sections: [
        {
          kind: "group",
          title: items.length ? "Top Matches" : "No matches yet",
          fields: items.length
            ? [
                {
                  id: "recommendations_list",
                  kind: "list",
                  label: "",
                  items,
                },
              ]
            : [
                {
                  id: "empty_state",
                  kind: "text",
                  label: "",
                  value:
                    "We couldn't generate recommendations. Try adding goals, application, VLT preference, budget, install location, and sun exposure.",
                },
              ],
        },
        {
          kind: "group",
          title: "Estimated Installed Cost",
          fields: [
            { id: "price_range", kind: "text", label: "Ballpark range", value: priceRange },
            { id: "quotes_json", kind: "json", label: "Quote details", value: quotes },
          ],
        },
      ],
      actions: [
        { id: "refine_answers", kind: "secondary", label: "Adjust answers" },
        { id: "start_over", kind: "secondary", label: "Start over" },
      ],
    };

    return {
      content: [{ type: "text", text: `Film picks for ${recArgs.property_type}` }],
      // Expose the panel at the top level so the widget can read window.openai.toolOutput.resultsPanel
      resultsPanel,
      structuredContent: {
        resultsPanel,
        summary: items.length
          ? `Film picks for ${recArgs.property_type}${
              typeof estArgs.square_feet === "number" ? `\n${estArgs.square_feet} sq ft` : ""
            }\n${items.map((i: any) => `• ${i.title}`).join("\n")}${
              priceRange && priceRange !== "—" ? `\nEstimated installed cost: ${priceRange}` : ""
            }`
          : `No matches yet`,
        recArgs,
        estArgs,
        application_note,
        recommendations: getRecs(rec),
        quotes,
        filmCards,
      },
      _meta: {
        openai: {
          outputTemplate: {
            resource: {
              type: "url",
              url: "https://scottishwindowtinting.com/ui/results-carousel.html",
            },
            data: {
              resultsPanel,
            },
          },
        },
      },
    };
  };

  // ESM‑safe registration (no implicit CommonJS 'exports' usage)
  server.registerTool("submit_intake_panel", descriptor as any, handler as any);
}