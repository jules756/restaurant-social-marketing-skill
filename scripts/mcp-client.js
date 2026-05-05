/**
 * MCP client wrapper. Connects to the per-agent Composio MCP server
 * recorded in config.composio.mcpServerUrl, caches the connection +
 * tool list for the process lifetime, and exposes a tiny surface:
 *
 *   listTools(config)              → array of { name, description, inputSchema }
 *   callTool(config, name, args)   → tool result (parsed JSON if the tool returned text)
 *   findToolByPattern(config, re)  → first tool whose name matches the regex
 *   resetForTests()                → drop cached state (test-only)
 *
 * No SDK calls. No hardcoded tool slugs. Schemas come from the server.
 */

const fs = require('fs');
const path = require('path');

let _client = null;
let _toolsCache = null;

function loadConfig(configPath) {
  const resolved = path.resolve(configPath);
  if (!fs.existsSync(resolved)) throw new Error(`Config file not found: ${resolved}`);
  return JSON.parse(fs.readFileSync(resolved, 'utf-8'));
}

async function connectMcp(config) {
  if (_client) return _client;
  const url = config.composio?.mcpServerUrl;
  const apiKey = config.composio?.apiKey;
  if (!url) throw new Error('config.composio.mcpServerUrl is required. Run `node scripts/setup.js --config <path>` first.');
  if (!apiKey) throw new Error('config.composio.apiKey is required.');

  const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
  const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');

  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers: { 'x-api-key': apiKey } }
  });
  const client = new Client({ name: 'restaurant-marketing', version: '4.0.0' }, { capabilities: {} });
  await client.connect(transport);
  _client = client;
  return _client;
}

async function listTools(config) {
  if (_toolsCache) return _toolsCache;
  const client = await connectMcp(config);
  const res = await client.listTools();
  _toolsCache = res.tools || [];
  return _toolsCache;
}

async function findToolByPattern(config, re) {
  const tools = await listTools(config);
  return tools.find((t) => re.test(t.name)) || null;
}

async function callTool(config, name, args = {}) {
  const client = await connectMcp(config);
  const res = await client.callTool({ name, arguments: args });
  // MCP wraps tool output in `content` blocks. Most Composio tools return a
  // single text block holding JSON; surface the parsed object so callers
  // don't every-time-write the same unwrap.
  if (Array.isArray(res?.content)) {
    const text = res.content.find((c) => c.type === 'text')?.text;
    if (text) {
      try { return JSON.parse(text); } catch { return { raw: text }; }
    }
  }
  return res;
}

function resetForTests() {
  _client = null;
  _toolsCache = null;
}

module.exports = { loadConfig, connectMcp, listTools, findToolByPattern, callTool, resetForTests };
