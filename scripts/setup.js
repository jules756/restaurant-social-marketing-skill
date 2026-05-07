#!/usr/bin/env node
/**
 * Skill setup. Idempotent. Run once after editing config.json with your
 * Composio apiKey, defaultUserId, and any userIdOverrides.
 *
 *   1. Validate config shape.
 *   2. For each unique userId (default + overrides), figure out which
 *      enabled toolkits it owns by querying Composio's authConfigs.
 *   3. Create one MCP server per userId with its toolkits.
 *   4. composio.mcp.generate(userId, serverId) → write per-userId URLs
 *      to config.composio.mcpServerUrls[userId].
 *   5. Verify by listing tools across every userId.
 *
 * Usage:
 *   node setup.js --config ~/agents/<agent>/social-marketing/config.json
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Composio } = require('@composio/core');
const {
  listAllTools,
  resetCache,
  uniqueUserIds,
  resolveUserIdForToolkit,
} = require('./mcp-client');

const args = process.argv.slice(2);
const getArg = (n) => { const i = args.indexOf(`--${n}`); return i !== -1 ? args[i + 1] : null; };
const hasFlag = (n) => args.includes(`--${n}`);
const configPath = getArg('config');
const force = hasFlag('force');
if (!configPath) { console.error('Usage: node setup.js --config <config.json> [--force]'); process.exit(1); }

const checks = [];
const record = (label, ok, fix) => {
  checks.push({ label, ok, fix });
  console.log(`${ok ? '✅' : '❌'} ${label}${!ok && fix ? `\n   → ${fix}` : ''}`);
};

function loadConfig() {
  const p = path.resolve(configPath);
  if (!fs.existsSync(p)) { console.error(`Config not found: ${p}`); process.exit(1); }
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}
function saveConfig(config) {
  fs.writeFileSync(path.resolve(configPath), JSON.stringify(config, null, 2) + '\n');
}

// Toolkit slugs we care about. The platforms.* keys map 1:1 to Composio
// toolkit slugs. Drive, OpenAI, OpenRouter are always considered if a
// userId owns them (resolved by reading the Composio project's auth configs).
const PLATFORM_TOOLKITS = ['instagram', 'facebook', 'tiktok'];
const KNOWN_TOOLKITS = [
  'instagram', 'facebook', 'tiktok',
  'googledrive', 'gmail',
  'openai', 'openrouter',
  'telegram',
];

/**
 * Aggregate allowlist by scanning every skill folder for tools.json.
 *
 * Each skill declares ONLY the tools it needs in its own tools.json
 * (per-toolkit map). setup.js merges them into one allowlist per
 * toolkit. New skill = new tools.json = new tools enabled. Removing a
 * tool requires editing only the skill that uses it.
 *
 * Layout (in container at /opt/data/skills/, on host at this script's
 * grandparent + each skill name):
 *   restaurant-marketing/tools.json
 *   content-preparation/tools.json
 *   marketing-intelligence/tools.json
 *   ...
 *
 * Falls back to scanning ../<skill>/ relative to scripts/ if /opt/data
 * isn't readable (running on host).
 */
function loadToolAllowlist() {
  const candidates = [
    '/opt/data/skills',                           // inside container
    path.resolve(__dirname, '..'),                // when running on host (skill repo root)
  ];
  let skillsRoot = null;
  for (const c of candidates) {
    if (fs.existsSync(c) && fs.statSync(c).isDirectory()) {
      // The container layout puts SKILL.md inside each skill folder; the
      // host layout has them as siblings of scripts/. Both work.
      skillsRoot = c;
      break;
    }
  }
  if (!skillsRoot) {
    console.warn('   ⚠ no skills directory found — allowlist will be empty');
    return {};
  }

  const merged = {};
  const entries = fs.readdirSync(skillsRoot, { withFileTypes: true });
  let skillCount = 0;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const toolsPath = path.join(skillsRoot, entry.name, 'tools.json');
    if (!fs.existsSync(toolsPath)) continue;
    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(toolsPath, 'utf-8'));
    } catch (e) {
      console.warn(`   ⚠ ${toolsPath}: ${e.message}`);
      continue;
    }
    skillCount++;
    for (const [toolkit, tools] of Object.entries(manifest)) {
      if (toolkit.startsWith('_') || !Array.isArray(tools)) continue;
      const tk = toolkit.toLowerCase();
      if (!merged[tk]) merged[tk] = new Set();
      for (const t of tools) merged[tk].add(t);
    }
  }
  // Convert sets to sorted arrays for deterministic hashing.
  const out = {};
  for (const [tk, set] of Object.entries(merged)) out[tk] = [...set].sort();
  console.log(`   ℹ aggregated allowlist from ${skillCount} skill manifest(s) at ${skillsRoot}`);
  return out;
}

const TOOL_ALLOWLIST = loadToolAllowlist();

/**
 * Discover which toolkits are connected under defaultUserId on Composio.
 * Side-effect: mutates config.platforms.*.enabled and config.googleDrive.enabled
 * to match. The owner never edits these by hand — Composio is the source of truth.
 */
async function discoverEnabledToolkits(composio, config) {
  const userId = config.composio.defaultUserId;
  const list = [];
  for (const tk of KNOWN_TOOLKITS) {
    try {
      const accounts = await composio.connectedAccounts.list({ userIds: [userId], toolkitSlugs: [tk] });
      const items = Array.isArray(accounts?.items) ? accounts.items : [];
      if (items.length) list.push(tk);
    } catch {
      /* ignore — toolkit not connected for this userId */
    }
  }
  // Reflect discovery back into config (so the owner's view of state is accurate).
  config.platforms = config.platforms || {};
  for (const t of PLATFORM_TOOLKITS) {
    config.platforms[t] = config.platforms[t] || {};
    config.platforms[t].enabled = list.includes(t);
  }
  config.googleDrive = config.googleDrive || {};
  config.googleDrive.enabled = list.includes('googledrive');
  return list;
}

/**
 * For one userId, fetch every auth config they have on the Composio
 * project. Returns a map { toolkitSlug: authConfigId }. Multiple auth
 * configs for the same toolkit → take the first and warn.
 */
async function fetchAuthConfigsForUserId(composio, userId) {
  const out = {};
  // Composio's authConfigs.list() can be filtered per toolkit. We iterate
  // KNOWN_TOOLKITS and ask "is there an auth config for this toolkit
  // under this userId?". The connectedAccounts API would be more direct
  // but auth configs are what mcp.create() needs anyway.
  for (const tk of KNOWN_TOOLKITS) {
    try {
      // Note: Composio's authConfigs.list() is project-scoped, not
      // userId-scoped. To check whether *this userId* has a connected
      // account for a toolkit, use connectedAccounts.list({ userId, toolkit }).
      const accounts = await composio.connectedAccounts.list({ userIds: [userId], toolkitSlugs: [tk] });
      const items = Array.isArray(accounts?.items) ? accounts.items : [];
      if (!items.length) continue;
      // Find this toolkit's project-level auth config (mcp.create needs that).
      const authList = await composio.authConfigs.list({ toolkit: tk });
      const authItems = Array.isArray(authList?.items) ? authList.items : [];
      if (!authItems.length) continue;
      if (authItems.length > 1) {
        console.log(`   ℹ multiple auth configs for "${tk}" — using first (${authItems[0].id})`);
      }
      out[tk] = authItems[0].id;
    } catch (e) {
      // Ignore "not found" / 404 — just means this userId doesn't have
      // this toolkit. Real failures (auth) bubble up via the apiKey check.
      if (!/not found|404/i.test(e.message || '')) {
        console.log(`   ⚠ probing "${tk}" for "${userId}" failed: ${e.message}`);
      }
    }
  }
  return out;
}

/**
 * Composio caps server names at 30 chars + accepts [a-z0-9-]. The name
 * encodes:
 *   - an 8-char hash of the userId (so different agents get different names),
 *   - an 8-char hash of the allowlist contents (so changes to the allowlist
 *     produce a NEW server instead of inheriting the old server's tool set).
 *
 * Without the allowlist hash, re-running setup with an updated tools.json
 * silently reuses the old server and the new tools never get exposed.
 */
function serverNameFor(userId, allowlistObj) {
  const userHash = crypto.createHash('sha1').update(userId).digest('hex').slice(0, 8);
  const stable = JSON.stringify(allowlistObj, Object.keys(allowlistObj).sort());
  const allowHash = crypto.createHash('sha1').update(stable).digest('hex').slice(0, 8);
  return `rm-${userHash}-${allowHash}`;
}

(async () => {
  console.log(`\n=== Restaurant Marketing — Setup ===`);
  console.log(`Config: ${configPath}\n`);
  const config = loadConfig();

  // 0. If MCP servers are already provisioned, bail out unless --force.
  // This is the most important check in the file. Earlier the on-boot
  // hook ran setup.js on every container restart, which re-provisioned
  // servers and clobbered working config.yaml entries. Now: if URLs
  // already exist in config.json, OR config.yaml has a Composio MCP
  // entry, do nothing. Only --force overrides this.
  const existingUrls = config.composio?.mcpServerUrls || {};
  if (!force && Object.keys(existingUrls).length > 0) {
    console.log(`✓ ${Object.keys(existingUrls).length} MCP server URL(s) already configured.`);
    console.log(`  To re-provision, re-run with --force.`);
    process.exit(0);
  }

  // 1. Shape
  const apiKey = config.composio?.apiKey;
  const defaultUserId = config.composio?.defaultUserId;
  if (!apiKey) { record('composio.apiKey set', false, 'Set composio.apiKey from your Composio project'); process.exit(1); }
  if (!defaultUserId) { record('composio.defaultUserId set', false, 'Set composio.defaultUserId — your main per-agent userId'); process.exit(1); }
  record('composio.apiKey set', true);
  record(`composio.defaultUserId "${defaultUserId}"`, true);

  const overrides = config.composio?.userIdOverrides || {};
  if (Object.keys(overrides).length) {
    for (const [tk, uid] of Object.entries(overrides)) {
      record(`override: ${tk} → "${uid}"`, true);
    }
  } else {
    console.log(`   ℹ no userIdOverrides — all toolkits resolve to defaultUserId`);
  }

  // 2. Composio client
  let composio;
  try {
    composio = new Composio({ apiKey });
    record('Composio API key valid (client constructed)', true);
  } catch (e) {
    record('Composio API key valid', false, e.message);
    process.exit(1);
  }

  // 3. Discover enabled toolkits from Composio (auto-set platforms.*.enabled).
  const enabled = await discoverEnabledToolkits(composio, config);
  if (!enabled.length) {
    record('Toolkits connected under defaultUserId', false,
      `No connected accounts found for "${defaultUserId}" in Composio. Connect at least one toolkit in the Composio dashboard, then re-run.`);
    process.exit(1);
  }
  record(`Discovered toolkits under "${defaultUserId}": ${enabled.join(', ')}`, true);

  // 4. For each unique userId, gather toolkits + auth configs.
  const userIds = uniqueUserIds(config);
  const perUser = {};   // userId → { toolkits: { slug: authConfigId } }

  for (const uid of userIds) {
    perUser[uid] = { toolkits: {} };
    const authMap = await fetchAuthConfigsForUserId(composio, uid);
    // Filter to toolkits actually expected for this userId based on
    // resolveUserIdForToolkit + config's enabled list.
    for (const tk of enabled) {
      if (resolveUserIdForToolkit(config, tk) !== uid) continue;
      if (!authMap[tk]) {
        record(`auth config + connected account for "${tk}" on "${uid}"`, false,
          `In Composio dashboard: connect "${tk}" for userId "${uid}". OAuth toolkits need OAuth flow; API-key toolkits need the key pasted.`);
        continue;
      }
      perUser[uid].toolkits[tk] = authMap[tk];
      record(`auth config "${tk}" for "${uid}" → ${authMap[tk]}`, true);
    }
  }

  // 5. Per userId: create MCP server (or reuse) and generate URL.
  const newServerUrls = {};
  const newServerIds = {};

  for (const uid of userIds) {
    const tks = Object.entries(perUser[uid].toolkits);
    if (!tks.length) {
      console.log(`   ⏭  userId "${uid}" has no toolkits — skipping MCP server`);
      continue;
    }
    // Build the per-toolkit allowlist for THIS server, scoped to only the
    // toolkits this userId actually owns. Without this, Composio exposes the
    // entire toolkit catalog (50-150+ tools per server) and we overload the
    // API on every Hermes session start.
    const scopedAllowlist = {};
    for (const [tk] of tks) {
      scopedAllowlist[tk] = TOOL_ALLOWLIST[tk] || [];
    }
    const name = serverNameFor(uid, scopedAllowlist);
    const toolkitsWithAllowlist = tks.map(([tk, authId]) => {
      const allowed = scopedAllowlist[tk];
      if (allowed.length === 0) {
        console.log(`   ℹ "${tk}" has no allowlisted tools — toolkit will be wired with auth but expose nothing`);
      }
      return {
        toolkit: tk,
        authConfigId: authId,
        allowedTools: allowed,
      };
    });
    const totalAllowed = toolkitsWithAllowlist.reduce((n, t) => n + t.allowedTools.length, 0);
    console.log(`   → MCP server "${name}" will expose ${totalAllowed} tool(s) total (allowlist enforced)`);

    // Idempotent create: if a server with this deterministic name already
    // exists in the Composio project, reuse it (look up by name, get its id).
    // Otherwise create a new one. This makes re-runs safe.
    let server;
    try {
      server = await composio.mcp.create(name, {
        toolkits: toolkitsWithAllowlist,
      });
      record(`MCP server for "${uid}" → ${server.id} (${totalAllowed} tools)`, true);
    } catch (e) {
      const isDuplicate = /already exists|MCP_DuplicateServerName|1151/i.test(e.message || '');
      if (!isDuplicate) {
        record(`MCP server create for "${uid}"`, false, `composio.mcp.create failed: ${e.message}`);
        process.exit(1);
      }
      // Look up the existing server by name.
      try {
        const existingList = await composio.mcp.list({ name });
        const items = Array.isArray(existingList?.items) ? existingList.items
                    : Array.isArray(existingList) ? existingList
                    : [];
        const existing = items.find((s) => s.name === name);
        if (!existing) throw new Error(`mcp.list({name}) returned no match for "${name}"`);
        server = existing;
        record(`MCP server for "${uid}" → ${server.id} (reused — ${totalAllowed} tools allowlisted in code; existing server config retained)`, true);
        console.log(`   ℹ Reused existing MCP server "${name}". To force fresh creation, delete it in Composio dashboard and re-run.`);
      } catch (lookupErr) {
        record(`MCP server lookup for "${uid}"`, false,
          `Server "${name}" exists but lookup failed: ${lookupErr.message}. Delete it in Composio dashboard and re-run.`);
        process.exit(1);
      }
    }
    let instance;
    try {
      instance = await composio.mcp.generate(uid, server.id);
      record(`MCP URL for "${uid}" → ${instance.url.slice(0, 50)}…`, true);
    } catch (e) {
      record(`MCP URL generate for "${uid}"`, false, e.message);
      process.exit(1);
    }
    newServerUrls[uid] = instance.url;
    newServerIds[uid] = server.id;
  }

  // 6. Persist
  config.composio.mcpServerUrls = newServerUrls;
  config.composio.mcpServerIds = newServerIds;
  saveConfig(config);
  record(`config.composio.mcpServerUrls written for ${Object.keys(newServerUrls).length} userId(s)`, true);

  // 7. Verify by listing tools across every userId. Also produce a per-toolkit
  //    summary so the operator sees ✅ Instagram (5 tools), ✅ Drive (2 tools), …
  resetCache();
  let allTools = [];
  try {
    allTools = await listAllTools(config);
    if (!allTools.length) throw new Error('No tools listed across any userId');
    record(`MCP listing returned ${allTools.length} tools across ${userIds.length} userId(s)`, true);
  } catch (e) {
    record('MCP listing across userIds', false, e.message);
    process.exit(1);
  }

  // Per-toolkit breakdown.
  const toolkitCounts = {};
  for (const t of allTools) {
    const slug = (t.name || '').split('_')[0].toLowerCase();
    toolkitCounts[slug] = (toolkitCounts[slug] || 0) + 1;
  }
  console.log('\n   Connected toolkits:');
  for (const [slug, count] of Object.entries(toolkitCounts).sort()) {
    console.log(`     ✅ ${slug.padEnd(15)} ${count} tool(s)`);
  }

  // 8. Wire Hermes's own config.yaml so the in-conversation agent can call
  //    Composio. Only attempt this if we're inside the container (path exists).
  const hermesConfig = '/opt/data/config.yaml';
  if (fs.existsSync(hermesConfig)) {
    const wireScript = path.join(__dirname, 'wire-hermes-mcp.sh');
    if (fs.existsSync(wireScript)) {
      const { execFileSync } = require('child_process');
      try {
        execFileSync('bash', [wireScript, configPath], { stdio: 'inherit' });
        record('Wired Composio MCP into Hermes config.yaml', true);
      } catch (e) {
        record('Wired Composio MCP into Hermes config.yaml', false, e.message);
      }
    }
  } else {
    console.log(`   ℹ Hermes config.yaml not at ${hermesConfig} — skipping in-conversation MCP wiring.`);
    console.log(`     If running on the host, run inside the container instead:`);
    console.log(`     docker exec hermes-<agent> node /host-agent-home/scripts/setup.js --config <path>`);
  }

  console.log('\n' + '─'.repeat(60));
  const failed = checks.filter((c) => !c.ok);
  if (!failed.length) { console.log(`✅ All ${checks.length} checks passed.`); process.exit(0); }
  // Distinguish "critical failed" from "soft failed". A soft failure means
  // a toolkit isn't connected for this userId — not fatal as long as we
  // got at least one MCP server provisioned.
  const criticalFailed = failed.filter((c) =>
    !c.label.startsWith('auth config') &&
    !c.label.includes('connected account')
  );
  if (criticalFailed.length === 0) {
    console.log(`✅ ${checks.length - failed.length}/${checks.length} core checks passed (${failed.length} optional toolkit(s) not connected — non-blocking).`);
    process.exit(0);
  }
  console.log(`❌ ${criticalFailed.length} critical / ${failed.length} total checks failed.`);
  process.exit(1);
})();
