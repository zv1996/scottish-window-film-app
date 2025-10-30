// src/tools/submitIntake.ts
// Aggregates the intake values, calls recommendation & pricing tools when possible,
// and returns a Results Panel JSON plus a brief text summary.

import { z } from "zod";
import { buildResultsPanel, buildTextSummary } from "../ui/resultsPanel.js";
import { intakeToRecommendArgs, intakeToEstimateArgs, type IntakeValues, type Goal } from "../ui/intakePanel.js";

// Descriptor-style export (matches the pattern used by other tools)
export const submitIntake = {
  name: "submit_intake_panel",
  description:
    "Takes the intake panel values, generates film recommendations, and optionally a price estimate if square footage is provided.",
  // IMPORTANT: provide a raw Zod SHAPE, not an instantiated z.object,
  // because the MCP SDK wraps this internally.
  inputSchema: {
    values: z.any().optional(),
  } as any,

  // Handler: attempt to call local tool handlers if available; otherwise return normalized args
  // so the client can call the underlying tools.
  handler: async (args: any) => {
    const values: Partial<IntakeValues> =
      (args && (args.values as Partial<IntakeValues>)) || (args as Partial<IntakeValues>) || {};

    // Normalize goals to the stricter Goal[] type expected by helper functions
    const normalizedGoals: Goal[] | undefined = Array.isArray(values.goals)
      ? (values.goals as unknown as Goal[])
      : undefined;
    const normalizedValues: Partial<IntakeValues> = { ...values, goals: normalizedGoals };

    // Build arguments for each underlying tool
    const recArgs = intakeToRecommendArgs(normalizedValues);
    const estArgs = intakeToEstimateArgs(normalizedValues);

    // Try to call local tool handlers if they are exported in-process
    let recommendResult: any = null;
    let estimateResult: any = null;

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
          estimateResult = await estHandler(estArgs);
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
        structuredContent: { resultsPanel: panel, summary, recArgs, estArgs },
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