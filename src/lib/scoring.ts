function normalizeFilms(input: any): any[] {
  if (Array.isArray(input)) return input;
  if (!input || typeof input !== "object") return [];
  // common wrapper keys
  const candidates = ["films", "items", "data", "catalog", "rows", "list"];
  for (const key of candidates) {
    if (Array.isArray((input as any)[key])) return (input as any)[key];
  }
  // if it's a map keyed by sku, return the values
  const values = Object.values(input);
  if (values.length && values.every((v) => v && typeof v === "object")) return values as any[];
  return [];
}

export function scoreFilms(films: any[], { property_type, goals }: any) {
  const filmsArr = normalizeFilms(films);
  if (!filmsArr.length) return [];

  const goalsLc = (goals as string[]).map(g => String(g).toLowerCase());

  const scored = filmsArr.map((film) => {
    let score = 0;
    const why: string[] = [];

    const useCases: string[] = Array.isArray(film.use_cases)
      ? film.use_cases.map((u: any) => String(u).toLowerCase())
      : String(film.use_cases || "").toLowerCase().split(/[,\|]/).map(s => s.trim()).filter(Boolean);
    goalsLc.forEach(goal => { if (useCases.includes(goal)) { score += 0.4; why.push(`Good for ${goal}`); } });

    if (film.best_for?.includes(property_type)) score += 0.2;

    const ir = Number(film.ir_reduction_pct) || 0;
    const uv = Number(film.uv_rejection_pct) || 0;
    const vlt = Number(film.visible_light_transmission) || 0;

    if (ir && goals.includes("heat")) score += ir / 500;
    if (uv && goals.includes("uv")) score += uv / 500;
    if (vlt && goals.includes("privacy") && vlt < 20) score += 0.2;

    return { ...film, score, why };
  });

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(({ sku, brand, visible_light_transmission, ir_reduction_pct, uv_rejection_pct, score, why }) => ({
      sku,
      brand,
      vlt: visible_light_transmission,
      ir_pct: ir_reduction_pct,
      uv_pct: uv_rejection_pct,
      score: Number(score.toFixed(2)),
      why
    }));
}