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

// helpers for goal checks and thickness parsing
const hasGoal = (goals: string[] | undefined, g: string) =>
  Array.isArray(goals) && goals.map(x => String(x).toLowerCase()).includes(g.toLowerCase());

const parseMil = (name?: string): number | null => {
  if (!name) return null;
  const m = name.toLowerCase().match(/(\d+)\s*mil/);
  return m ? Number(m[1]) : null;
};

export function scoreFilms(
  films: any[],
  {
    property_type,
    goals,
    vlt_preference,
    install_location,
    budget_level,
  }: {
    property_type?: string;
    goals?: string[] | undefined;
    vlt_preference?: string | undefined;
    install_location?: string | undefined;
    budget_level?: string | undefined;
  }
) {
  const filmsArr = normalizeFilms(films);
  if (!filmsArr.length) return [];

  const safeGoals: string[] = Array.isArray(goals) ? goals : [];
  const goalsLc = safeGoals.map((g) => String(g).toLowerCase());

  const wantsHeat = goalsLc.includes("heat");
  const wantsGlare = goalsLc.includes("glare");
  const wantsUV = goalsLc.includes("uv") || goalsLc.includes("uv / fade") || goalsLc.includes("fade");
  const wantsPrivacy = goalsLc.includes("privacy");
  const wantsSecurity = goalsLc.includes("security");
  const wantsGraffiti = goalsLc.includes("graffiti");

  // ---------- Base scoring ----------
  const baseScored = filmsArr.map((film) => {
    let score = 0;
    const why: string[] = [];

    // normalize commonly used fields
    const seriesStr = String(film.series || "");
    const nameStr = String(film.product_name || film.name || "");
    const categoryStr = String(film.category || "");

    const useCases: string[] = Array.isArray(film.use_cases)
      ? film.use_cases.map((u: any) => String(u).toLowerCase())
      : String(film.use_cases || "")
          .toLowerCase()
          .split(/[,\|]/)
          .map((s) => s.trim())
          .filter(Boolean);

    // goal fit from use_cases
    goalsLc.forEach((g) => {
      if (useCases.includes(g)) {
        score += 0.5;
        why.push(`Good for ${g}`);
      }
    });

    // property type hint
    if (film.best_for?.includes?.(property_type)) {
      score += 0.2;
      why.push(`Geared for ${property_type}`);
    }

    // numeric perf signals
    const ir = Number(film.ir_reduction_pct) || 0;
    const uv = Number(film.uv_rejection_pct) || 0;
    const vlt = Number(film.visible_light_transmission) || 0;

    if (ir && wantsHeat) score += ir / 500; // up to +0.2 at 100%
    if (uv && wantsUV) score += uv / 500;

    // Extra nudge for exceptional UV rejection (95%+)
    if (wantsUV && uv >= 95) {
      score += 0.05;
      why.push("High UV (95%+)");
    }

    if (vlt && wantsPrivacy && vlt < 20) score += 0.2;

    // Security / Graffiti handling
    const useCasesStr = useCases.join(",");
    const isSecurityCategory =
      /security/i.test(categoryStr) ||
      /security/i.test(seriesStr) ||
      /security/i.test(nameStr) ||
      useCasesStr.includes("security");

    const isGraffitiCategory =
      /graffiti/i.test(categoryStr) ||
      /graffiti/i.test(seriesStr) ||
      /anti[-\s]?vandal/i.test(seriesStr) ||
      /graffiti/i.test(nameStr) ||
      useCasesStr.includes("graffiti");

    if (wantsSecurity) {
      if (isSecurityCategory) {
        score += 3.0;
        why.push("Security series");
      }
      const mil = parseMil(nameStr);
      if (mil && mil >= 7) {
        score += 2.0;
        why.push(`${mil} mil thickness`);
      }
      if (isGraffitiCategory && !wantsGraffiti) {
        score -= 1.5;
        why.push("Graffiti is not security");
      }
    } else {
      if (isSecurityCategory) score -= 0.25;
      if (isGraffitiCategory && !wantsGraffiti) score -= 0.75;
    }

    // VLT preference nudge (stronger for "brighter", soft penalty for too dark)
    if (vlt_preference) {
      const pref = String(vlt_preference).toLowerCase();
      if (pref === "brighter") {
        if (vlt >= 65) {
          score += 0.22; // very bright / spectrally selective
          why.push("Brighter: favors high VLT (65%+)");
        } else if (vlt >= 55) {
          score += 0.18; // bright enough
          why.push("Brighter: favors VLT 55–64%");
        } else if (vlt <= 25) {
          score -= 0.12; // avoid very dark picks when user wants bright
          why.push("Brighter: avoids very dark (≤25% VLT)");
        }
      } else if (pref === "neutral") {
        if (vlt >= 35 && vlt <= 55) {
          score += 0.1;
          why.push("Neutral: favors mid VLT (35–55%)");
        }
      } else if (pref === "darker") {
        if (vlt <= 30) {
          score += 0.1;
          why.push("Darker: favors ≤30% VLT");
        }
      }
    }

    // install location hint
    if (install_location) {
      const loc = String(install_location).toLowerCase();
      const isExteriorCapable =
        /exterior/i.test(categoryStr) || /osw|exterior/i.test(seriesStr) || /exterior/i.test(nameStr);
      if (loc === "exterior" && isExteriorCapable) {
        score += 0.2;
        why.push("Exterior-capable");
      }
      if (loc === "interior" && !isSecurityCategory) {
        score += 0.05; // small nudge so interior-capable non-security don't get penalized
      }
    }

    // budget nudge (very light)
    if (budget_level) {
      const tier = String(budget_level).toLowerCase();
      const tierStr = String(film.tier || film.price_tier || "");
      if (tier && tierStr) {
        if (/value/i.test(tier) && /value|basic|good/i.test(tierStr)) score += 0.05;
        if (/mid/i.test(tier) && /mid|better|standard/i.test(tierStr)) score += 0.05;
        if (/premium/i.test(tier) && /premium|best|elite/i.test(tierStr)) score += 0.05;
      }
    }

    return { ...film, score, why };
  });

  // sort & check if we're "starved"
  const sortedBase = baseScored.sort((a, b) => b.score - a.score);
  const top3 = sortedBase.slice(0, 3);
  const maxScore = sortedBase.length ? sortedBase[0].score : 0;
  const sufficient =
    (top3.length >= 3 && maxScore >= 0.8) ||
    (top3.length >= 2 && maxScore >= 1.0); // generous threshold if two great hits

  if (sufficient) {
    return top3.map(({ sku, brand, visible_light_transmission, ir_reduction_pct, uv_rejection_pct, score, why }) => ({
      sku,
      brand,
      vlt: visible_light_transmission,
      ir_pct: ir_reduction_pct,
      uv_pct: uv_rejection_pct,
      score: Number(score.toFixed(2)),
      why,
    }));
  }

  // ---------- Broaden-when-starved pass ----------
  const broadened = baseScored.map((film) => {
    let score = film.score;
    const why = [...(film.why || [])];

    const seriesStr = String(film.series || "");
    const nameStr = String(film.product_name || film.name || "");
    const categoryStr = String(film.category || "");
    const vlt = Number(film.visible_light_transmission) || 0;
    const uv = Number(film.uv_rejection_pct) || 0;

    const looksSolar =
      /solar|sun\s*control|reflect/i.test(categoryStr) ||
      /solar|sun\s*control|prestige|silver|quantum|dual\s*reflect/i.test(seriesStr + " " + nameStr);

    if ((wantsHeat || wantsGlare) && looksSolar) {
      score += 0.35;
      why.push("Broadened: solar-control likely to help heat/glare");
    }

    if (wantsPrivacy && vlt <= 45) {
      score += 0.2;
      why.push("Broadened: darker VLT for privacy");
    }

    if (wantsUV && uv >= 85) {
      score += 0.1;
      why.push("Broadened: high UV rejection");
    }

    if (wantsSecurity) {
      const isSecurityish = /security|safety/i.test(categoryStr + " " + seriesStr + " " + nameStr);
      if (isSecurityish) {
        score += 1.0;
        why.push("Broadened: security-oriented line");
      }
    }

    return { ...film, score, why };
  });

  const finalSorted = broadened.sort((a, b) => b.score - a.score).slice(0, 5);

  const seen = new Set<string>();
  const unique = finalSorted.filter((f) => {
    const k = String(f.sku || f.product_name || f.name);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  return unique.map(
    ({ sku, brand, visible_light_transmission, ir_reduction_pct, uv_rejection_pct, score, why }) => ({
      sku,
      brand,
      vlt: visible_light_transmission,
      ir_pct: ir_reduction_pct,
      uv_pct: uv_rejection_pct,
      score: Number(score.toFixed(2)),
      why,
    })
  );
}