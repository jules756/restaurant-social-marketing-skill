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

let _connectPromise = null;
let _toolsCache = null;

function loadConfig(configPath) {
  const resolved = path.resolve(configPath);
  if (!fs.existsSync(resolved)) throw new Error(`Config file not found: ${resolved}`);
  return JSON.parse(fs.readFileSync(resolved, 'utf-8'));
}

function connectMcp(config) {
  if (_connectPromise) return _connectPromise;
  const url = config.composio?.mcpServerUrl;
  const apiKey = config.composio?.apiKey;
  if (!url) return Promise.reject(new Error('config.composio.mcpServerUrl is required. Run `node scripts/setup.js --config <path>` first.'));
  if (!apiKey) return Promise.reject(new Error('config.composio.apiKey is required. Set it in config.json or run `node scripts/setup.js --config <path>` first.'));

  _connectPromise = (async () => {
    const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
    const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');

    const transport = new StreamableHTTPClientTransport(new URL(url), {
      requestInit: { headers: { 'x-api-key': apiKey } }
    });
    const client = new Client({ name: 'restaurant-marketing', version: '4.0.0' }, { capabilities: {} });
    await client.connect(transport);
    return client;
  })();
  return _connectPromise;
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
      try {
        return JSON.parse(text);
      } catch (e) {
        throw new Error(`Tool ${name} returned non-JSON text: ${text.slice(0, 200)}`);
      }
    }
  }
  return res;
}

function resetForTests() {
  _connectPromise = null;
  _toolsCache = null;
}

module.exports = { loadConfig, connectMcp, listTools, findToolByPattern, callTool, resetForTests };
