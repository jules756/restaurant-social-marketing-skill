/**
 * MCP client wrapper with per-userId routing.
 *
 * Composio sometimes requires splitting toolkits across multiple userIds
 * (e.g. OpenAI on its own, OAuth toolkits on another). Each unique userId
 * gets its own MCP server URL, recorded in config.composio.mcpServerUrls
 * by setup.js (keyed by userId).
 *
 * Resolution: tool name → userId (looked up in route cache built during
 * listTools) → MCP server URL → cached MCP client.
 *
 *   listTools(config, userId?)            → tools advertised by that userId's server
 *   listAllTools(config)                   → tools across every configured userId
 *   findToolByPattern(config, re)          → { tool, userId } for first match
 *   callTool(config, name, args)           → routes to the right server by tool name
 *   resetCache()                           → drop cached state
 *
 * No SDK calls. No hardcoded tool slugs. Schemas come from the servers.
 */

const fs = require('fs');
const path = require('path');

const _clientByUserId = new Map();   // userId → connected MCP client (Promise)
const _toolsByUserId = new Map();    // userId → tool list
const _toolToUserId = new Map();     // tool name → userId (route cache)

function loadConfig(configPath) {
  const resolved = path.resolve(configPath);
  if (!fs.existsSync(resolved)) throw new Error(`Config file not found: ${resolved}`);
  return JSON.parse(fs.readFileSync(resolved, 'utf-8'));
}

/**
 * Map a toolkit slug to the userId that owns it for this agent.
 * Falls back to defaultUserId if no override is set.
 */
function resolveUserIdForToolkit(config, toolkitSlug) {
  const overrides = config.composio?.userIdOverrides || {};
  return overrides[toolkitSlug.toLowerCase()] || config.composio?.defaultUserId;
}

/**
 * The set of unique userIds this agent uses. setup.js iterates this set
 * to create one MCP server per unique userId.
 */
function uniqueUserIds(config) {
  const ids = new Set();
  if (config.composio?.defaultUserId) ids.add(config.composio.defaultUserId);
  for (const id of Object.values(config.composio?.userIdOverrides || {})) {
    if (id) ids.add(id);
  }
  return [...ids];
}

/**
 * Connect to the MCP server for a specific userId.
 */
function connectMcp(config, userId) {
  const cached = _clientByUserId.get(userId);
  if (cached) return cached;

  const apiKey = config.composio?.apiKey;
  const url = config.composio?.mcpServerUrls?.[userId];
  if (!apiKey) return Promise.reject(new Error('config.composio.apiKey is required.'));
  if (!url) return Promise.reject(new Error(
    `No MCP server URL for userId "${userId}". Run setup.js to provision: ` +
    `node scripts/setup.js --config <path>`
  ));

  const promise = (async () => {
    const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
    const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
    const transport = new StreamableHTTPClientTransport(new URL(url), {
      requestInit: { headers: { 'x-api-key': apiKey } }
    });
    const client = new Client(
      { name: `restaurant-marketing/${userId}`, version: '4.0.0' },
      { capabilities: {} }
    );
    await client.connect(transport);
    return client;
  })();

  _clientByUserId.set(userId, promise);
  return promise;
}

/**
 * List tools for one userId (or defaultUserId if unspecified).
 * Cached per userId. Side effect: indexes tool name → userId for callTool.
 */
async function listTools(config, userId) {
  const targetUserId = userId || config.composio?.defaultUserId;
  if (!targetUserId) throw new Error('No userId given and config.composio.defaultUserId is empty.');
  const cached = _toolsByUserId.get(targetUserId);
  if (cached) return cached;
  const client = await connectMcp(config, targetUserId);
  const res = await client.listTools();
  const tools = res.tools || [];
  _toolsByUserId.set(targetUserId, tools);
  for (const t of tools) _toolToUserId.set(t.name, targetUserId);
  return tools;
}

/**
 * Aggregate tools across every userId this agent uses.
 */
async function listAllTools(config) {
  const userIds = uniqueUserIds(config);
  if (!userIds.length) throw new Error('No userIds in config.composio.');
  const all = [];
  for (const id of userIds) {
    const tools = await listTools(config, id);
    for (const t of tools) all.push({ ...t, _userId: id });
  }
  return all;
}

/**
 * Find a tool whose name matches a regex, scanning every userId.
 * Returns { tool, userId } or null.
 */
async function findToolByPattern(config, re) {
  for (const userId of uniqueUserIds(config)) {
    const tools = await listTools(config, userId);
    const tool = tools.find((t) => re.test(t.name));
    if (tool) return { tool, userId };
  }
  return null;
}

/**
 * Call a tool by name. Routes to the right userId's server automatically
 * based on the route cache built during listTools.
 */
async function callTool(config, name, args = {}) {
  let userId = _toolToUserId.get(name);
  if (!userId) {
    await listAllTools(config);
    userId = _toolToUserId.get(name);
    if (!userId) throw new Error(`Tool "${name}" is not exposed by any configured userId.`);
  }
  const client = await connectMcp(config, userId);
  const res = await client.callTool({ name, arguments: args });
  if (Array.isArray(res?.content)) {
    const text = res.content.find((c) => c.type === 'text')?.text;
    if (text) {
      try { return JSON.parse(text); }
      catch (e) { throw new Error(`Tool ${name} returned non-JSON text: ${text.slice(0, 200)}`); }
    }
  }
  return res;
}

function resetCache() {
  _clientByUserId.clear();
  _toolsByUserId.clear();
  _toolToUserId.clear();
}

module.exports = {
  loadConfig,
  connectMcp,
  listTools,
  listAllTools,
  findToolByPattern,
  callTool,
  resolveUserIdForToolkit,
  uniqueUserIds,
  resetCache,
};
