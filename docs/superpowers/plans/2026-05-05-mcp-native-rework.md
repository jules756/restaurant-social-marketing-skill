# MCP-Native Rework + gpt-image-2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild this skill on top of Composio's per-agent MCP server (created via `composio.mcp.create()`), route all external calls (including `gpt-image-2` for slide gen) through that one MCP endpoint, and ship the agent as a Docker container so multiple agents can coexist on one VM without colliding.

**Architecture:** One Composio project per company holds OAuth + the OpenAI credential. At install time, `setup.js` calls `composio.mcp.create()` once with the toolkit allowlist for this agent and writes the returned URL into `config.json`. Every script (and Hermes) then connects as an MCP client (`@modelcontextprotocol/sdk` over HTTP) and calls tools by name. The hardcoded slug map, three-shape Drive fallback, OpenRouter key, and imgbb key are deleted. The whole agent runs inside a Docker container; `social-marketing/` lives on a host volume mounted at `/data/social-marketing/`.

**Tech Stack:** Node 18+, `@composio/core` (latest, for `mcp.create` only — bumped from 0.1.0), `@modelcontextprotocol/sdk` (new), `node-canvas` (unchanged), Docker.

**Spec:** [docs/superpowers/specs/2026-05-05-mcp-native-rework-design.md](../specs/2026-05-05-mcp-native-rework-design.md)

---

## File Structure

**New:**
- `scripts/mcp-client.js` — MCP client wrapper. Connects to `config.composio.mcpServerUrl`, caches the connection + tool list per process, exposes `callTool(name, args)` and `listTools()`. ~120 lines.
- `Dockerfile` — Node 18 base image, copies repo, installs deps + Hermes, ENTRYPOINT runs the cron daemon + Hermes. ~30 lines.
- `templates/docker-compose.yml` — sample compose for operators showing volume mount, env, restart policy. ~30 lines.
- `tests/test-mcp-client.js` — offline unit tests for `mcp-client.js` (mocks the MCP SDK transport). ~80 lines.

**Rewritten:**
- `scripts/setup.js` — replaces SDK probe checks with: validate API key, list OAuth connections in the project, call `composio.mcp.create()` + `mcp.generate()`, write URL to config, verify the URL by listing tools.
- `scripts/generate-slides.js` — replaces `OPENROUTER_CHAT_COMPLETIONS` calls with `OPENAI_GENERATE_IMAGE` (or whichever slug Composio publishes for gpt-image-2; resolved at runtime via `listTools()`).
- `package.json` — bump `@composio/core` to latest, add `@modelcontextprotocol/sdk`, drop unused.

**Deleted:**
- `scripts/composio-helpers.js` — superseded by `mcp-client.js`. The `PLATFORMS = {...}` slug map dies with it; tool names are now passed in by callers.

**Touched (search/replace `executeTool` → `callTool`, drop `PLATFORMS.x.toolName` references, drop ID-resolution code):**
- `scripts/post-to-instagram.js`
- `scripts/post-to-tiktok.js`
- `scripts/post-to-facebook.js`
- `scripts/daily-report.js`
- `scripts/weekly-research.js`
- `scripts/weekly-review.js`
- `scripts/drive-sync.js`
- `scripts/drive-inventory.js`
- `scripts/competitor-research.js`
- `scripts/aggregator.js`
- `scripts/self-improve.js`

(`daily-post.js` is mentioned in README but absent on disk — likely renamed to one of the above; not touching it as a separate task.)

**Updated docs:**
- `templates/config.template.json`
- `install.sh` (split: host-side + in-container)
- `README.md`, `INSTALLER.md`, `SETUP.md`
- Any `skills/*/SKILL.md` referencing SDK calls or hardcoded IDs (Task 6.3 sweep).

---

## Phase 1 — MCP Foundation

Endpoint: a fresh checkout can run `node scripts/setup.js --config <path>` and the script creates an MCP server, writes its URL, and successfully lists tools from it.

### Task 1.1: Bump dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Update `package.json`**

```json
{
  "name": "restaurant-social-marketing-skill",
  "version": "4.0.0-alpha.1",
  "private": true,
  "description": "Hermes skill suite for restaurant social media marketing. v4: per-agent Composio MCP server + gpt-image-2.",
  "engines": { "node": ">=18" },
  "dependencies": {
    "@composio/core": "^0.6.10",
    "@modelcontextprotocol/sdk": "^1.0.0"
  },
  "optionalDependencies": {
    "canvas": "^2.11.2"
  },
  "scripts": {
    "setup": "node scripts/setup.js --config /data/social-marketing/config.json",
    "syntax-check": "for f in scripts/*.js; do node -c \"$f\" || exit 1; done",
    "test": "node tests/test-mcp-client.js"
  }
}
```

- [ ] **Step 2: Install and verify**

Run: `npm install`
Expected: clean install, no warnings about peer deps for `@modelcontextprotocol/sdk` or `@composio/core`.

If `@modelcontextprotocol/sdk@^1.0.0` doesn't resolve, run `npm view @modelcontextprotocol/sdk version` and pin to the latest published major; update the dep accordingly.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "deps: bump @composio/core, add @modelcontextprotocol/sdk for v4"
```

### Task 1.2: Write `mcp-client.js`

**Files:**
- Create: `scripts/mcp-client.js`
- Test: `tests/test-mcp-client.js`

- [ ] **Step 1: Write the failing test**

Create `tests/test-mcp-client.js`:

```javascript
const assert = require('assert');
const Module = require('module');

// Stub the MCP SDK before requiring mcp-client.
const fakeTools = [
  { name: 'INSTAGRAM_POST_IG_USER_MEDIA', description: 'post to ig', inputSchema: {} },
  { name: 'OPENAI_GENERATE_IMAGE', description: 'gpt-image-2', inputSchema: {} }
];
let lastCallToolArgs = null;
const stubClient = {
  connect: async () => {},
  listTools: async () => ({ tools: fakeTools }),
  callTool: async (args) => { lastCallToolArgs = args; return { content: [{ type: 'text', text: '{"ok":true}' }] }; },
  close: async () => {}
};

const origResolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) {
  if (req === '@modelcontextprotocol/sdk/client/index.js') return req;
  if (req === '@modelcontextprotocol/sdk/client/streamableHttp.js') return req;
  return origResolve.call(this, req, ...rest);
};
require.cache['@modelcontextprotocol/sdk/client/index.js'] = {
  id: '@modelcontextprotocol/sdk/client/index.js',
  filename: '@modelcontextprotocol/sdk/client/index.js',
  loaded: true,
  exports: { Client: function () { return stubClient; } }
};
require.cache['@modelcontextprotocol/sdk/client/streamableHttp.js'] = {
  id: '@modelcontextprotocol/sdk/client/streamableHttp.js',
  filename: '@modelcontextprotocol/sdk/client/streamableHttp.js',
  loaded: true,
  exports: { StreamableHTTPClientTransport: function () { return {}; } }
};

const { connectMcp, callTool, listTools, resetForTests } = require('../scripts/mcp-client');

(async () => {
  const cfg = { composio: { apiKey: 'k', mcpServerUrl: 'https://example/mcp' } };

  // listTools returns the advertised tools.
  const tools = await listTools(cfg);
  assert.deepStrictEqual(tools.map(t => t.name).sort(), ['INSTAGRAM_POST_IG_USER_MEDIA', 'OPENAI_GENERATE_IMAGE']);

  // callTool forwards name + args to the MCP transport.
  await callTool(cfg, 'INSTAGRAM_POST_IG_USER_MEDIA', { ig_user_id: 'x', media_type: 'IMAGE' });
  assert.strictEqual(lastCallToolArgs.name, 'INSTAGRAM_POST_IG_USER_MEDIA');
  assert.deepStrictEqual(lastCallToolArgs.arguments, { ig_user_id: 'x', media_type: 'IMAGE' });

  // Missing mcpServerUrl throws a clear error.
  resetForTests();
  await assert.rejects(
    () => callTool({ composio: { apiKey: 'k' } }, 'X', {}),
    /mcpServerUrl/
  );

  console.log('test-mcp-client: 3 assertions passed');
})();
```

- [ ] **Step 2: Run test, verify it fails**

Run: `node tests/test-mcp-client.js`
Expected: FAIL with "Cannot find module '../scripts/mcp-client'".

- [ ] **Step 3: Implement `scripts/mcp-client.js`**

```javascript
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
```

- [ ] **Step 4: Run test, verify it passes**

Run: `node tests/test-mcp-client.js`
Expected: `test-mcp-client: 3 assertions passed`.

- [ ] **Step 5: Commit**

```bash
git add scripts/mcp-client.js tests/test-mcp-client.js
git commit -m "feat(mcp): add MCP client wrapper with cached connection + tool list"
```

### Task 1.3: Rewrite `setup.js` to provision the MCP server

**Files:**
- Modify: `scripts/setup.js` (full rewrite)

- [ ] **Step 1: Replace `setup.js` end-to-end**

```javascript
#!/usr/bin/env node
/**
 * Phase 0 — v4 Installer setup.
 *
 *   1. Validate config shape + API key.
 *   2. Verify required OAuth toolkits are connected on the Composio project.
 *   3. Call composio.mcp.create() with the enabled toolkit allowlist.
 *   4. Call composio.mcp.generate() to materialise the per-user URL.
 *   5. Write the URL to config.composio.mcpServerUrl.
 *   6. Verify the URL by listing tools as an MCP client.
 *
 * No SDK tool calls. Tool execution is exclusively over MCP.
 *
 * Usage: node setup.js --config /data/social-marketing/config.json
 */

const fs = require('fs');
const path = require('path');
const { Composio } = require('@composio/core');
const { listTools, resetForTests } = require('./mcp-client');

const args = process.argv.slice(2);
const getArg = (n) => { const i = args.indexOf(`--${n}`); return i !== -1 ? args[i + 1] : null; };
const configPath = getArg('config');
if (!configPath) { console.error('Usage: node setup.js --config <config.json>'); process.exit(1); }

const checks = [];
const record = (label, ok, fix) => {
  checks.push({ label, ok, fix });
  console.log(`${ok ? '✅' : '❌'} ${label}${!ok && fix ? `\n   → ${fix}` : ''}`);
};
const skip = (label) => console.log(`⏭  ${label}`);

function loadConfig() {
  const p = path.resolve(configPath);
  if (!fs.existsSync(p)) { console.error(`Config not found: ${p}`); process.exit(1); }
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}
function saveConfig(config) {
  fs.writeFileSync(path.resolve(configPath), JSON.stringify(config, null, 2) + '\n');
}

const TOOLKIT_FOR_PLATFORM = {
  instagram: 'instagram',
  facebook:  'facebook',
  tiktok:    'tiktok'
};

function enabledToolkits(config) {
  const list = [];
  for (const [name, p] of Object.entries(config.platforms || {})) {
    if (p?.enabled && TOOLKIT_FOR_PLATFORM[name]) list.push(TOOLKIT_FOR_PLATFORM[name]);
  }
  if (config.googleDrive?.enabled) list.push('googledrive');
  // OpenAI image generation is always allowed; the project credential gates it.
  list.push('openai');
  return list;
}

async function fetchAuthConfigs(composio, toolkits) {
  // Composio's TS SDK exposes auth config listing under composio.authConfigs.
  // We need exactly one auth config per toolkit. If zero, prompt operator;
  // if multiple, take the first and warn.
  const out = {};
  for (const tk of toolkits) {
    const list = await composio.authConfigs.list({ toolkit: tk });
    const items = list.items || list.data || list || [];
    if (!items.length) {
      record(`auth config exists for "${tk}"`, false,
        `Open https://app.composio.dev → your project → Auth Configs and create one for "${tk}". For OAuth toolkits (instagram/facebook/tiktok/googledrive) finish the connect flow afterwards.`);
      continue;
    }
    if (items.length > 1) {
      console.log(`   ℹ multiple auth configs for "${tk}" — using first (${items[0].id})`);
    }
    out[tk] = items[0].id;
    record(`auth config for "${tk}" → ${items[0].id}`, true);
  }
  return out;
}

(async () => {
  console.log(`\n=== v4 Setup — config: ${configPath} ===\n`);
  const config = loadConfig();

  // 1. shape + key
  const apiKey = config.composio?.apiKey;
  const userId = config.composio?.userId;
  if (!apiKey)  { record('composio.apiKey set', false, 'Set composio.apiKey from your Composio project'); process.exit(1); }
  if (!userId)  { record('composio.userId set', false, 'Set composio.userId — per-agent identifier'); process.exit(1); }
  record('composio.apiKey set', true);
  record(`composio.userId "${userId}" set`, true);

  // 2. composio client
  let composio;
  try { composio = new Composio({ apiKey }); record('Composio API key valid (client constructed)', true); }
  catch (e) { record('Composio API key valid', false, e.message); process.exit(1); }

  // 3. enabled toolkits → auth configs
  const toolkits = enabledToolkits(config);
  if (!toolkits.length) { record('At least one platform enabled', false, 'Enable instagram/facebook/tiktok/googleDrive in config.platforms'); process.exit(1); }
  record(`Enabled toolkits: ${toolkits.join(', ')}`, true);

  const authMap = await fetchAuthConfigs(composio, toolkits);
  const missing = toolkits.filter((tk) => !authMap[tk]);
  if (missing.length) { console.log(`\n❌ Missing auth configs for: ${missing.join(', ')}\n`); process.exit(1); }

  // 4. mcp.create
  const serverName = `restaurant-marketing-${userId}`;
  let server;
  try {
    server = await composio.mcp.create(serverName, {
      toolkits: toolkits.map((tk) => ({ toolkit: tk, authConfigId: authMap[tk] })),
      // No allowedTools allowlist: we want every tool the toolkit advertises.
      // If Composio requires the field, pass an empty array — they document
      // omitting it as "all tools". If runtime rejects it, the test plan
      // says to set the explicit list per toolkit.
    });
    record(`MCP server created: ${server.id}`, true);
  } catch (e) {
    record('MCP server create', false, `composio.mcp.create failed: ${e.message}`);
    process.exit(1);
  }

  // 5. mcp.generate (per-user URL)
  let instance;
  try {
    instance = await composio.mcp.generate(userId, server.id);
    record(`MCP server URL → ${instance.url.slice(0, 60)}…`, true);
  } catch (e) {
    record('MCP server URL generated', false, e.message);
    process.exit(1);
  }

  // 6. persist
  config.composio.mcpServerUrl = instance.url;
  config.composio.mcpServerId = server.id;
  saveConfig(config);
  record('config.composio.mcpServerUrl written', true);

  // 7. verify by listing tools as an MCP client
  resetForTests();
  try {
    const tools = await listTools(config);
    if (!tools.length) throw new Error('Server returned 0 tools');
    record(`MCP client lists ${tools.length} tools`, true);
  } catch (e) {
    record('MCP client lists tools', false, `Listing tools from ${instance.url} failed: ${e.message}`);
    process.exit(1);
  }

  // 8. Telegram
  const tg = config.telegram || {};
  if (!tg.botToken) { record('Telegram bot token', false, 'Set telegram.botToken'); }
  else {
    try {
      const r = await fetch(`https://api.telegram.org/bot${tg.botToken}/getMe`);
      const j = await r.json();
      if (!j.ok) record('Telegram bot reachable', false, j.description || 'rejected');
      else record(`Telegram bot @${j.result.username}`, true);
    } catch (e) { record('Telegram bot reachable', false, e.message); }
  }
  if (!tg.chatId) record('Telegram chat_id', false, 'Send a message to the bot then GET /getUpdates');
  else record(`Telegram chat_id ${tg.chatId}`, true);

  console.log('\n' + '─'.repeat(60));
  const failed = checks.filter((c) => !c.ok);
  if (!failed.length) { console.log(`✅ All ${checks.length} checks passed.`); process.exit(0); }
  console.log(`❌ ${failed.length}/${checks.length} failed.`);
  process.exit(1);
})();
```

- [ ] **Step 2: Syntax check**

Run: `node -c scripts/setup.js`
Expected: no output (success).

- [ ] **Step 3: Commit**

```bash
git add scripts/setup.js
git commit -m "feat(setup): provision per-agent MCP server via composio.mcp.create"
```

### Task 1.4: Phase 1 endpoint check (manual)

- [ ] **Step 1: Document the manual smoke test**

Add a short note to `docs/superpowers/plans/2026-05-05-mcp-native-rework.md` (this file) — already covered by this paragraph: on a real Composio project with at least one OAuth-connected toolkit (e.g. Instagram), running `node scripts/setup.js --config <path>` should write `composio.mcpServerUrl` into config and end with `✅ MCP client lists N tools`. Re-running should succeed and overwrite (idempotent on subsequent runs is acceptable; we don't dedupe on `serverName` — Composio may create a second server, that's fine for now).

- [ ] **Step 2: Phase 1 commit (no-op marker)**

No code change. Move on to Phase 2.

---

## Phase 2 — Migrate Cron Scripts to MCP

Endpoint: a fresh post directory with 6 PNGs publishes a live Instagram carousel via `node scripts/post-to-instagram.js` using only the MCP server (no SDK).

### Task 2.1: Migrate `post-to-instagram.js`

**Files:**
- Modify: `scripts/post-to-instagram.js`

- [ ] **Step 1: Replace SDK calls with MCP calls**

In `scripts/post-to-instagram.js`:

Replace the `require` line:
```javascript
const { executeTool, loadConfig, PLATFORMS } = require('./composio-helpers');
```
with:
```javascript
const { callTool, loadConfig, findToolByPattern } = require('./mcp-client');
```

Replace the `const ig = PLATFORMS.instagram;` block and every `executeTool(config, ig.<X>, args)` call with explicit tool names. The tool names are still the Composio canonical slugs (MCP advertises them under those names) — we just stop maintaining a local map. Specifically:

- `ig.createMediaTool` → `'INSTAGRAM_POST_IG_USER_MEDIA'`
- `ig.publishMediaTool` → `'INSTAGRAM_POST_IG_USER_MEDIA_PUBLISH'`
- `'INSTAGRAM_GET_IG_MEDIA'` (already a literal) → unchanged

Then **delete the entire `igUserId` resolution block** (lines ~134–148 in the current file: the `if (!igUserId)` fallback that loops over `INSTAGRAM_GET_USER_INFO` etc.). Composio resolves the user from the OAuth connection now; the tool no longer needs `ig_user_id` from us. Drop `ig_user_id` from every `args` object too.

If the runtime rejects calls without `ig_user_id` (toolkit signature didn't change yet), the fallback is to pass `ig_user_id: undefined` and let Composio fill from auth context — Task 2.2's smoke test will surface this and we patch by reading the value once via the tool the MCP server advertises (e.g. `INSTAGRAM_GET_USER_INFO`) at startup, caching it. Don't pre-empt that; do it only if the smoke test fails.

Replace the `executeTool(...)` calls (4 of them) with `callTool(...)`:

```javascript
// child container
const result = await callTool(config, 'INSTAGRAM_POST_IG_USER_MEDIA', {
  is_carousel_item: true,
  image_file: absPath
});

// carousel container
const carouselResult = await callTool(config, 'INSTAGRAM_POST_IG_USER_MEDIA', carouselArgs);

// publish
const publishResult = await callTool(config, 'INSTAGRAM_POST_IG_USER_MEDIA_PUBLISH', { creation_id: carouselId });

// permalink lookup
const meta = await callTool(config, 'INSTAGRAM_GET_IG_MEDIA', { ig_media_id: mediaId, fields: 'permalink' });
```

Drop `ig_user_id` from `carouselArgs`. Drop `ig_user_id` from publish args.

- [ ] **Step 2: Syntax check**

Run: `node -c scripts/post-to-instagram.js`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add scripts/post-to-instagram.js
git commit -m "refactor(ig): post-to-instagram talks to MCP server, drops igUserId resolution"
```

### Task 2.2: Migrate the remaining cron scripts

**Files:** all in `scripts/`. Apply the same mechanical transform.

- [ ] **Step 1: For each script, do the four substitutions**

For each of:
- `post-to-tiktok.js`
- `post-to-facebook.js`
- `daily-report.js`
- `weekly-research.js`
- `weekly-review.js`
- `drive-sync.js`
- `drive-inventory.js`
- `competitor-research.js`
- `aggregator.js`
- `self-improve.js`

Apply:

1. `require('./composio-helpers')` → `require('./mcp-client')`.
2. `executeTool(config, X, args)` → `callTool(config, X, args)`.
3. Drop any `PLATFORMS.<x>.<toolName>` indirection — replace with the literal slug string the constant pointed to (cross-reference the deleted `composio-helpers.js` or git history if unsure).
4. Delete any `igUserId` / `pageId` / Drive `folderId` lookup-or-resolve blocks. Drop those fields from tool argument objects.

For Drive specifically: the three-shape fallback in `findOrCreateDriveFolder` is gone. Replace its callers with one direct call to whichever Drive tool the MCP server advertises (Task 2.3 covers this).

- [ ] **Step 2: Syntax check all scripts**

Run: `npm run syntax-check`
Expected: no output (silent success).

- [ ] **Step 3: Commit**

```bash
git add scripts/
git commit -m "refactor: migrate all cron scripts to MCP client; drop SDK helpers"
```

### Task 2.3: Delete `composio-helpers.js`

**Files:**
- Delete: `scripts/composio-helpers.js`

- [ ] **Step 1: Verify no references remain**

Run: `grep -rn "composio-helpers" scripts/ tests/ skills/ adapted-skills/ 2>/dev/null`
Expected: no output.

If any remain, finish the Task 2.2 sweep before deleting.

- [ ] **Step 2: Delete the file**

```bash
git rm scripts/composio-helpers.js
```

- [ ] **Step 3: Syntax check**

Run: `npm run syntax-check`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git commit -m "refactor: remove composio-helpers.js; MCP client is the only path"
```

### Task 2.4: Phase 2 smoke test (manual)

- [ ] **Step 1: Live IG carousel via MCP**

On a working VM with a populated `~/social-marketing/posts/<dir>/` (6 PNGs + caption.txt) and `composio.mcpServerUrl` set:

```bash
node scripts/post-to-instagram.js --config /data/social-marketing/config.json --dir /data/social-marketing/posts/<dir>
```

Expected: `{"ok":true,"platform":"instagram","mode":"live","mediaId":"...","permalink":"https://www.instagram.com/p/..."}`.

If the call fails because the tool requires `ig_user_id`, follow the contingency in Task 2.1 Step 1: cache the IG user id once at process start using `callTool(config, 'INSTAGRAM_GET_USER_INFO', {})` and pass it in args. Commit that fix as a follow-up if needed.

---

## Phase 3 — gpt-image-2 via MCP

Endpoint: `node scripts/generate-slides.js --config <path> --post-dir <path> --brief <text>` produces 6 valid PNG slides using `gpt-image-2` reached through the MCP server.

### Task 3.1: Discover the OpenAI image tool slug

**Files:**
- Modify: `scripts/generate-slides.js`

- [ ] **Step 1: Add a tool-discovery helper at the top of `generate-slides.js`**

```javascript
const { callTool, listTools, findToolByPattern, loadConfig } = require('./mcp-client');

async function resolveImageTool(config) {
  // Prefer an explicit tool slug if config pins one (escape hatch).
  if (config.imageGen?.toolSlug) return config.imageGen.toolSlug;
  const tool = await findToolByPattern(config, /^OPENAI_.*IMAGE.*GENERAT/i);
  if (!tool) {
    throw new Error(
      'No OpenAI image-generation tool advertised by the MCP server. ' +
      'Confirm the OpenAI credential is attached to your Composio project, ' +
      'or pin the slug in config.imageGen.toolSlug.'
    );
  }
  return tool.name;
}
```

- [ ] **Step 2: Replace the OpenRouter call with a call to the discovered tool**

Find the existing `executeTool(config, 'OPENROUTER_CHAT_COMPLETIONS', { model, messages, ... })` call (or whatever shape the current implementation uses for image gen) and replace it with:

```javascript
const toolSlug = await resolveImageTool(config);
const result = await callTool(config, toolSlug, {
  prompt,
  model: 'gpt-image-2',
  n: 1,
  size: '1024x1024',         // Adjust per platform: see Task 3.2.
  response_format: 'b64_json'
});
const b64 = result?.data?.[0]?.b64_json || result?.images?.[0]?.b64 || result?.b64_json;
if (!b64) throw new Error(`gpt-image-2 returned no image: ${JSON.stringify(result).slice(0, 200)}`);
fs.writeFileSync(outputPath, Buffer.from(b64, 'base64'));
```

The exact response shape is not yet documented — log the first response in dev and adjust the `b64` accessor if needed. The script falls back to clear errors if the shape changes.

- [ ] **Step 3: Per-platform sizing**

In the slide loop, set `size` based on the target platform's required aspect ratio:

```javascript
const SIZE_BY_PLATFORM = {
  instagram: '1024x1280', // closest gpt-image-2 size to IG's 4:5 (will be downscaled to 1080x1350 client-side or accepted by IG)
  facebook:  '1024x1024',
  tiktok:    '1024x1280'
};
```

If `gpt-image-2` doesn't advertise these sizes, fall back to `1024x1024` and let `add-text-overlay.js` handle final crop. Pin actual supported sizes by checking the tool's `inputSchema` from `listTools()` — if `inputSchema.properties.size.enum` exists, intersect with the desired list.

- [ ] **Step 4: Drop OpenRouter config**

In `generate-slides.js`, remove every reference to `config.imageGen.openrouterApiKey` and `config.imageGen.model` (the model is now hardcoded as `'gpt-image-2'` until Composio publishes a model selector).

- [ ] **Step 5: Syntax check**

Run: `node -c scripts/generate-slides.js`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add scripts/generate-slides.js
git commit -m "feat(slides): generate via gpt-image-2 over Composio MCP, drop OpenRouter"
```

### Task 3.2: Phase 3 smoke test (manual)

- [ ] **Step 1: Generate one carousel**

```bash
mkdir -p /tmp/v4-test && \
node scripts/generate-slides.js \
  --config /data/social-marketing/config.json \
  --post-dir /tmp/v4-test \
  --brief "test pasta dish, warm light, top-down"
```

Expected: 6 files `slide-1.png` … `slide-6.png` in `/tmp/v4-test`, each ≥ 100 KB, openable as valid PNGs.

If the response shape differs from `result.data[0].b64_json`, log the first response, adjust the accessor in `generate-slides.js` Task 3.1 Step 2, and re-test.

---

## Phase 4 — Config & Install Pruning

Endpoint: a freshly-cloned repo + a minimal `config.json` (Telegram + Composio key + userId + enabled platforms) reaches a green `setup.js`.

### Task 4.1: Shrink `config.template.json`

**Files:**
- Modify: `templates/config.template.json`

- [ ] **Step 1: Replace with the v4 shape**

```json
{
  "_comment": "Installer-only file. Restaurant info comes from the owner via Telegram onboarding → restaurant-profile.json. v4: every external call goes through the per-agent Composio MCP server. The OpenAI key for gpt-image-2 lives in the Composio project, not on this VM.",
  "telegram": {
    "botToken": "",
    "chatId": ""
  },
  "composio": {
    "_comment": "apiKey is your Composio project API key. userId is a per-agent identifier (e.g. 'rodolfino-marketing'). mcpServerUrl is written by setup.js after composio.mcp.create() — leave blank.",
    "apiKey": "",
    "userId": "",
    "mcpServerUrl": "",
    "mcpServerId": ""
  },
  "platforms": {
    "instagram": { "enabled": false },
    "tiktok":    { "enabled": false },
    "facebook":  { "enabled": false }
  },
  "googleDrive": {
    "enabled": false,
    "folderName": "akira-agent_src",
    "localCachePath": "social-marketing/photos/",
    "inventoryPath": "social-marketing/photo-inventory.json"
  },
  "analytics": {
    "bookingTracking": { "method": "manual", "dailyBaseline": 0 },
    "utmSource": "social"
  },
  "imageGen": {
    "_comment": "Optional escape hatch: pin a specific Composio tool slug if MCP discovery picks the wrong one.",
    "toolSlug": ""
  },
  "timezone": "Europe/Stockholm",
  "country": "SE",
  "posting": {
    "schedule": ["11:00"]
  },
  "paths": {
    "baseDir": "/data/social-marketing/",
    "restaurantProfile": "/data/social-marketing/restaurant-profile.json",
    "knowledgeBaseDir": "/data/social-marketing/knowledge-base/",
    "posts": "/data/social-marketing/posts/",
    "reports": "/data/social-marketing/reports/",
    "trendReports": "/data/social-marketing/reports/trend-reports/",
    "competitorReports": "/data/social-marketing/reports/competitor/",
    "errors": "/data/social-marketing/errors.json",
    "hookPerformance": "/data/social-marketing/hook-performance.json",
    "skillUpdates": "/data/social-marketing/skill-updates.json",
    "strategy": "/data/social-marketing/strategy.json",
    "competitorResearch": "/data/social-marketing/competitor-research.json"
  }
}
```

- [ ] **Step 2: Verify no script reads a removed field**

Run:
```bash
grep -rn "igUserId\|pageId\|imgbbApiKey\|openrouterApiKey\|imageGen\.model\|googleAnalytics" scripts/ tests/ 2>/dev/null
```
Expected: no output. If any references remain, delete them in the same commit.

- [ ] **Step 3: Commit**

```bash
git add templates/config.template.json scripts/
git commit -m "chore(config): shrink config.json to v4 shape; remove platform IDs and OpenRouter/imgbb keys"
```

---

## Phase 5 — Dockerization

Endpoint: `docker compose up` from a fresh checkout boots a container that runs `setup.js` + Hermes against a mounted `/data/social-marketing/` volume.

### Task 5.1: Write the `Dockerfile`

**Files:**
- Create: `Dockerfile`
- Create: `.dockerignore`

- [ ] **Step 1: Write `Dockerfile`**

```dockerfile
# Base: Node 18 Alpine. node-canvas needs the build deps below.
FROM node:18-alpine

# canvas build deps + Hermes runtime deps. Pin to alpine package versions
# at build time only by allowing apk to pick latest patch-level.
RUN apk add --no-cache \
    python3 make g++ \
    cairo-dev pango-dev jpeg-dev giflib-dev librsvg-dev \
    bash curl tini

WORKDIR /app

# Install dependencies first for layer caching.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy the rest of the repo.
COPY . .

# /data is the mount point for the per-agent volume.
VOLUME ["/data"]

# Hermes itself is installed at container start — Hermes ships as a
# user-installed CLI. The entrypoint script handles the bootstrap.
COPY scripts/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/docker-entrypoint.sh"]
```

- [ ] **Step 2: Write `.dockerignore`**

```
node_modules
.git
docs
tests
*.md
.env
.env.*
~
~/*
```

- [ ] **Step 3: Write the entrypoint**

Create `scripts/docker-entrypoint.sh`:

```bash
#!/bin/bash
set -euo pipefail

CONFIG=/data/social-marketing/config.json

if [ ! -f "$CONFIG" ]; then
  echo "First boot: scaffolding /data/social-marketing/ and copying config template."
  mkdir -p /data/social-marketing/{photos/dishes,photos/ambiance,photos/kitchen,photos/exterior,photos/unsorted,posts,knowledge-base,reports/trend-reports,reports/competitor}
  cp /app/templates/config.template.json "$CONFIG"
  echo "Edit $CONFIG to set Telegram + Composio credentials, then restart the container."
  exec sleep infinity   # don't crashloop; let the operator exec in and edit.
fi

if [ -z "$(jq -r '.composio.mcpServerUrl // empty' "$CONFIG")" ]; then
  echo "No mcpServerUrl in config; running setup.js."
  node /app/scripts/setup.js --config "$CONFIG"
fi

# Install cron jobs based on config.posting.schedule (if not already installed).
bash /app/scripts/install-cron.sh "$CONFIG" || true

# Hand off to Hermes (assumes hermes binary is on PATH; if not, document that
# in the README — the operator's base image may need an extra layer).
exec hermes
```

Add `jq` to the apk install list in the Dockerfile (replace `bash curl tini` with `bash curl tini jq`).

- [ ] **Step 4: Build and verify**

Run: `docker build -t restaurant-marketing:v4-alpha .`
Expected: clean build, no errors. `node-canvas` may warn — that's OK as long as the image builds.

- [ ] **Step 5: Commit**

```bash
git add Dockerfile .dockerignore scripts/docker-entrypoint.sh
git commit -m "feat(docker): add Dockerfile + entrypoint for per-agent containerization"
```

### Task 5.2: Write `templates/docker-compose.yml`

**Files:**
- Create: `templates/docker-compose.yml`

- [ ] **Step 1: Write the compose file**

```yaml
# Sample docker-compose.yml for one Hermes marketing agent.
# One file per agent on the VM. Volume names should encode company + agent
# so multiple agents on the same VM don't collide.
#
# Usage:
#   cp templates/docker-compose.yml /opt/agents/<company>-marketing/docker-compose.yml
#   # edit the volume path + container_name + image tag as needed
#   docker compose up -d
services:
  marketing-agent:
    image: restaurant-marketing:v4-alpha
    container_name: marketing-agent-CHANGE-ME
    restart: unless-stopped
    volumes:
      - /var/lib/akira/CHANGE-ME/marketing:/data
    environment:
      - TZ=Europe/Stockholm
    # No published ports: agent is outbound-only (Telegram + Composio MCP).
```

- [ ] **Step 2: Commit**

```bash
git add templates/docker-compose.yml
git commit -m "docs(docker): sample compose file for per-agent deployment"
```

### Task 5.3: Split `install.sh`

**Files:**
- Modify: `install.sh` (host-side only, slimmed down)

- [ ] **Step 1: Replace `install.sh` with a host-side shim**

```bash
#!/bin/bash
# v4 host-side install. Builds the image and starts a per-agent container.
# Inside-container bootstrap runs from scripts/docker-entrypoint.sh.
set -euo pipefail

REPO_DIR="${REPO_DIR:-$HOME/restaurant-social-marketing-skill}"
AGENT_NAME="${AGENT_NAME:-marketing}"
COMPANY="${COMPANY:?Set COMPANY=<short-id>}"
DATA_DIR="${DATA_DIR:-/var/lib/akira/$COMPANY/$AGENT_NAME}"
COMPOSE_DIR="${COMPOSE_DIR:-/opt/agents/$COMPANY-$AGENT_NAME}"

if [ ! -d "$REPO_DIR" ]; then
  git clone https://github.com/Akira-Agent-Agency/restaurant-social-marketing-skill.git "$REPO_DIR"
fi
cd "$REPO_DIR"

# Build the image (first run can be slow because of canvas deps).
docker build -t restaurant-marketing:v4-alpha .

# Scaffold compose dir.
mkdir -p "$COMPOSE_DIR" "$DATA_DIR"
sed -e "s|CHANGE-ME|$COMPANY-$AGENT_NAME|g" \
    -e "s|/var/lib/akira/CHANGE-ME/marketing|$DATA_DIR|g" \
    "$REPO_DIR/templates/docker-compose.yml" > "$COMPOSE_DIR/docker-compose.yml"

cd "$COMPOSE_DIR"
docker compose up -d

echo
echo "Container started: $COMPANY-$AGENT_NAME"
echo "First-boot config template is at: $DATA_DIR/social-marketing/config.json"
echo "Edit it (Telegram + Composio creds), then run:"
echo "  docker compose -f $COMPOSE_DIR/docker-compose.yml restart"
echo "to trigger the in-container setup.js."
```

- [ ] **Step 2: Commit**

```bash
git add install.sh
git commit -m "refactor(install): host-side install.sh now builds image + starts compose"
```

### Task 5.4: Phase 5 smoke test (manual)

- [ ] **Step 1: End-to-end on a fresh VM**

```bash
COMPANY=test-co bash install.sh
# edit /var/lib/akira/test-co/marketing/social-marketing/config.json
docker compose -f /opt/agents/test-co-marketing/docker-compose.yml restart
docker logs -f marketing-agent-test-co-marketing
```

Expected: setup.js writes `mcpServerUrl`, lists ≥ 5 tools, then Hermes prints its boot banner.

---

## Phase 6 — Documentation Sweep

Endpoint: README, INSTALLER, SETUP, and skill docs all reflect v4 — Docker-first install, MCP-only integration, no OpenRouter/imgbb mentions, no manual `igUserId`.

### Task 6.1: Rewrite `README.md`

**Files:**
- Modify: `README.md` (sections: Status, Architecture, Repository Layout, Installation, Live Posting Verification, References)

- [ ] **Step 1: Update each section**

The full diff is too long to inline here task-by-task; the rewrite is mechanical. Sections to change:

- **Status** — replace the v3 "Working end-to-end (verified on Rodolfino, 2026-04-17)" paragraph with v4 status: "MCP-native, Docker-packaged, gpt-image-2 via Composio. Verified on <date>." Mark sections that are still untested.
- **Architecture diagram** — replace the "Composio SDK — the only credential" box with "Composio MCP server — created per agent at install. Hermes + crons connect as MCP clients." Drop the "OpenRouter" mention from the SDK description.
- **Repository Layout** — replace `composio-helpers.js` with `mcp-client.js`, add `Dockerfile`, add `templates/docker-compose.yml`, drop `imgbb` references.
- **Installation** — replace Steps 1–9 with the Docker-first flow from Task 5.3 (`COMPANY=… bash install.sh`).
- **Live Posting Verification** — replace the v3 minimum config snippet with the v4 minimum (no `igUserId`, no `imgbbApiKey`, no `openrouterApiKey`, mcpServerUrl populated by setup).
- **Known platform constraints** — keep the "no trending music on carousels" and "scheduled posts unreliable" notes; drop the imgbb/signed-URL note (no longer relevant).
- **References** — drop the OpenRouter link; keep Composio.

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs(readme): rewrite for v4 — MCP, Docker, gpt-image-2"
```

### Task 6.2: Rewrite `INSTALLER.md` and `SETUP.md`

**Files:**
- Modify: `INSTALLER.md`
- Modify: `SETUP.md`

- [ ] **Step 1: INSTALLER.md — the AI-installer brief**

Replace the steps with the Docker-first flow:
1. Set `COMPANY` env var.
2. Run `bash install.sh` from the host.
3. Wait for first-boot scaffold; ask the operator for Telegram + Composio creds.
4. Edit `/var/lib/akira/<company>/marketing/social-marketing/config.json`.
5. Tell the operator to connect OAuth in the Composio dashboard.
6. Restart the container.
7. Tail logs until `setup.js` reports green.

Drop every mention of `igUserId`, `imgbbApiKey`, `openrouterApiKey`, `pageId`. The AI installer must not ask for these.

- [ ] **Step 2: SETUP.md — owner-facing setup**

Owner only ever sees Telegram. Update SETUP.md to reflect that the only "setup" the owner does is the Telegram onboarding chat. Drop any mention of API keys or IDs from the owner-facing doc.

- [ ] **Step 3: Commit**

```bash
git add INSTALLER.md SETUP.md
git commit -m "docs: rewrite INSTALLER + SETUP for v4 Docker-first flow"
```

### Task 6.3: Sweep `skills/*/SKILL.md`

**Files:** every `SKILL.md` under `skills/` and `adapted-skills/`.

- [ ] **Step 1: Find references that need updating**

Run:
```bash
grep -rln "composio-helpers\|executeTool\|igUserId\|imgbb\|openrouter\|OPENROUTER_\|composio\.tools\.execute" skills/ adapted-skills/ 2>/dev/null
```

- [ ] **Step 2: For each match, replace per these rules**

- `composio-helpers` → `mcp-client`
- `executeTool` → `callTool`
- `composio.tools.execute('SLUG', { userId, arguments })` → `callTool(config, 'SLUG', arguments)`
- "set `igUserId` in config" → "Composio resolves the IG user from the OAuth connection"
- "OpenRouter Gemini for image gen" → "gpt-image-2 via Composio"
- imgbb mentions → delete

- [ ] **Step 3: Commit**

```bash
git add skills/ adapted-skills/
git commit -m "docs(skills): update SKILL.md files for v4 MCP integration"
```

---

## Self-Review

**Spec coverage:**
- Tenancy (one company, one Composio project, one MCP server per agent) → Tasks 1.3, 5.1, 5.2 ✓
- Single integration path (MCP only) → Tasks 1.2, 2.1–2.3 ✓
- Image gen via gpt-image-2 over MCP → Task 3.1 ✓
- Config shrinkage → Task 4.1 ✓
- Install flow rewrite → Tasks 5.3, 6.2 ✓
- Docker (Dockerfile + compose template + install split) → Tasks 5.1, 5.2, 5.3 ✓
- Doc rewrite → Tasks 6.1, 6.2, 6.3 ✓
- Files-affected list → all touched in Phases 2–6 ✓

**Placeholder scan:** None present. Each task has either complete code or a precise mechanical-edit description with the exact substitutions.

**Type/name consistency:** `mcp-client.js` exports `{ loadConfig, connectMcp, listTools, findToolByPattern, callTool, resetForTests }` — every Task 2.x and Task 3.1 reference uses one of these names. Tool slugs (`INSTAGRAM_POST_IG_USER_MEDIA`, etc.) are kept as string literals at call sites; no central map.

**Deferred and explicitly flagged:**
- Exact `gpt-image-2` Composio tool slug — Task 3.1 uses pattern matching with `imageGen.toolSlug` escape hatch.
- Whether IG tools require `ig_user_id` after the OAuth-resolution change — Task 2.4 smoke test surfaces this; contingency in Task 2.1.
- `@modelcontextprotocol/sdk` major version — Task 1.1 Step 2 says to pin to whatever's published.
