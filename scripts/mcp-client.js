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
 *
 * Tool Router quirk: it only advertises 6 dispatcher tools, so an exact
 * match for e.g. /OPENAI_CREATE_IMAGE_EDIT/ never finds anything. To work
 * around: if no direct match found and a Tool Router is reachable, return
 * a synthetic tool entry with the regex source as the name, so callers
 * (image-gen.js, etc.) can still produce the slug they want and let
 * callTool() route it through COMPOSIO_MULTI_EXECUTE_TOOL.
 */
async function findToolByPattern(config, re) {
  for (const userId of uniqueUserIds(config)) {
    const tools = await listTools(config, userId);
    const tool = tools.find((t) => re.test(t.name));
    if (tool) return { tool, userId };
  }
  // Synthesize for Tool Router. Only do this when the regex is anchored
  // and contains no metacharacters — otherwise we don't know what slug to
  // produce. Heuristic: ^[A-Z_]+$ between the anchors.
  const m = String(re).match(/^\/\^([A-Z_]+)\$\/[a-z]*$/);
  if (m) {
    for (const userId of uniqueUserIds(config)) {
      const tools = _toolsByUserId.get(userId) || [];
      if (tools.some((t) => TOOL_ROUTER_DISPATCHERS.has(t.name))) {
        return { tool: { name: m[1], _viaDispatcher: true }, userId };
      }
    }
  }
  return null;
}

// Names exposed by Composio Tool Router (the dispatcher tools). Any other
// tool name is a "real" toolkit tool (e.g. OPENAI_CREATE_IMAGE_EDIT) that
// must be invoked through COMPOSIO_MULTI_EXECUTE_TOOL.
const TOOL_ROUTER_DISPATCHERS = new Set([
  'COMPOSIO_MANAGE_CONNECTIONS',
  'COMPOSIO_MULTI_EXECUTE_TOOL',
  'COMPOSIO_REMOTE_BASH_TOOL',
  'COMPOSIO_REMOTE_WORKBENCH',
  'COMPOSIO_SEARCH_TOOLS',
  'COMPOSIO_GET_TOOL_SCHEMAS',
]);

function unwrap(res, label) {
  if (Array.isArray(res?.content)) {
    const text = res.content.find((c) => c.type === 'text')?.text;
    if (text) {
      try { return JSON.parse(text); }
      catch (e) { throw new Error(`Tool ${label} returned non-JSON text: ${text.slice(0, 200)}`); }
    }
  }
  return res;
}

/**
 * Call a tool by name. Three modes:
 *   - dispatcher tool (COMPOSIO_*) → call directly
 *   - any other slug + tool router URL → wrap in COMPOSIO_MULTI_EXECUTE_TOOL
 *   - any other slug + legacy MCP URL → call directly (was the old behavior)
 *
 * Tool Router only advertises the 6 dispatcher tools — calling
 * OPENAI_CREATE_IMAGE_EDIT directly fails with "tool not found". So we
 * wrap: client.callTool({ name: "COMPOSIO_MULTI_EXECUTE_TOOL", arguments: {
 *   tools: [{ tool_slug, arguments }] }})
 *
 * Detection: if the active server's listTools includes the requested name,
 * call directly; otherwise assume it needs the dispatcher.
 */
async function callTool(config, name, args = {}) {
  // Find any userId whose server advertises this tool, or whose server is
  // a Tool Router (which means the slug needs the dispatcher).
  let userId = _toolToUserId.get(name);
  let useDispatcher = false;
  if (!userId) {
    // Force a listTools cycle to populate the cache.
    await listAllTools(config);
    userId = _toolToUserId.get(name);
  }
  if (!userId && !TOOL_ROUTER_DISPATCHERS.has(name)) {
    // Tool Router doesn't advertise the slug, but it can still execute it
    // through COMPOSIO_MULTI_EXECUTE_TOOL. Use the first userId that has
    // a tool router (heuristic: any userId that advertised dispatcher tools).
    for (const uid of uniqueUserIds(config)) {
      const tools = _toolsByUserId.get(uid) || [];
      if (tools.some((t) => TOOL_ROUTER_DISPATCHERS.has(t.name))) {
        userId = uid;
        useDispatcher = true;
        break;
      }
    }
  }
  if (!userId) throw new Error(`Tool "${name}" is not exposed by any configured userId, and no tool router is reachable.`);

  const client = await connectMcp(config, userId);

  if (useDispatcher) {
    const res = await client.callTool({
      name: 'COMPOSIO_MULTI_EXECUTE_TOOL',
      arguments: { tools: [{ tool_slug: name, arguments: args }] },
    });
    const unwrapped = unwrap(res, `MULTI_EXECUTE(${name})`);
    // The dispatcher returns { results: [{ data, error, ... }] } or similar.
    const item = Array.isArray(unwrapped?.results) ? unwrapped.results[0]
              : Array.isArray(unwrapped?.tools) ? unwrapped.tools[0]
              : unwrapped;
    if (item?.error) throw new Error(`${name}: ${item.error?.message || JSON.stringify(item.error).slice(0, 200)}`);
    // Return the inner result so existing callers see the same shape they
    // would from a direct callTool.
    return item?.data || item?.result || item;
  }

  return unwrap(await client.callTool({ name, arguments: args }), name);
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
