import { recommendFilms } from "./tools/recommendFilms.js";
import { estimatePrice } from "./tools/estimatePrice.js";

const rec = await recommendFilms.handler({
  property_type: "residential",
  goals: ["heat", "glare", "uv"],
  application: "living_room",
  vlt_preference: "neutral",
  budget_level: "mid",
  install_location: "interior",
  orientation: "south",
  sun_exposure: "high",
  city: "Denver"
});
console.log("\n=== recommend_films ===");
console.log(JSON.stringify(rec, null, 2));

const skus = rec?.structuredContent?.recommendations?.map((r: any) => r.sku) ?? [];
const price = await estimatePrice.handler({
  sku_list: skus.slice(0, 3),
  total_window_area_sqft: 200,
  property_type: "residential"
});
console.log("\n=== estimate_price ===");
console.log(JSON.stringify(price, null, 2));
