// src/ui/resultsPanel.ts
// Build a results "panel" JSON object (SDK-agnostic) from tool outputs.
// This file contains only UI shaping logic — no server or SDK imports.

// -----------------------------
// Types (loose, to accept current tool shapes)
// -----------------------------
export type IntakeValues = {
  property_type?: "residential" | "commercial";
  goals?: string[];
  application?: string | null;
  vlt_preference?: string | null;
  budget_level?: string | null;
  install_location?: string | null;
  sun_exposure?: string | null;
  orientation?: string | null;
  square_feet?: number | null;
  city?: string | null;
};

export type RecommendResult = {
  // Your recommend_films tool typically returns { recommendations: [...] }
  recommendations?: Array<{
    brand?: string;
    series?: string;
    product_name?: string;
    sku?: string;
    category?: string;
    vlt?: number | string;
    reason?: string;
    score?: number;
    price_tier?: string;
    exterior_ok?: boolean;
  }>;
  // Allow passthrough of whatever else you return
  [k: string]: any;
};

export type EstimateQuote = {
  sku?: string;
  unit_price_low?: number;
  unit_price_high?: number;
  subtotal_low?: number;
  subtotal_high?: number;
  notes?: string;
};

export type EstimateResult = {
  square_feet?: number;
  property_type?: "residential" | "commercial";
  quotes?: EstimateQuote[];
  [k: string]: any;
};

// -----------------------------
// Helpers
// -----------------------------
function formatCurrency(n: number | undefined | null): string {
  if (typeof n !== "number" || !isFinite(n)) return "—";
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
  } catch {
    return `$${Math.round(n).toLocaleString()}`;
  }
}

function safeArray<T = any>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

function nonEmpty(str?: string | null): string | undefined {
  if (!str) return undefined;
  const s = String(str).trim();
  return s.length ? s : undefined;
}

// Compute min/max subtotals across quotes (if present)
function summarizeQuotes(quotes: EstimateQuote[] = []): { low?: number; high?: number } {
  const lows = quotes.map((q) => q.subtotal_low).filter((n): n is number => typeof n === "number" && isFinite(n));
  const highs = quotes.map((q) => q.subtotal_high).filter((n): n is number => typeof n === "number" && isFinite(n));
  if (!lows.length && !highs.length) return {};
  return {
    low: lows.length ? Math.min(...lows) : undefined,
    high: highs.length ? Math.max(...highs) : undefined,
  };
}

// Friendly chips for context summary
function makeChips(intake: IntakeValues): string[] {
  const chips: string[] = [];
  if (intake.property_type) chips.push(intake.property_type);
  if (intake.application) chips.push(intake.application);
  if (intake.vlt_preference) chips.push(`${intake.vlt_preference} look`);
  if (intake.budget_level) chips.push(`${intake.budget_level} budget`);
  if (intake.install_location) chips.push(`${intake.install_location} install`);
  if (intake.sun_exposure) chips.push(`${intake.sun_exposure} sun`);
  if (intake.orientation) chips.push(`${intake.orientation} facing`);
  if (typeof intake.square_feet === "number") chips.push(`${intake.square_feet} sq ft`);
  if (intake.city) chips.push(intake.city);
  const goals = safeArray<string>(intake.goals);
  if (goals.length) chips.unshift(...goals);
  return chips;
}

// -----------------------------
// Public builders
// -----------------------------
export function buildResultsPanel(
  recommend: RecommendResult | null | undefined,
  estimate: EstimateResult | null | undefined,
  intake: IntakeValues = {}
): any {
  const recs = safeArray(recommend?.recommendations);
  const quotes = safeArray<EstimateQuote>(estimate?.quotes);
  const range = summarizeQuotes(quotes);

  // Build a compact list of recommendation items (text rows)
  const recommendationItems = recs.map((r, idx) => {
    const title = [r.brand, r.series, r.product_name].filter(Boolean).join(" • ") || r.sku || `Film ${idx + 1}`;
    const bits: string[] = [];
    if (r.vlt !== undefined) bits.push(`VLT: ${r.vlt}`);
    if (r.category) bits.push(r.category);
    if (r.price_tier) bits.push(`${r.price_tier} tier`);
    if (typeof r.exterior_ok === "boolean") bits.push(r.exterior_ok ? "exterior-capable" : "interior-only");
    const subtitle = bits.join(" • ");

    const why = r.reason ? String(r.reason) : undefined;

    return {
      kind: "item",
      title,
      subtitle: subtitle || undefined,
      body: why,
    };
  });

  const chips = makeChips(intake);

  // Panel structure (SDK-agnostic)
  const panel: any = {
    kind: "panel",
    id: "swt_results_panel_v1",
    title: "Recommended Window Films",
    description: chips.length ? chips.join("  •  ") : undefined,
    sections: [
      {
        kind: "group",
        title: recommendationItems.length ? "Top Matches" : "No matches yet",
        fields: recommendationItems.length
          ? [
              {
                id: "recommendations_list",
                kind: "list",
                label: "",
                items: recommendationItems,
              },
            ]
          : [
              {
                id: "empty_state",
                kind: "text",
                label: "",
                value:
                  "We couldn't generate recommendations. Try adding goals, application, VLT preference, budget, install location, and sun exposure.",
              },
            ],
      },
      // Pricing group only if we have a range or at least one quote
      (range.low || range.high || quotes.length) && {
        kind: "group",
        title: "Estimated Installed Cost",
        fields: [
          {
            id: "price_range",
            kind: "text",
            label: "Ballpark range",
            value:
              range.low || range.high
                ? `${formatCurrency(range.low)} – ${formatCurrency(range.high)}`
                : "—",
          },
          quotes.length && {
            id: "quotes_json",
            kind: "json",
            label: "Quote details",
            value: quotes,
          },
        ].filter(Boolean),
      },
    ].filter(Boolean),
    actions: [
      { id: "refine_answers", kind: "secondary", label: "Adjust answers" },
      { id: "start_over", kind: "secondary", label: "Start over" },
    ],
  };

  return panel;
}

// Optional: human-readable summary (good for sharing or narrow surfaces)
export function buildTextSummary(
  recommend: RecommendResult | null | undefined,
  estimate: EstimateResult | null | undefined,
  intake: IntakeValues = {}
): string {
  const recs = safeArray(recommend?.recommendations);
  const quotes = safeArray<EstimateQuote>(estimate?.quotes);
  const range = summarizeQuotes(quotes);

  const header = `Film picks for ${intake.property_type ?? "property"}`;
  const goals = safeArray<string>(intake.goals);
  const goalsLine = goals.length ? `Goals: ${goals.join(", ")}` : "";
  const areaLine = typeof intake.square_feet === "number" ? `${intake.square_feet} sq ft` : "";

  const recLines = recs.slice(0, 5).map((r) => {
    const name = [r.brand, r.series, r.product_name].filter(Boolean).join(" ") || r.sku || "Film";
    const why = r.reason ? ` — ${r.reason}` : "";
    return `• ${name}${why}`;
  });

  const priceLine =
    range.low || range.high
      ? `Estimated installed cost: ${formatCurrency(range.low)} – ${formatCurrency(range.high)}`
      : "";

  return [header, goalsLine, areaLine, "", ...recLines, "", priceLine]
    .filter((s) => s && String(s).trim().length)
    .join("\n");
}
