import { z } from "zod";
import filmsData from "../data/films.json" with { type: "json" };
import { calculatePricing } from "../lib/pricing.js";

// Normalize films data into an array
const films = Array.isArray(filmsData)
  ? (filmsData as any[])
  : ((filmsData as any).films ?? []);

// This schema MUST be real Zod validators so the MCP SDK can:
// - generate JSON schema for the connector UI
// - validate incoming args before calling the handler
const estimatePriceInputSchema = {
  square_feet: z
    .number({
      description:
        "Total square footage of glass to be filmed. Must be at least 10 sq ft.",
    })
    .min(10, "Square footage must be at least 10."),
  property_type: z
    .enum(["residential", "commercial"], {
      description:
        "Type of property. Used for pricing model and labor rate assumptions.",
    }),
  // Optional: let the caller specify up to 3 candidate films by SKU
  // If not provided, we'll let calculatePricing decide top films.
  sku_list: z
    .array(z.string(), {
      description:
        "Optional list of up to 3 film SKUs to quote. If omitted, best matches will be auto-selected.",
    })
    .min(1)
    .max(3)
    .optional(),
};

// Export the tool in the shape the MCP server expects:
// - name: tool id shown to the client (snake_case is fine / expected)
// - descriptor: title/description + the Zod shape object
// - handler: called with the already-validated args
export const estimatePrice = {
  name: "estimate_price",
  descriptor: {
    title: "Estimate Price",
    description:
      "Estimates installed price range for up to 3 recommended films based on total glass area and property type.",
    // IMPORTANT: this must be the raw shape object of Zod validators,
    // NOT friendly strings.
    inputSchema: estimatePriceInputSchema,
  },
  handler: async (input: any) => {
    // input has already been validated against estimatePriceInputSchema
    const {
      square_feet,
      property_type,
      sku_list,
    }: {
      square_feet: number;
      property_type: "residential" | "commercial";
      sku_list?: string[];
    } = input;

    // Our existing pricing logic expects:
    // (filmsArray, skuList, totalWindowAreaSqFt, propertyType)
    const safeSkuList = sku_list ?? [];
    const quotes = calculatePricing(
      films as any[],
      safeSkuList,
      Number(square_feet),
      property_type
    );

    // Return both human text (for normal chat)
    // and machine-structured JSON (for programmatic use / actions UI)
    return {
      content: [
        {
          type: "text",
          text: `Estimated installed pricing for ~${square_feet} sq ft (${property_type}).`,
        },
      ],
      structuredContent: {
        square_feet,
        property_type,
        quotes,
      },
    };
  },
};