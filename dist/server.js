import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import express from "express";
import http from "http";
import { recommendFilms } from "./tools/recommendFilms.js";
import { estimatePrice } from "./tools/estimatePrice.js";
const server = new McpServer({ name: "scottish-window-film", version: "1.0.0" });
server.registerTool(recommendFilms.name, recommendFilms.descriptor, recommendFilms.handler);
server.registerTool(estimatePrice.name, estimatePrice.descriptor, estimatePrice.handler);
// Dual-mode: stdio (local) or HTTP (Render/HTTPS connector)
const MODE = (process.env.MCP_MODE || "stdio").toLowerCase();
if (MODE === "http" || MODE === "sse" || MODE === "http1") {
    const PORT = Number(process.env.PORT || 2091);
    const PATH = process.env.MCP_PATH || "/sse";
    const APP_TOKEN = process.env.MCP_BEARER || ""; // optional bearer auth
    const app = express();
    // Optional bearer auth for the MCP endpoint
    app.use(PATH, (req, res, next) => {
        if (!APP_TOKEN)
            return next();
        const h = req.headers.authorization || "";
        if (h === `Bearer ${APP_TOKEN}`)
            return next();
        res.status(401).send("Unauthorized");
    });
    // Health check for Render
    app.get("/healthz", (_req, res) => res.status(200).send("ok"));
    const httpServer = http.createServer(app);
    const transport = new SSEServerTransport(httpServer, PATH);
    await server.connect(transport);
    httpServer.listen(PORT, () => {
        console.log(`✅ MCP SSE listening at http://0.0.0.0:${PORT}${PATH}`);
    });
}
else {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.log("✅ Scottish Window Film MCP server connected via stdio");
}
