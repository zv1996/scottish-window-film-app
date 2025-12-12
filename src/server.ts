import path from "node:path";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import { z } from "zod";

import { recommendFilms } from "./tools/recommendFilms.js";
import { estimatePrice } from "./tools/estimatePrice.js";
import { registerSubmitIntake } from "./tools/submitIntake.js";
import {
  buildIntakeComponents,
  intakeToRecommendArgs,
  intakeToEstimateArgs,
} from "./ui/intakePanel.js";

process.on("uncaughtException", (err) => {
  console.error("💥 Uncaught exception:", err?.stack || err);
});
process.on("unhandledRejection", (reason) => {
  console.error("💥 Unhandled rejection:", reason);
});

const server = new McpServer({ name: "scottish-window-film", version: "1.0.0" });

const swtResultsCarouselHtml = readFileSync(
  path.join(process.cwd(), "src", "ui", "results-carousel.html"),
  "utf8"
);

server.registerResource(
  "swt-results-carousel",
  "ui://widget/swt-results-carousel.html",
  {},
  async () => ({
    contents: [
      {
        uri: "ui://widget/swt-results-carousel.html",
        mimeType: "text/html+skybridge",
        text: swtResultsCarouselHtml,
        _meta: {
          "openai/widgetDescription":
            "Scottish Window Tinting results carousel showing recommended films and price ranges.",
          "openai/widgetPrefersBorder": true,
        },
      },
    ],
  })
);


// relax types for now
server.registerTool("recommend_films", recommendFilms.descriptor as any, recommendFilms.handler as any);
server.registerTool("estimate_price",  estimatePrice.descriptor  as any, estimatePrice.handler  as any);
registerSubmitIntake(server);

// UI: return the intake panel (Apps SDK components-like plan)
server.registerTool(
  "get_intake_panel",
  {
    name: "get_intake_panel",
    description:
      "Returns the Scottish Window Tinting intake panel to collect user goals and context before calling recommendation/pricing tools.",
    inputSchema: {
      preset: z.any().optional(),
    } as any,
  } as any,
  async (args: any) => {
    const preset = (args && args.preset) || {};
    const panel = buildIntakeComponents(preset);
    const json = JSON.stringify(panel);
    return {
      content: [
        { type: "text", text: json }
      ],
      structuredContent: { panel },
    };
  }
);

// Dual-mode: stdio (local) or HTTP (Render/Connector)
const MODE = (process.env.MCP_MODE || "stdio").toLowerCase();

if (MODE === "http" || MODE === "http1") {
  const PORT = Number(process.env.PORT || 2091);
  const PATH = process.env.MCP_PATH || "/mcp";

  const app = express();
  // Serve design-component UI resources (for ChatGPT App SDK)
  const uiDir = path.join(process.cwd(), "results-ui");
  app.use("/ui", express.static(uiDir));
  app.use(express.json({ limit: "4mb" }));

// Log incoming requests so we can see what the connector does
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

app.use((req, res, next) => {
  const start = Date.now();
  // Capture original end to wrap it
  const originalEnd = res.end as any;
  (res as any).end = function (chunk?: any, encoding?: any, cb?: any) {
    const ms = Date.now() - start;
    // @ts-ignore
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url} -> ${res.statusCode} (${ms}ms)`);
    return originalEnd.call(this, chunk, encoding, cb);
  };
  next();
});

// Minimal CORS so the connector never gets blocked
app.use((_req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");
  next();
});

// Fast-path preflight for the connector
app.options(PATH, (_req, res) => res.status(204).end());

// Health for Render
app.get("/healthz", (_req, res) => res.status(200).send("ok"));

// Create one transport instance for this server
const transport = new StreamableHTTPServerTransport({
  sessionIdGenerator: undefined,
} as any);

// Wire HTTP entrypoint for MCP. All MCP traffic (handshake, tool calls, etc) flows through here.
app.all(PATH, async (req, res) => {
  try {
    // Grab the parsed body from Express (may be {} for GET/HEAD)
    let body: any = (req as any).body;

    // If there's effectively no body (GET /mcp, HEAD /mcp), pass undefined
    if (
      body &&
      typeof body === "object" &&
      !Array.isArray(body) &&
      Object.keys(body).length === 0
    ) {
      body = undefined;
    }

    // Helper to normalize init requests from old clients
    const normalizeInit = (msg: any) => {
      if (
        msg &&
        msg.jsonrpc === "2.0" &&
        msg.method === "initialize" &&
        msg.params &&
        typeof msg.params === "object" &&
        msg.params.client &&              // old field
        !msg.params.clientInfo            // new field missing
      ) {
        msg.params.clientInfo = msg.params.client;
        delete msg.params.client;
      }
      return msg;
    };

    // If body is an array (batch), normalize each element
    if (Array.isArray(body)) {
      body = body.map(normalizeInit);
    } else {
      body = normalizeInit(body);
    }

    // Hand off to the MCP transport with the normalized body
    await transport.handleRequest(req, res, body);
  } catch (err) {
    console.error("❌ MCP request handler error:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "internal MCP handler error" });
    }
  }
});

// Connect the MCP server to the transport once at startup
await server.connect(transport);
console.log(`✅ HTTP transport mounted at ${PATH}`);

  app.listen(PORT, () => {
    console.log(`✅ MCP HTTP listening at http://0.0.0.0:${PORT}${PATH}`);
  });
} else {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.log("✅ Scottish Window Film MCP server connected via stdio");
}