import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import { recommendFilms } from "./tools/recommendFilms.js";
import { estimatePrice } from "./tools/estimatePrice.js";
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
    // Health for Render
    app.get("/healthz", (_req, res) => res.status(200).send("ok"));
    // ✅ Important: connector GET probe
    app.get(PATH, (_req, res) => res.status(200).send("mcp ok"));
    const transport = new StreamableHTTPServerTransport({ app, path: PATH });
    await server.connect(transport);
    app.listen(PORT, () => {
        console.log(`✅ MCP HTTP listening at http://0.0.0.0:${PORT}${PATH}`);
    });
}
else {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.log("✅ Scottish Window Film MCP server connected via stdio");
}
