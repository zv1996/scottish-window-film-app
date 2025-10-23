import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import { recommendFilms } from "./tools/recommendFilms.js";
import { estimatePrice } from "./tools/estimatePrice.js";
process.on("uncaughtException", (err) => {
    console.error("💥 Uncaught exception:", err?.stack || err);
});
process.on("unhandledRejection", (reason) => {
    console.error("💥 Unhandled rejection:", reason);
});
const server = new McpServer({ name: "scottish-window-film", version: "1.0.0" });
// relax types for now
server.registerTool(recommendFilms.name, recommendFilms.descriptor, recommendFilms.handler);
server.registerTool(estimatePrice.name, estimatePrice.descriptor, estimatePrice.handler);
// Dual-mode: stdio (local) or HTTP (Render/Connector)
const MODE = (process.env.MCP_MODE || "stdio").toLowerCase();
if (MODE === "http" || MODE === "http1") {
    const PORT = Number(process.env.PORT || 2091);
    const PATH = process.env.MCP_PATH || "/mcp";
    const app = express();
    // Log incoming requests so we can see what the connector does
    app.use((req, _res, next) => {
        console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
        next();
    });
    app.use((req, res, next) => {
        const start = Date.now();
        // Capture original end to wrap it
        const originalEnd = res.end;
        res.end = function (chunk, encoding, cb) {
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
        next();
    });
    // Fast-path preflight for the connector
    app.options(PATH, (_req, res) => res.status(204).end());
    // Health for Render
    app.get("/healthz", (_req, res) => res.status(200).send("ok"));
    // ✅ Important: connector GET probe
    app.get(PATH, (_req, res) => res.status(200).send("mcp ok"));
    const transport = new StreamableHTTPServerTransport({ app, path: PATH });
    await server.connect(transport);
    console.log(`✅ HTTP transport mounted at ${PATH}`);
    app.listen(PORT, () => {
        console.log(`✅ MCP HTTP listening at http://0.0.0.0:${PORT}${PATH}`);
    });
}
else {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.log("✅ Scottish Window Film MCP server connected via stdio");
}
