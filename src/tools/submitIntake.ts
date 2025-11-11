// src/ui/intakePanel.ts
export type IntakeValues = {
  // ... other fields ...
  application?: "living_room" | "bedroom" | "kitchen" | "bathroom" | "office" | "conference_room" | "storefront" | "lobby" | "server_room" | "warehouse" | "other";
  application_text?: string; // free‑form entry (e.g., "kitchen and living room")
  // ... other fields ...
};

export function intakeToRecommendArgs(values: Partial<IntakeValues>) {
  return {
    // ... other fields ...
    // prefer legacy enum, otherwise try to bucketize the free‑form text
    application:
      values.application ??
      (() => {
        const t = (values.application_text ?? "").toLowerCase().trim();
        const map: Record<string, string> = {
          "living room": "living_room",
          bedroom: "bedroom",
          kitchen: "kitchen",
          bathroom: "bathroom",
          office: "office",
          "conference room": "conference_room",
          storefront: "storefront",
          lobby: "lobby",
          "server room": "server_room",
          warehouse: "warehouse",
          other: "other",
        };
        return (t in map ? (map as any)[t] : undefined) as any;
      })(),
    // ... other fields ...
  };
}

export function intakeToEstimateArgs(values: Partial<IntakeValues>) {
  return {
    // ... other fields ...
    application: values.application,
    // ... other fields ...
  };
}
// -- registration helper for server.ts --
// Allows: import { registerSubmitIntake } from "./tools/submitIntake.js";
export function registerSubmitIntake(server: any) {
  // If you renamed the tool ID, keep it in sync here:
  const toolName = "submit_intake_panel";
  // Expect existing exports `descriptor` and `handler` in this module.
  // If your symbols are named differently, update these references.
  // We deliberately cast to `any` to avoid tight coupling to server's types.
  // @ts-ignore
  server.registerTool(toolName, (exports as any).descriptor, (exports as any).handler);
}