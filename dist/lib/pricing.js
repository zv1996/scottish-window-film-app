function normalizeFilms(input) {
    if (Array.isArray(input))
        return input;
    if (!input || typeof input !== "object")
        return [];
    const candidates = ["films", "items", "data", "catalog", "rows", "list"];
    for (const key of candidates) {
        if (Array.isArray(input?.[key]))
            return input[key];
    }
    const values = Object.values(input);
    if (values.length && values.every((v) => typeof v === "object"))
        return values;
    return [];
}
export function calculatePricing(films, sku_list, area, property_type) {
    const filmsArr = normalizeFilms(films);
    return sku_list.map((sku) => {
        const film = filmsArr.find((f) => f.sku === sku);
        if (!film)
            return { sku, error: "Film not found" };
        const base = film.typical_installed_price_per_sqft_usd?.[property_type] || 0;
        const low = base * 0.85;
        const high = base * 1.15;
        return {
            sku,
            unit_price_low: Number(low.toFixed(2)),
            unit_price_high: Number(high.toFixed(2)),
            subtotal_low: Number((low * area).toFixed(2)),
            subtotal_high: Number((high * area).toFixed(2)),
            notes: "Estimate ±15% for access and complexity."
        };
    });
}
