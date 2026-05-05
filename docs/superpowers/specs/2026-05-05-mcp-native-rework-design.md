# Restaurant Marketing Skill v4 — MCP-native + gpt-image-2

**Date:** 2026-05-05
**Status:** Approved design, pending user review of written spec
**Supersedes:** v3 README architecture (Composio SDK + OpenRouter Gemini)

## Why this rework

v3 used the Composio SDK (`composio.tools.execute('SLUG', { userId, arguments })`)
because the MCP-server feature didn't yet support programmatic creation. That
forced us to:

- Hardcode tool slugs (`INSTAGRAM_POST_IG_USER_MEDIA`, `GOOGLEDRIVE_LIST_FILES`, …).
- Hand-resolve and store IDs in `config.json` (`igUserId`, `pageId`, Drive folder IDs).
- Maintain three-shape fallbacks (`{q}` / `{query}` / `{search_query}`) per call
  because the script didn't know which schema the tool wanted.
- Run a side-channel for image gen (OpenRouter Gemini) and image hosting (imgbb),
  each with its own API key on the VM.

Composio now ships [single-toolkit MCP](https://docs.composio.dev/docs/single-toolkit-mcp)
with `composio.mcp.create()`. One SDK call returns a per-project MCP server URL.
Hermes connects to it natively; tool schemas are advertised, not hardcoded.

## Tenancy & lifecycle

- **One company = one Composio project.** OAuth connections (Instagram, Facebook,
  TikTok, Google Drive) are authorized once per company in the Composio dashboard
  and reused across every Hermes agent the company deploys.
- **One Hermes agent = one Docker container = one MCP server**, scoped to the
  company's project but with its own toolkit allowlist. The marketing agent gets
  Instagram/Facebook/TikTok/Drive/gpt-image-2; a future reservations agent on the
  same VM would get a different allowlist on its own MCP server.
- The MCP server is created **once at install time** via `composio.mcp.create()`.
  The returned URL is written to `config.json` and read by Hermes + every cron
  script inside the container.
- The VM hosts multiple agent containers; `social-marketing/` is a Docker volume
  mounted into the marketing-agent container only.
- Re-running `install.sh` replaces the MCP server. Cleaning up the old server in
  the Composio dashboard is the operator's responsibility (we do not auto-delete).

## Integration surface

**Single path: MCP.** No SDK calls anywhere except the one-shot
`composio.mcp.create()` in `setup.js`.

- `scripts/composio-helpers.js` is replaced by `scripts/mcp-client.js` — a thin
  MCP client wrapper that connects to the URL in `config.json`, lists tools on
  first call (cached for the process lifetime), and exposes `callTool(name, args)`.
- The hardcoded `PLATFORMS = { ... }` slug map is **deleted**. Tool names are
  discovered from the MCP server's tool list at runtime.
- The three-shape Drive folder fallback is **deleted**. MCP advertises the
  schema; we send the documented arguments.
- `igUserId`, `pageId`, and Drive folder IDs are **removed from `config.json`**.
  Composio resolves these from the OAuth connection on the server side.

## Image generation

- OpenRouter Gemini is removed. `imageGen.openrouterApiKey` and
  `imageHost.imgbbApiKey` are deleted from `config.json`.
- `scripts/generate-slides.js` calls **gpt-image-2 via the Composio MCP server**.
  The exact tool slug is discovered at runtime (`tools/list`); the operator
  never sees it.
- The OpenAI API key lives in Composio as a project-scoped credential. The VM
  never holds it.
- Carousel generation loop is unchanged (6 slides for IG, 1 for FB, etc.) —
  only the underlying tool call changes.
- Image-host bypass for Instagram is no longer needed: Composio's MCP tool
  for Instagram posting accepts an `image_file` path and handles hosting
  server-side, the same as today's SDK behavior.

## config.json after the rework

```json
{
  "telegram":  { "botToken": "", "chatId": "" },
  "composio":  { "apiKey": "", "userId": "", "mcpServerUrl": "" },
  "platforms": {
    "instagram": { "enabled": true },
    "tiktok":    { "enabled": false },
    "facebook":  { "enabled": false }
  },
  "googleDrive": { "enabled": false, "folderName": "akira-agent_src" },
  "timezone": "Europe/Stockholm",
  "country":  "SE",
  "posting":  { "schedule": ["11:00"] },
  "paths":    { "...": "unchanged" }
}
```

Removed fields:

- `platforms.instagram.igUserId`
- `platforms.facebook.pageId`
- `platforms.googleAnalytics`
- `imageGen.model`, `imageGen.openrouterApiKey`
- `imageHost.imgbbApiKey`
- `analytics.googleAnalytics`

Composio owns every one of these now.

## Install flow

The install runs **inside the marketing-agent's Docker container**, not on the
VM host. The host owns: the VM, the Docker engine, and the per-agent volume
mounts (one volume per agent). Everything else — Node, the repo, Hermes,
the cron daemon, `social-marketing/` — lives inside the container.

Practically:

- The VM host has a `docker compose` file (or equivalent) that defines the
  marketing-agent service: image, volume mount for `social-marketing/`,
  env vars, restart policy.
- The container image is built from a `Dockerfile` in this repo (Node base
  image + Hermes + this skill's scripts). `install.sh` runs **inside** the
  container during build or first boot, not on the host.
- `~/social-marketing/` from the v3 docs becomes `/data/social-marketing/`
  inside the container, mounted from a host volume named after the agent
  (e.g. `/var/lib/akira/<company>/marketing/`).
- The MCP server URL written to `config.json` is reached from inside the
  container over outbound HTTPS — no inbound port, no host networking.

Steps (inside the container, or scripted at image build):

1. Clone repo, `npm install` — unchanged.
2. Copy skills into `~/.hermes/skills/social-media/` — unchanged.
3. Scaffold `/data/social-marketing/` working directory — unchanged in shape,
   path moves under the volume mount.
4. Fill `config.json` — **shrinks to**: Telegram bot token + chat ID, Composio
   API key + userId, and which platforms are enabled. That is all.
5. Operator goes to the Composio dashboard once and connects OAuth for each
   enabled platform under the company project (Instagram, Facebook, TikTok,
   Google Drive). The OpenAI credential for gpt-image-2 is also added there.
   This is a host-side / browser-side action; no container involvement.
6. Inside the container, run `node scripts/setup.js --config /data/social-marketing/config.json`. This:
   - Validates the Composio API key.
   - Verifies OAuth is connected for each enabled platform.
   - Calls `composio.mcp.create()` with the enabled toolkits' allowlists.
   - Writes the returned MCP server URL into `config.json` under `composio.mcpServerUrl`.
   - Confirms Hermes can connect to the URL and list tools.
7. Start Hermes (the container's default command); hand the Telegram bot to the owner.

The 17-digit Instagram Business Account ID, the Facebook Page ID, the imgbb
signup, and the OpenRouter key are all gone from the install path.

### Docker artifacts in scope for this rework

- `Dockerfile` at repo root — Node base image, copies repo, installs deps,
  installs Hermes, sets the entrypoint to start Hermes + the cron daemon.
- `docker-compose.yml` (or a sample one in `templates/`) showing how an
  operator wires the volume, env, and restart policy on the host.
- `install.sh` is split: the host-side part (clone + `docker compose up`) stays
  small; the in-container part is what runs Steps 1–7 above and is invoked by
  the Dockerfile/entrypoint.

## Files affected

**Rewrite:**

- `scripts/composio-helpers.js` → `scripts/mcp-client.js`
- `scripts/setup.js`
- `scripts/generate-slides.js`

**Touch (replace `executeTool(...)` with `callTool(...)`):**

- `scripts/post-to-instagram.js`
- `scripts/post-to-tiktok.js`
- `scripts/post-to-facebook.js`
- `scripts/daily-post.js`
- `scripts/daily-report.js`
- `scripts/weekly-research.js`
- `scripts/weekly-review.js`
- `scripts/drive-sync.js`
- `scripts/drive-inventory.js`
- `scripts/competitor-research.js`
- `scripts/aggregator.js`
- `scripts/self-improve.js`

**New:**

- `Dockerfile` at repo root.
- `templates/docker-compose.yml` — sample compose file for operators.

**Update:**

- `templates/config.template.json`
- `install.sh` — split into host-side (clone + compose up) and in-container parts.
- `README.md`, `INSTALLER.md`, `SETUP.md` — rewritten around Docker-first install,
  paths under `/data/social-marketing/` instead of `~/social-marketing/`.
- Any `skills/*/SKILL.md` reference to SDK calls or hardcoded IDs.

**Skip:**

- `scripts/add-text-overlay.js` (pure node-canvas, no Composio)
- `tests/` fixtures (will be updated as part of the implementation plan, not the design)

## Open question deferred to implementation

The exact Composio tool slug for `gpt-image-2` is not yet verified. MCP
discovery (`tools/list`) handles this at runtime — the script greps the tool
list for an OpenAI image-generation tool and uses whichever slug Composio
publishes. If no such tool exists yet, fallback is OpenAI's HTTP API via
Composio's HTTP-passthrough toolkit (still no key on the VM). Decision is
deferred to the implementation plan.
