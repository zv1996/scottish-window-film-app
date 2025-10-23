import express from "express";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

// Sanity check for root (optional)
app.get("/", (_req, res) => res.send("OK"));

// Support both /mcp and /mcp/
const mcpPaths = ["/mcp", "/mcp/"];

// Minimal discovery endpoint so connector creation succeeds
app.get(mcpPaths, (_req, res) => {
  res.json({
    name: "Scottish Window Tinting Advisor",
    version: "1.0.0",
    mcp: "1.0",
    // You can change these later to your actual RPC endpoints
    endpoints: { rpc: "/mcp/rpc" },
    tools: [] // fill in later
  });
});

// (Optional) stub JSON-RPC endpoint your app can grow into
app.post(["/mcp/rpc", "/mcp/rpc/"], (req, res) => {
  // For now, just echo back the request so you get 200s
  res.json({ ok: true, received: req.body });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`MCP server on :${PORT}`));
