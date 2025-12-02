import { z } from "zod";
import productsData from "../data/products.json" with { type: "json" };
import { scoreFilms } from "../lib/scoring.js";

// Flatten products.json into a normalized "film-like" array that scoreFilms can consume.
// Each brand block in products.json looks like:
// {
//   brand: "Huper Optik",
//   products: [ { product_name, use_cases, property_types, ... }, ... ]
// }
//
// scoreFilms expects fields like:
// - sku (string)
// - brand (string)
// - use_cases (string[])
// - best_for (string[])  <-- we'll map from product.property_types
// - visible_light_transmission, ir_reduction_pct, uv_rejection_pct (optional)
//
// We'll synthesize sku as "<brand>-<product_name>" lowercased/kebabed.
function toKebab(input: string): string {
  return String(input || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "");
}

// --- scoring helpers for diversification & relevance ---
function vltScore(vlt: number | undefined, pref?: string) {
  if (typeof vlt !== "number") return 0;
  const p = (pref || "").toLowerCase();
  if (p === "brighter") return vlt;                // higher VLT is better
  if (p === "darker")  return 100 - vlt;           // lower VLT is better
  return Math.abs(50 - vlt) * -1;                  // "neutral": closer to 50 is better (less penalty)
}

function budgetTierRank(t?: string) {
  const map: Record<string, number> = { premium: 3, mid: 2, value: 1 };
  return map[(t || "").toLowerCase()] || 0;
}

function budgetAffinity(t?: string, wanted?: string) {
  if (!wanted) return 0;
  const delta = Math.abs(budgetTierRank(t) - budgetTierRank(wanted));
  return delta === 0 ? 3 : delta === 1 ? 1 : -1; // prefer exact, then adjacent, penalize far
}

function prettyCase(s?: string) {
  if (!s) return "";
  return String(s)
    .replace(/[_-]+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, (m) => m.toUpperCase());
}
function whyMatchCount(film: any, wantGoals: Set<string>) {
  if (!wantGoals.size) return 0;
  const g = wantGoals;
  const uc: string[] = Array.isArray(film?.use_cases) ? film.use_cases.map((u: string) => String(u).toLowerCase()) : [];
  let c = 0;
  if ((g.has("heat") || g.has("glare")) && (film?.category === "solar_control" || uc.includes("heat") || uc.includes("glare"))) c++;
  if (g.has("uv") && (uc.includes("uv") || film?.category === "solar_control")) c++;
  if (g.has("privacy") && (uc.includes("privacy") || film?.category === "privacy")) c++;
  if (g.has("security") && (uc.includes("security") || film?.category === "security")) c++;
  if (g.has("decorative") && (uc.includes("decorative") || film?.category === "decorative")) c++;
  return c;
}
function installLabel(film: any) {
  const locs = Array.isArray(film?.install_location) ? film.install_location.map((l: string) => l.toLowerCase()) : [];
  if (film?.exterior_ok === true || locs.includes("exterior")) return "Exterior‑capable";
  return "Interior";
}

const films = (() => {
  // productsData may be an array of brand blocks or an object with { brands: [...] }
  const brandBlocks = Array.isArray(productsData)
    ? (productsData as any[])
    : (productsData as any).brands || [];

  const out: any[] = [];
  for (const block of brandBlocks) {
    const brandName = block.brand || "Unknown";
    const items = Array.isArray(block.products) ? block.products : [];
    for (const p of items) {
      const skuSynth = `${toKebab(brandName)}-${toKebab(
        p.product_name || p.series || "film"
      )}`;

      out.push({
        sku: skuSynth,
        brand: brandName,
        product_name: p.product_name ?? p.series ?? "Unknown",
        category: p.category,
        description: p.description,
        // map property_types -> best_for to match scoreFilms expectations
        best_for: Array.isArray(p.property_types)
          ? p.property_types
          : [],
        // pass through what problems this film solves
        use_cases: Array.isArray(p.use_cases) ? p.use_cases : [],
        // optional hints, if present in products.json
        visible_light_transmission:
          (p as any).visible_light_transmission ??
          (p as any).vlt ??
          undefined,
        ir_reduction_pct:
          (p as any).ir_reduction_pct ??
          (p as any).ir_reduction ??
          undefined,
        uv_rejection_pct:
          (p as any).uv_rejection_pct ??
          (p as any).uv_rejection ??
          undefined,
        install_location: p.install_location,
        price_tier: p.price_tier,
        exterior_ok: p.exterior_ok,
        series: p.series ?? undefined,
        brand_page_url: block.brand_page_url ?? undefined,
      });
    }
  }
  return out;
})();


function expandToProducts(
  recs: any[],
  catalog: any[],
  goals: string[],
  ctx?: {
    property_type?: string;
    install_location?: string;
    vlt_preference?: string;
    budget_level?: string;
  }
): any[] {
  const wantGoals = new Set((goals || []).map((g) => String(g).toLowerCase()));
  const wantProp  = (ctx?.property_type || "").toLowerCase();
  const wantLoc   = (ctx?.install_location || "").toLowerCase();
  const wantVLT   = (ctx?.vlt_preference || "").toLowerCase();
  const wantBudget= (ctx?.budget_level || "").toLowerCase();
  const wantGoalsArr = Array.from(wantGoals);

  const brandAlias = (b?: string) => {
    const n = (b || "").toLowerCase().trim();
    if (!n) return n;
    if (n === "3m window film") return "3m";
    return n;
  };

  // Goal relevance: prioritize solar_control when heat/glare are in play,
  // otherwise match against use_cases array.
  const matchesGoal = (film: any) => {
    if (!wantGoals.size) return true;
    const uc = Array.isArray(film?.use_cases)
      ? film.use_cases.map((u: string) => String(u).toLowerCase())
      : [];
    if ((wantGoals.has("heat") || wantGoals.has("glare")) && film?.category === "solar_control") {
      return true;
    }
    return uc.some((u) => wantGoals.has(u));
  };

  // Contextual eligibility: respect property type and install location.
  // NOTE: products.json uses property_types; we normalized that into `best_for`.
  const matchesContext = (film: any) => {
    if (wantProp) {
      const pts = Array.isArray(film?.best_for)
        ? film.best_for.map((p: string) => p.toLowerCase())
        : [];
      if (pts.length && !pts.includes(wantProp)) return false;
    }
    if (wantLoc) {
      const locs = Array.isArray(film?.install_location)
        ? film.install_location.map((l: string) => l.toLowerCase())
        : [];
      if (locs.length && !locs.includes(wantLoc)) return false;
      if (wantLoc === "exterior" && film?.exterior_ok === false) return false;
    }
    return true;
  };

  // Compute a composite score for each candidate to allow consistent sorting.
  const goalWeight = (film: any) => {
    let score = 0;
    // base boosts by goal/category
    if (film?.category === "solar_control" && (wantGoals.has("heat") || wantGoals.has("glare"))) score += 4;
    if (wantGoals.has("uv") && (film?.category === "solar_control" || film?.use_cases?.includes?.("uv"))) score += 2;
    if (wantGoals.has("privacy") && (film?.use_cases?.includes?.("privacy"))) score += 3;
    if (wantGoals.has("security") && film?.category === "security") score += 4;
    if (wantGoals.has("decorative") && film?.category === "decorative") score += 3;

    // VLT preference
    const vlt = (typeof film?.visible_light_transmission === "number")
      ? film.visible_light_transmission
      : (typeof (film as any)?.vlt === "number" ? (film as any).vlt : undefined);
    score += vltScore(vlt, wantVLT) / 10; // keep VLT influence subtle

    // Budget affinity
    score += budgetAffinity(film?.price_tier, wantBudget);

    return score;
  };

  // Build pool filtered by context and broad goal fit.
  let pool = catalog.filter((f) => matchesContext(f) && matchesGoal(f));

  // If a budget is specified, first prefer those tiers; keep a backfill of others if too few.
  let tierPreferred = pool.filter((f) => wantBudget ? (String(f?.price_tier || "").toLowerCase() === wantBudget) : true);
  const need = 5;
  if (tierPreferred.length < need) {
    const backfill = pool.filter((f) => !tierPreferred.includes(f));
    // allow adjacent tiers first
    backfill.sort((a, b) => {
      const da = Math.abs(budgetTierRank(a?.price_tier) - budgetTierRank(wantBudget));
      const db = Math.abs(budgetTierRank(b?.price_tier) - budgetTierRank(wantBudget));
      return da - db;
    });
    tierPreferred = tierPreferred.concat(backfill.slice(0, need - tierPreferred.length));
  }

  // Score and sort by relevance.
  tierPreferred.sort((a, b) => {
    const wa = goalWeight(a);
    const wb = goalWeight(b);
    if (wb !== wa) return wb - wa;
    const ya = whyMatchCount(a, wantGoals);
    const yb = whyMatchCount(b, wantGoals);
    if (yb !== ya) return yb - ya;
    // tertiary: prefer closer VLT to preference
    const av = typeof a?.visible_light_transmission === "number" ? a.visible_light_transmission : (typeof (a as any)?.vlt === "number" ? (a as any).vlt : undefined);
    const bv = typeof b?.visible_light_transmission === "number" ? b.visible_light_transmission : (typeof (b as any)?.vlt === "number" ? (b as any).vlt : undefined);
    const pref = wantVLT || "neutral";
    const clos = (v?: number) => {
      if (typeof v !== "number") return 999;
      if (pref === "brighter") return Math.abs(100 - v);
      if (pref === "darker")  return Math.abs(v - 0);
      return Math.abs(50 - v);
    };
    const ca = clos(av), cb = clos(bv);
    if (ca !== cb) return ca - cb;
    // final deterministic alphabetical by brand then name
    const ta = `${a?.brand || ""}|${a?.product_name || ""}`;
    const tb = `${b?.brand || ""}|${b?.product_name || ""}`;
    return ta.localeCompare(tb);
  });

  // Enforce brand diversity: walk the list and pick first item of a brand before allowing repeats.
  const byBrandPick: any[] = [];
  const seenBrand = new Set<string>();
  for (const f of tierPreferred) {
    const b = brandAlias(f?.brand);
    if (!b) continue;
    if (!seenBrand.has(b) || byBrandPick.length >= 3) {
      seenBrand.add(b);
      byBrandPick.push(f);
    }
    if (byBrandPick.length >= need) break;
  }

  // Final trim and normalize a nice display title
  const uniqueKey = new Set<string>();
  const final: any[] = [];
  for (const f of byBrandPick) {
    const key = f?.sku || `${(f?.brand||"").toLowerCase()}|${(f?.series||"").toLowerCase()}|${(f?.product_name||"").toLowerCase()}`;
    if (uniqueKey.has(key)) continue;
    uniqueKey.add(key);

    const brand = f?.brand || "Unknown";
    const series = f?.series ? String(f.series) : undefined;
    const name = f?.product_name ? String(f.product_name) : undefined;

    const title = [brand, series, name].filter(Boolean).join(" • ");
    final.push({
      ...f,
      title,
      subtitle: [
        prettyCase(f?.category),
        installLabel(f)
      ].filter(Boolean).join(" • ") || undefined,
    });
    if (final.length >= need) break;
  }

  return final;
}

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
      "Returns the top 5 film recommendations for this scenario. If critical context is missing (like brightness preference or application), asks clarifying questions instead of guessing.",
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

    // scoreFilms ranks our normalized product catalog (from products.json)
    // for the requested goals and property type, then returns the top matches.
    const recs = scoreFilms(films as any[], {
      property_type,
      goals,
    });

    // scoreFilms may return brand-level suggestions; expand to concrete products
    const enriched = expandToProducts(recs, films as any[], goals, {
      property_type,
      install_location,
      vlt_preference,
      budget_level,
    });

    const criteriaSummary = (() => {
      const bits: string[] = [];
      bits.push(property_type === "commercial" ? "Commercial" : "Residential");
      if (vlt_preference) bits.push(`${prettyCase(vlt_preference)} look`);
      if (budget_level) bits.push(`${prettyCase(budget_level)} budget`);
      if (install_location) bits.push(`${prettyCase(install_location)} install`);
      if (sun_exposure) bits.push(`${prettyCase(sun_exposure)} sun`);
      if (orientation) bits.push(`${prettyCase(orientation)} facing`);
      return bits.join(" • ");
    })();

    return {
      content: [
        {
          type: "text",
          text: `Top picks for ${property_type} based on ${goals.join(", ")}.`,
        },
      ],
      structuredContent: {
        recommendations: enriched,
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
        summary: criteriaSummary
      },
    };
  },
};