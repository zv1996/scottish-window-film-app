import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";

import { recommendFilms } from "./tools/recommendFilms.js";
import { estimatePrice } from "./tools/estimatePrice.js";

const server = new McpServer({ name: "scottish-window-film", version: "1.0.0" });

server.registerTool(recommendFilms.name, recommendFilms.descriptor as any, recommendFilms.handler as any);
server.registerTool(estimatePrice.name, estimatePrice.descriptor as any, estimatePrice.handler as any);

// Dual-mode: stdio (local) or HTTP (Render/HTTPS connector)
const MODE = (process.env.MCP_MODE || "stdio").toLowerCase();

if (MODE === "http" || MODE === "sse" || MODE === "http1") {
  const PORT = Number(process.env.PORT || 2091);
  const PATH = process.env.MCP_PATH || "/mcp";
  const APP_TOKEN = process.env.MCP_BEARER || ""; // optional bearer auth

  const app = express();

  // Optional bearer auth for the MCP endpoint
  app.use(PATH, (req, res, next) => {
    if (!APP_TOKEN) return next();
    const h = req.headers.authorization || "";
    if (h === `Bearer ${APP_TOKEN}`) return next();
    res.status(401).send("Unauthorized");
  });

  // Health check for Render
  app.get("/healthz", (_req, res) => res.status(200).send("ok"));

  const transport = new StreamableHTTPServerTransport({ app, path: PATH } as any);
  await server.connect(transport);

  app.listen(PORT, () => {
    console.log(`✅ MCP HTTP listening at http://0.0.0.0:${PORT}${PATH}`);
  });
} else {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.log("✅ Scottish Window Film MCP server connected via stdio");
}