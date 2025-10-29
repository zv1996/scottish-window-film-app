// src/ui/intakePanel.ts
// Declarative intake surface + helpers for calling MCP tools.
// This file does NOT import the Apps SDK directly so it can be used from server.ts
// regardless of SDK version. It exports a plain "components plan" object that
// your server can return to ChatGPT, plus helpers to convert the submitted values
// into the two tool payloads (`recommend_films` and `estimate_price`).

// -----------------------------
// Types
// -----------------------------
export type PropertyType = "residential" | "commercial";
export type Goal =
  | "heat"
  | "glare"
  | "privacy"
  | "uv"
  | "security"
  | "decorative";

export type VltPreference = "brighter" | "neutral" | "darker";
export type BudgetLevel = "value" | "mid" | "premium";
export type InstallLocation = "interior" | "exterior";
export type SunExposure = "low" | "medium" | "high";
export type Orientation = "north" | "east" | "south" | "west";

export interface IntakeValues {
  property_type: PropertyType;
  goals: Goal[];
  application?: string;
  vlt_preference?: VltPreference;
  budget_level?: BudgetLevel;
  install_location?: InstallLocation;
  sun_exposure?: SunExposure;
  orientation?: Orientation;
  square_feet?: number;
  city?: string;
}

// -----------------------------
// Constants (options shown to users)
// -----------------------------
export const PROPERTY_TYPES: { label: string; value: PropertyType }[] = [
  { label: "Residential", value: "residential" },
  { label: "Commercial", value: "commercial" },
];

export const GOAL_OPTIONS: { label: string; value: Goal }[] = [
  { label: "Heat", value: "heat" },
  { label: "Glare", value: "glare" },
  { label: "Privacy", value: "privacy" },
  { label: "UV / Fade", value: "uv" },
  { label: "Security", value: "security" },
  { label: "Decorative", value: "decorative" },
];

export const APPLICATION_OPTIONS = [
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
];

export const VLT_OPTIONS: { label: string; value: VltPreference }[] = [
  { label: "Brighter (clear look)", value: "brighter" },
  { label: "Neutral (slight tint okay)", value: "neutral" },
  { label: "Darker (tinted / more privacy)", value: "darker" },
];

export const BUDGET_OPTIONS: { label: string; value: BudgetLevel }[] = [
  { label: "Value", value: "value" },
  { label: "Mid", value: "mid" },
  { label: "Premium", value: "premium" },
];

export const INSTALL_OPTIONS: { label: string; value: InstallLocation }[] = [
  { label: "Interior", value: "interior" },
  { label: "Exterior", value: "exterior" },
];

export const SUN_EXPOSURE_OPTIONS: { label: string; value: SunExposure }[] = [
  { label: "Low", value: "low" },
  { label: "Medium", value: "medium" },
  { label: "High", value: "high" },
];

export const ORIENTATION_OPTIONS: { label: string; value: Orientation }[] = [
  { label: "North", value: "north" },
  { label: "East", value: "east" },
  { label: "South", value: "south" },
  { label: "West", value: "west" },
];

// -----------------------------
// Normalizers / transforms
// -----------------------------
function toNumberOrUndefined(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function uniq<T>(arr: T[] = []): T[] {
  return Array.from(new Set(arr));
}

export function normalizeIntake(input: Partial<IntakeValues>): IntakeValues {
  const goalsArray = Array.isArray(input.goals)
    ? (input.goals.filter(Boolean) as Goal[])
    : [];

  const out: IntakeValues = {
    property_type:
      (input.property_type as PropertyType) ?? ("residential" as PropertyType),
    goals: uniq(goalsArray) as Goal[],
    application: input.application || undefined,
    vlt_preference: input.vlt_preference || undefined,
    budget_level: input.budget_level || undefined,
    install_location: input.install_location || undefined,
    sun_exposure: input.sun_exposure || undefined,
    orientation: input.orientation || undefined,
    square_feet: toNumberOrUndefined(input.square_feet),
    city: input.city?.trim() || undefined,
  };
  return out;
}

// Compute which clarifications are still missing for high‑confidence recs.
export function missingForHighConfidence(i: IntakeValues): string[] {
  const missing: string[] = [];
  if (!i.application) missing.push("where this is going (room/area)");
  if (!i.vlt_preference) missing.push("brightness / look preference");
  if (!i.budget_level) missing.push("budget comfort");
  if (!i.install_location) missing.push("interior vs exterior");
  if (!i.sun_exposure && !i.orientation)
    missing.push("sun exposure or window orientation");
  return missing;
}

// -----------------------------
// Components plan
// -----------------------------
//
// The returned object is intentionally SDK‑agnostic. Your server.ts can
// return it directly in a resource/tool response, or adapt it to the latest
// Apps SDK Components API shape.
export function buildIntakeComponents(
  preset: Partial<IntakeValues> = {}
): any {
  const i = normalizeIntake(preset);

  return {
    kind: "panel",
    id: "swt_intake_panel_v1",
    title: "Scottish Window Tinting — Film Advisor",
    description:
      "Answer a few quick questions to see tailored film recommendations and a ballpark installed cost.",
    sections: [
      {
        kind: "group",
        title: "Property & Goals",
        fields: [
          {
            id: "property_type",
            kind: "radio",
            label: "Property type",
            required: true,
            value: i.property_type,
            options: PROPERTY_TYPES,
          },
          {
            id: "goals",
            kind: "checkbox-group",
            label: "What are your goals?",
            help: "Pick one or more",
            required: true,
            value: i.goals,
            options: GOAL_OPTIONS,
          },
          {
            id: "application",
            kind: "select",
            label: "Where is this going?",
            placeholder: "Choose a room/area",
            value: i.application ?? null,
            options: APPLICATION_OPTIONS.map((v) => ({ label: v, value: v })),
          },
        ],
      },
      {
        kind: "group",
        title: "Look, Budget & Install",
        fields: [
          {
            id: "vlt_preference",
            kind: "radio",
            label: "Look preference",
            value: i.vlt_preference ?? null,
            options: VLT_OPTIONS,
          },
          {
            id: "budget_level",
            kind: "radio",
            label: "Budget",
            value: i.budget_level ?? null,
            options: BUDGET_OPTIONS,
          },
          {
            id: "install_location",
            kind: "radio",
            label: "Install location",
            value: i.install_location ?? null,
            options: INSTALL_OPTIONS,
          },
        ],
      },
      {
        kind: "group",
        title: "Sun & Size (optional)",
        fields: [
          {
            id: "sun_exposure",
            kind: "radio",
            label: "Sun exposure",
            value: i.sun_exposure ?? null,
            options: SUN_EXPOSURE_OPTIONS,
          },
          {
            id: "orientation",
            kind: "radio",
            label: "Window orientation",
            value: i.orientation ?? null,
            options: ORIENTATION_OPTIONS,
          },
          {
            id: "square_feet",
            kind: "number",
            label: "Approx. total square feet",
            min: 1,
            step: 1,
            value: i.square_feet ?? null,
          },
          {
            id: "city",
            kind: "text",
            label: "City (for scheduling later)",
            value: i.city ?? "",
          },
        ],
      },
    ],
    actions: [
      {
        id: "submit_intake",
        kind: "primary",
        label: "See Recommendations",
        // The server can bind this to call both tools in sequence and
        // render results with another panel.
      },
    ],
  };
}

// -----------------------------
// Tool payload helpers
// -----------------------------
export function intakeToRecommendArgs(
  raw: Partial<IntakeValues>
): Record<string, unknown> {
  const i = normalizeIntake(raw);
  return {
    property_type: i.property_type,
    goals: i.goals,
    application: i.application,
    vlt_preference: i.vlt_preference,
    budget_level: i.budget_level,
    install_location: i.install_location,
    sun_exposure: i.sun_exposure,
    orientation: i.orientation,
  };
}

export function intakeToEstimateArgs(
  raw: Partial<IntakeValues>
): Record<string, unknown> {
  const i = normalizeIntake(raw);
  return {
    square_feet: i.square_feet, // may be undefined; your server can conditionally call estimate_price
    property_type: i.property_type,
  };
}
