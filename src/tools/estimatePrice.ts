import filmsData from "../data/films.json" with { type: "json" };
import { calculatePricing } from "../lib/pricing.js";
const films = Array.isArray(filmsData) ? (filmsData as any[]) : ((filmsData as any).films ?? []);

export const estimatePrice = {
  name: "estimate_price",
  descriptor: {
    title: "Estimate Price",
    description: "Estimates price for up to 3 films based on total area.",
    inputSchema: {
      sku_list: "array[string, 1..3]",
      total_window_area_sqft: "number >= 10",
      property_type: "residential|commercial"
    }
  },
  handler: async (input: any) => {
    const { sku_list, total_window_area_sqft, property_type } = input;
    const quotes = calculatePricing(
      films as any[],
      sku_list,
      Number(total_window_area_sqft),
      property_type
    );
    return {
      content: [{ type: "text", text: "Here are your price ranges." }],
      structuredContent: { quotes }
    };
  }
};