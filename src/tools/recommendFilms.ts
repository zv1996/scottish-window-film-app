import { z } from "zod";
import filmsData from "../data/films.json" with { type: "json" };
import { scoreFilms } from "../lib/scoring.js";

// Normalize films data into an array
const films = Array.isArray(filmsData)
  ? (filmsData as any[])
  : ((filmsData as any).films ?? []);

// Zod validators for the tool's input.
// Required: property_type, goals
// Optional: extra context that improves recommendation quality
const recommendFilmsInputSchema = {
  property_type: z
    .enum(["residential", "commercial"], {
      description:
        "Type of property. Affects which films are allowed and how we weight privacy vs heat rejection.",
    }),
  goals: z
    .array(
      z.enum(
        [
          "heat",
          "glare",
          "uv",
          "privacy",
          "security",
          "decorative",
        ],
        {
          description:
            "Primary goals for the film. 'heat' = heat rejection, 'glare' = reduce glare, 'uv' = fade protection, 'privacy' = daytime privacy, 'security' = shatter resistance, 'decorative' = frosted/branding/etc.",
        }
      )
    )
    .min(1, "Provide at least one goal like 'heat' or 'privacy'."),
  city: z
    .string({
      description:
        "Optional: city or region. Used only for climate/context in messaging.",
    })
    .optional(),
  sun_exposure: z
    .enum(["low", "medium", "high"], {
      description:
        "Optional: how intense the sun load is on these windows.",
    })
    .optional(),
  application: z
    .enum(
      [
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
      ],
      {
        description:
          "Where the film is going. Helps weight privacy vs aesthetic vs heat.",
      }
    )
    .optional(),
  vlt_preference: z
    .enum(["brighter", "neutral", "darker"], {
      description:
        "Brightness preference from inside. 'brighter' = high VLT, 'darker' = tinted look / more privacy.",
    })
    .optional(),
  budget_level: z
    .enum(["value", "mid", "premium"], {
      description:
        "Rough budget tier. 'value' = cost-sensitive, 'premium' = flagship/lowest reflectivity/best performance.",
    })
    .optional(),
  install_location: z
    .enum(["interior", "exterior"], {
      description:
        "Mounting location. Some films are exterior-rated for commercial curtain wall.",
    })
    .optional(),
  orientation: z
    .enum(["north", "east", "south", "west"], {
      description:
        "Window orientation if known; helps approximate sun exposure.",
    })
    .optional(),
};

export const recommendFilms = {
  name: "recommend_films",
  descriptor: {
    title: "Recommend Window Films",
    description:
      "Returns the top 3 film recommendations for this scenario. If critical context is missing (like brightness preference or application), asks clarifying questions instead of guessing.",
    // MCP runtime will wrap this object with z.object() and use it
    // for validation + tool schema exposure. Each property here must
    // be a Zod validator, not a plain string.
    inputSchema: recommendFilmsInputSchema,
  },
  handler: async (input: any) => {
    // input has already been validated against recommendFilmsInputSchema
    const {
      property_type,
      goals,
      application,
      vlt_preference,
      budget_level,
      install_location,
      sun_exposure,
      orientation,
    }: {
      property_type: "residential" | "commercial";
      goals: string[];
      application?: string;
      vlt_preference?: string;
      budget_level?: string;
      install_location?: string;
      sun_exposure?: string;
      orientation?: string;
    } = input;

    // ask for missing key fields that help narrow recs so we don't hallucinate
    const missing: string[] = [];
    if (!application) missing.push("application (e.g. living_room, office)");
    if (!vlt_preference) missing.push("brightness preference (brighter/neutral/darker)");
    if (!budget_level) missing.push("budget (value/mid/premium)");
    if (!install_location) missing.push("install location (interior/exterior)");
    if (!sun_exposure && !orientation)
      missing.push("sun exposure (low/medium/high) or orientation (north/east/south/west)");

    if (missing.length) {
      return {
        content: [
          {
            type: "text",
            text: `To dial this in, tell me: ${missing.join(", ")}.`,
          },
        ],
        structuredContent: { recommendations: [] },
      };
    }

    // scoreFilms ranks our films for their goals + property context
    const recs = scoreFilms(films as any[], {
      property_type,
      goals,
    });

    return {
      content: [
        {
          type: "text",
          text: `Top picks for ${property_type} based on ${goals.join(", ")}.`,
        },
      ],
      structuredContent: {
        recommendations: recs,
        criteria: {
          property_type,
          goals,
          application,
          vlt_preference,
          budget_level,
          install_location,
          sun_exposure,
          orientation,
        },
      },
    };
  },
};