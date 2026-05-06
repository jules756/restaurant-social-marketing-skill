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

// Keyed by mcpServerUrl so swapping URLs mid-process works correctly
const _connectPromises = {};
const _toolsCaches = {};

function loadConfig(configPath) {
  const resolved = path.resolve(configPath);
  if (!fs.existsSync(resolved)) throw new Error(`Config file not found: ${resolved}`);
  return JSON.parse(fs.readFileSync(resolved, 'utf-8'));
}

function connectMcp(config) {
  const url = config.composio?.mcpServerUrl;
  const apiKey = config.composio?.apiKey;
  if (!url) return Promise.reject(new Error('config.composio.mcpServerUrl is required. Run `node scripts/setup.js --config <path>` first.'));
  if (!apiKey) return Promise.reject(new Error('config.composio.apiKey is required. Set it in config.json or run `node scripts/setup.js --config <path>` first.'));
  if (_connectPromises[url]) return _connectPromises[url];

  _connectPromises[url] = (async () => {
    const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
    const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');

    const transport = new StreamableHTTPClientTransport(new URL(url), {
      requestInit: { headers: { 'x-api-key': apiKey } }
    });
    const client = new Client({ name: 'restaurant-marketing', version: '4.0.0' }, { capabilities: {} });
    await client.connect(transport);
    return client;
  })();
  return _connectPromises[url];
}

async function listTools(config) {
  const url = config.composio?.mcpServerUrl;
  if (_toolsCaches[url]) return _toolsCaches[url];
  const client = await connectMcp(config);
  const res = await client.listTools();
  _toolsCaches[url] = res.tools || [];
  return _toolsCaches[url];
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

function resetCache() {
  Object.keys(_connectPromises).forEach(k => delete _connectPromises[k]);
  Object.keys(_toolsCaches).forEach(k => delete _toolsCaches[k]);
}

// Back-compat alias for the test that imports the old name. Production
// code (setup.js) uses `resetCache` for clarity.
const resetForTests = resetCache;

module.exports = { loadConfig, connectMcp, listTools, findToolByPattern, callTool, resetCache, resetForTests };
