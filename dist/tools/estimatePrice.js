import { z } from "zod";
import filmsData from "../data/films.json" with { type: "json" };
// Normalize films data into an array
const films = Array.isArray(filmsData)
    ? filmsData
    : (filmsData.films ?? []);
// This schema MUST be real Zod validators so the MCP SDK can:
// - generate JSON schema for the connector UI
// - validate incoming args before calling the handler
const estimatePriceInputSchema = {
    square_feet: z
        .number({
        description: "Total square footage of glass to be filmed. Must be at least 10 sq ft.",
    })
        .min(10, "Square footage must be at least 10."),
    property_type: z
        .enum(["residential", "commercial"], {
        description: "Type of property. Used for pricing model and labor rate assumptions.",
    }),
};
// Export the tool in the shape the MCP server expects:
// - name: tool id shown to the client (snake_case is fine / expected)
// - descriptor: title/description + the Zod shape object
// - handler: called with the already-validated args
export const estimatePrice = {
    name: "estimate_price",
    descriptor: {
        title: "Estimate Price",
        description: "Estimates installed price range from baseline tiers (value/mid/premium) based on total glass area and property type. When specific SKUs are not supplied, returns tiered ranges.",
        // IMPORTANT: this must be the raw shape object of Zod validators,
        // NOT friendly strings.
        inputSchema: estimatePriceInputSchema,
    },
    handler: async (input) => {
        // input has already been validated against estimatePriceInputSchema
        const { square_feet, property_type, budget_level, } = input;
        // Baseline tier pricing (no SKUs). Use different ranges per property type.
        // Residential is a bit lower; commercial assumes higher labor/access costs.
        const tiers = property_type === "commercial"
            ? [
                { id: "baseline_value", low: 16, high: 21 },
                { id: "baseline_mid", low: 18, high: 23 },
                { id: "baseline_premium", low: 20, high: 26 },
            ]
            : [
                { id: "baseline_value", low: 14, high: 19 },
                { id: "baseline_mid", low: 16, high: 21 },
                { id: "baseline_premium", low: 18, high: 24 },
            ];
        let quotes;
        let price_range;
        if (budget_level) {
            const activeTier = tiers.find(t => t.id === `baseline_${budget_level}`);
            quotes = activeTier
                ? [{
                        sku: activeTier.id,
                        unit_price_low: activeTier.low,
                        unit_price_high: activeTier.high,
                        subtotal_low: Number((square_feet * activeTier.low).toFixed(2)),
                        subtotal_high: Number((square_feet * activeTier.high).toFixed(2)),
                        notes: "Estimate ±15% for access and complexity.",
                    }]
                : [];
            if (activeTier) {
                price_range = `$${(square_feet * activeTier.low).toLocaleString()} – $${(square_feet * activeTier.high).toLocaleString()}`;
            }
        }
        else {
            quotes = tiers.map((t) => ({
                sku: t.id,
                unit_price_low: t.low,
                unit_price_high: t.high,
                subtotal_low: Number((square_feet * t.low).toFixed(2)),
                subtotal_high: Number((square_feet * t.high).toFixed(2)),
                notes: "Estimate ±15% for access and complexity.",
            }));
        }
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
                ...(price_range ? { price_range } : {}),
            },
        };
    },
};
