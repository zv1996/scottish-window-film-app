import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";

const MCP_URL = import.meta.env.VITE_MCP_URL ?? "/api/mcp";

/* ---------- transport helpers ---------- */
async function initSession() {
  const res = await fetch(MCP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "swt-web-preview", version: "0.1.0" },
      },
    }),
  });
  // OK if this returns 200 with SSE — nothing else to do here.
}

async function rpcCall(method: string, params: any) {
  const res = await fetch(MCP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // Keep both mime types so the MCP server accepts us, but be ready to parse SSE
      "Accept": "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Date.now(),
      method,
      params,
    }),
  });

  // Read the body as text first; it may be pure JSON or an SSE stream.
  const raw = await res.text();

  if (!res.ok) {
    throw new Error(`RPC failed: ${res.status} ${res.statusText} — ${raw}`);
  }

  // Fast path: pure JSON
  const trimmed = raw.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return JSON.parse(trimmed);
    } catch (e) {
      // fall through to SSE parsing attempt
    }
  }

  // SSE path: extract the last event's data payload
  // SSE frames look like:
  // event: message
  // data: {"jsonrpc":"2.0","id":123,"result":{...}}
  // 
  // There may be multiple events; we take the last one that has a data: line.
  const frames = raw.split("\n\n").filter(Boolean);
  for (let i = frames.length - 1; i >= 0; i--) {
    const frame = frames[i];
    const dataLines = frame
      .split("\n")
      .filter((ln) => ln.startsWith("data:"))
      .map((ln) => ln.slice(5).trim()); // remove 'data:' prefix
    if (dataLines.length > 0) {
      const jsonStr = dataLines.join("\n").trim();
      try {
        return JSON.parse(jsonStr);
      } catch (e) {
        // continue searching earlier frames
      }
    }
  }

  // If we got here, we couldn't parse the payload.
  throw new Error(`Unexpected response format (not JSON/SSE-parsable). First 200 chars:\n${raw.slice(0, 200)}`);
}

async function callTool(name: string, args: Record<string, any>) {
  const out = await rpcCall("tools/call", { name, arguments: args ?? {} });
  // common shapes from our server
  return (
    out?.result ??
    out?.content ??
    out?.structuredContent ??
    out
  );
}

/* ---------- lightweight types ---------- */
type Field =
  | { id: string; kind: "radio" | "select"; label: string; required?: boolean; value?: any; options: { label: string; value: string }[] }
  | { id: string; kind: "checkbox-group"; label: string; required?: boolean; value?: string[]; options: { label: string; value: string }[]; help?: string }
  | { id: string; kind: "number"; label: string; min?: number; max?: number; step?: number; value?: number | null }
  | { id: string; kind: "text"; label: string; value?: string };

type Section = { kind: "group"; title?: string; fields: Field[] };

type PanelSpec = {
  kind: "panel";
  id: string;
  title: string;
  description?: string;
  sections: Section[];
  actions?: { id: string; kind: "primary" | "secondary"; label: string }[];
};

function App() {
  const [loading, setLoading] = useState(false);
  const [panel, setPanel] = useState<PanelSpec | null>(null);
  const [form, setForm] = useState<Record<string, any>>({});
  const [submitResult, setSubmitResult] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { initSession().catch(() => {}); }, []);

  function primeFormFrom(panel: PanelSpec) {
    const next: Record<string, any> = {};
    for (const sec of panel.sections) {
      for (const f of sec.fields) {
        if ((f as any).value !== undefined && (f as any).value !== null) {
          next[f.id] = (f as any).value;
        } else if (f.kind === "checkbox-group") {
          next[f.id] = [];
        } else if (f.kind === "number") {
          next[f.id] = undefined;
        } else {
          next[f.id] = "";
        }
      }
    }
    setForm(next);
  }

  async function fetchPanel() {
    setLoading(true);
    setError(null);
    setSubmitResult(null);
    try {
      const result: any = await callTool("get_intake_panel", {});
      const pRaw =
        result?.structuredContent?.panel ??
        result?.panel ??
        result?.content?.panel ??
        result;
      const p: PanelSpec | null =
        typeof pRaw === "string" ? JSON.parse(pRaw) : pRaw;
      // narrow unknown payloads coming back from the server
      function isPanelSpec(x: any): x is PanelSpec {
        return !!x && x.kind === "panel" && typeof x.id === "string" && Array.isArray(x.sections);
      }

      // --- client-side tweaks to the panel ---
      function massagePanel(spec: PanelSpec): PanelSpec {
        const cloned: PanelSpec = {
          ...spec,
          sections: spec.sections.map((sec) => ({
            ...sec,
            fields: sec.fields.map((f: any) => {
              // 1) application -> text input + new label
              if (f.id === "application") {
                return {
                  id: "application",
                  kind: "text",
                  label: "Where will the window film be installed?",
                  value: typeof f.value === "string" ? f.value : "",
                } as Field;
              }

              // 2) orientation -> checkbox-group (multi-select)
              if (f.id === "orientation") {
                const options =
                  f.options ??
                  [
                    { label: "North", value: "north" },
                    { label: "East", value: "east" },
                    { label: "South", value: "south" },
                    { label: "West", value: "west" },
                  ];

                return {
                  id: "orientation",
                  kind: "checkbox-group",
                  label: "Window orientation (select all that apply)",
                  help: "If windows face more than one direction, choose all that apply.",
                  options,
                  value: Array.isArray(f.value) ? f.value : [],
                } as Field;
              }

              return f as Field;
            }),
          })),
        };

        return cloned;
      }

      if (!isPanelSpec(p)) {
        throw new Error("Invalid panel payload from server (expected { kind: 'panel', id, sections }).");
      }
      const tweaked = massagePanel(p);
      setPanel(tweaked);
      primeFormFrom(tweaked);
    } catch (e: any) {
      setError(e?.message ?? String(e));
      setPanel(null);
    } finally {
      setLoading(false);
    }
  }

  function updateField(id: string, value: any) {
    setForm((prev) => ({ ...prev, [id]: value }));
  }

  function renderField(f: Field) {
    switch (f.kind) {
      case "radio":
        return (
          <div key={f.id} style={{ marginBottom: 12 }}>
            <div style={{ fontWeight: 600 }}>{f.label}</div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              {f.options.map((opt) => (
                <label key={opt.value} style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                  <input
                    type="radio"
                    name={f.id}
                    value={opt.value}
                    checked={form[f.id] === opt.value}
                    onChange={() => updateField(f.id, opt.value)}
                  />
                  {opt.label}
                </label>
              ))}
            </div>
          </div>
        );
      case "select":
        return (
          <div key={f.id} style={{ marginBottom: 12 }}>
            <div style={{ fontWeight: 600 }}>{f.label}</div>
            <select
              value={form[f.id] ?? ""}
              onChange={(e) => updateField(f.id, e.target.value || "")}
            >
              <option value="">{(f as any).placeholder ?? "Select…"}</option>
              {f.options.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
        );
      case "checkbox-group":
        return (
          <div key={f.id} style={{ marginBottom: 12 }}>
            <div style={{ fontWeight: 600 }}>{f.label}</div>
            {f.help && <div style={{ color: "#666", marginBottom: 6 }}>{f.help}</div>}
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              {f.options.map((opt) => {
                const arr: string[] = form[f.id] ?? [];
                const checked = arr.includes(opt.value);
                return (
                  <label key={opt.value} style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        const next = new Set(arr);
                        e.target.checked ? next.add(opt.value) : next.delete(opt.value);
                        updateField(f.id, Array.from(next));
                      }}
                    />
                    {opt.label}
                  </label>
                );
              })}
            </div>
          </div>
        );
      case "number":
        return (
          <div key={f.id} style={{ marginBottom: 12 }}>
            <div style={{ fontWeight: 600 }}>{f.label}</div>
            <input
              type="number"
              min={f.min}
              max={f.max}
              step={f.step ?? 1}
              value={form[f.id] ?? ""}
              onChange={(e) => updateField(f.id, e.target.value === "" ? undefined : Number(e.target.value))}
            />
          </div>
        );
      case "text":
        return (
          <div key={f.id} style={{ marginBottom: 12 }}>
            <div style={{ fontWeight: 600 }}>{f.label}</div>
            <input
              type="text"
              value={form[f.id] ?? ""}
              onChange={(e) => updateField(f.id, e.target.value)}
            />
          </div>
        );
      default:
        return null;
    }
  }

  async function handleSubmit() {
    if (!panel) return;
    setLoading(true);
    setError(null);
    setSubmitResult(null);
    try {
      // --- Option A shim: coerce free-text + multi-select to server schema ---
      // application: map free text to enum when possible, else send "other" + application_note
      const rawApp = (form["application"] ?? "").toString().trim();
      const appEnums = new Set([
        "living_room","bedroom","kitchen","bathroom",
        "office","conference_room","storefront","lobby",
        "server_room","warehouse","other"
      ]);
      const application = appEnums.has(rawApp) ? (rawApp as string) : "other";
      const application_note = application === "other" && rawApp ? rawApp : undefined;

      // orientation: server expects a single enum; if user picked many, send the first
      const rawOrient = form["orientation"];
      const orientation = Array.isArray(rawOrient)
        ? (rawOrient[0] ?? undefined)
        : (rawOrient || undefined);

      const payload = {
        property_type: form["property_type"] || "residential",
        goals: Array.isArray(form["goals"]) ? form["goals"] : [],
        application,
        application_note,
        vlt_preference: form["vlt_preference"] || undefined,
        budget_level: form["budget_level"] || undefined,
        install_location: form["install_location"] || undefined,
        sun_exposure: form["sun_exposure"] || undefined,
        orientation,
        square_feet: typeof form["square_feet"] === "number" ? form["square_feet"] : undefined,
        city: form["city"] || undefined,
      };
      const result: any = await callTool("submit_intake_panel", payload);

      // prefer server-provided results panel
      const rp =
        result?.structuredContent?.resultsPanel ??
        result?.resultsPanel ??
        null;
      setSubmitResult(rp ?? result);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ padding: "2rem", fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif" }}>
      <h1>Scottish Window Tinting Advisor</h1>

      {!panel ? (
        <button onClick={fetchPanel} disabled={loading}>
          {loading ? "Loading..." : "Load Intake Panel"}
        </button>
      ) : (
        <>
          <h2>{panel.title}</h2>
          {panel.description && <p style={{ color: "#555" }}>{panel.description}</p>}

          {panel.sections.map((sec) => (
            <fieldset key={sec.title} style={{ border: "1px solid #eee", borderRadius: 8, padding: 16, marginBottom: 16 }}>
              {sec.title && <legend style={{ padding: "0 8px" }}>{sec.title}</legend>}
              {sec.fields.map(renderField)}
            </fieldset>
          ))}

          <button onClick={handleSubmit} disabled={loading}>
            {loading ? "Submitting..." : "See Recommendations"}
          </button>
        </>
      )}

      {submitResult && (
        <div style={{ marginTop: 24 }}>
          <h3>{submitResult.title ?? "Results"}</h3>
          {submitResult.description && <p style={{ color: "#555" }}>{submitResult.description}</p>}
          <pre style={{ background: "#f6f8fa", padding: 12, borderRadius: 8, maxHeight: "55vh", overflow: "auto" }}>
            {JSON.stringify(submitResult, null, 2)}
          </pre>
        </div>
      )}

      {error && <p style={{ color: "crimson", marginTop: 12 }}>Error: {error}</p>}

      {/* HMR noise suppressor */}
      <script suppressHydrationWarning />
    </div>
  );
}

const el = document.getElementById("root");
if (el) {
  ReactDOM.createRoot(el).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}

export default App;