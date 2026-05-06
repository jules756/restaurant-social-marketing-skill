# Restaurant Social Media Marketing — v4

Hermes Agent skills + Node scripts that turn a restaurant's social media into an autonomous marketing partner. Goal is **more bookings**, not more views.

## Status

**v4 — MCP-native, Docker-packaged, gpt-image-2.** Implementation complete on the `v4-mcp-rework` branch; live smoke tests against a real Composio project still pending.

What changed from v3:
- Single integration path: per-agent Composio MCP server (`composio.mcp.create()`), no SDK calls outside `setup.js`.
- Image gen: `gpt-image-2` routed through Composio. The OpenAI key lives in the Composio project, not on the VM.
- Config shrunk: no more `igUserId`, `pageId`, `imgbbApiKey`, OpenRouter key, or `imageGen.model`. Composio resolves all of these.
- Containerized: one Hermes agent = one Docker container. `/data/social-marketing/` is a host volume mount.

Falling back to v3: the `main` branch still holds the working v3. `git checkout main` and the SDK-based stack is intact.

## Known platform constraints

- **No trending music on carousels via API.** Instagram's Graph API doesn't expose the consumer music library to business accounts. After publish, `post-to-instagram.js` pings the owner on Telegram: *"Want music? Open the post → ⋯ → Share as Reel."*
- **Scheduled posts via API don't reliably appear in Meta Business Suite's Planner.** Composio's Instagram tool may silently drop the `scheduled_publish_time` parameter. Default mode is live publish; if scheduling is needed, use the mobile app's native scheduler.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│            DOCKER CONTAINER — one per Hermes agent              │
│                                                                 │
│  /app                                                           │
│    skills/restaurant-marketing      Orchestrator. Onboarding,   │
│                                     daily commands, conversation,│
│                                     promotions, calendar, self- │
│                                     improvement loop.           │
│                                                                 │
│    skills/content-preparation       Asset pipeline.             │
│    skills/marketing-intelligence    Data layer.                 │
│                                                                 │
│    scripts/                         Cron jobs + tooling.        │
│                                                                 │
│  /data  (host volume mount)                                     │
│    social-marketing/                                            │
│      config.json                    API plumbing only.          │
│      restaurant-profile.json        Owner-provided via Telegram.│
│      photos/, posts/, knowledge-base/, reports/                 │
└──────────────────────────┬──────────────────────────────────────┘
                           │ all external calls via MCP (HTTPS only)
┌──────────────────────────▼──────────────────────────────────────┐
│        COMPOSIO MCP SERVER — created at install time            │
│                                                                 │
│  One Composio project per company. composio.mcp.create() at     │
│  install writes the per-agent server URL into config.json.      │
│  The server holds: OAuth connections (Instagram / Facebook /    │
│  TikTok / Drive) + the OpenAI credential for gpt-image-2 +      │
│  optional OpenRouter for weekly trend research.                 │
│                                                                 │
│  Single integration path:                                       │
│    callTool(config, 'TOOL_SLUG', args)   from mcp-client.js     │
│    Used by Hermes AND every cron script.                        │
└─────────────────────────────────────────────────────────────────┘
```

---

## Two-Actor Model

The most important design principle. Enforced across all skills.

| Actor                  | Channel       | Role                            |
|------------------------|---------------|---------------------------------|
| **Installer**          | Terminal only | API keys, config, setup. Once.  |
| **Restaurant Owner**   | Telegram only | Restaurant info, daily use.     |

If a Telegram message from the agent requires technical knowledge to answer, that's a bug. Fix it in setup, not in conversation.

---

## Repository Layout

**What runs inside the container** (all under `/app/`):

```
skills/                           ← custom skills for Hermes
├── restaurant-marketing/SKILL.md
├── content-preparation/SKILL.md
└── marketing-intelligence/SKILL.md

adapted-skills/                   ← external skills, API calls stripped
├── food-photography-hermes/
├── social-media-seo-hermes/
└── social-trend-monitor-hermes/

scripts/                          ← Node.js scripts (called by skills at runtime)
├── setup.js                      ← Phase 0 validator + composio.mcp.create()
├── mcp-client.js                 ← MCP client wrapper (callTool, listTools)
├── generate-slides.js            ← gpt-image-2 over MCP (txt2img + img2img)
├── add-text-overlay.js           ← node-canvas overlays
├── drive-sync.js                 ← verify/create Drive folder via MCP
├── post-to-instagram.js          ← carousel publish + Telegram notify
├── post-to-tiktok.js             ← TikTok draft
├── post-to-facebook.js           ← Facebook multi-photo
├── daily-report.js               ← analytics cron
├── weekly-research.js            ← Module B trend research cron
├── competitor-research.js        ← Module D competitor scan
├── aggregator.js                 ← Cross-client pattern learning
└── docker-entrypoint.sh          ← container boot script

tests/
└── test-mcp-client.js            ← offline unit test, MCP SDK stubbed

templates/
├── config.template.json          ← v4 minimal config (Telegram + Composio)
├── docker-compose.yml            ← per-agent compose template
└── SOUL.md                       ← Hermes persona override

Dockerfile                        ← node:18-alpine + canvas + Hermes-ready
.dockerignore
install.sh                        ← host-side: clone, build, compose up
```

**Repo-internal only** — never copied into the container at runtime:

```
docs/      ← spec, plan, design notes.
```

---

## Installation (per agent)

> **If you are an AI installer doing this from the terminal, read [INSTALLER.md](INSTALLER.md) first.**

The flow is: stand up a Hermes container → run **Hermes setup** in the TUI to configure the model + provider key → fill the marketing-specific `config.json` with Telegram + Composio creds → restart the container so v4's pre-start runs `setup.js` (which provisions the per-agent Composio MCP server).

### Step 1 — Build + start the container

```bash
COMPANY=<short-id> bash install.sh
```

That clones the repo, builds `restaurant-marketing:v4-alpha` (layered on `nousresearch/hermes-agent`), scaffolds `~/.hermes-agent-<company>-marketing/` as the data volume, materializes a compose file at `~/agents/<company>-marketing/docker-compose.yml`, and brings the container up.

On first boot, our pre-start script writes the v4 config template to `/opt/data/social-marketing/config.json` and then sleeps — it explicitly will not run `setup.js` until `composio.apiKey`, `composio.userId`, and Telegram credentials are filled in.

### Step 2 — Run Hermes setup (interactive, inside the container)

This is the standard Hermes first-time setup — model + provider key. Run it interactively from the host:

```bash
docker run --rm -it \
  --name marketing-agent-<company>-marketing-setup \
  -v ~/.hermes-agent-<company>-marketing:/opt/data \
  restaurant-marketing:v4-alpha hermes setup
```

The setup wizard writes the chosen provider key to `/opt/data/.env` (e.g. `OPENROUTER_API_KEY`, `OPENAI_API_KEY`, or `ANTHROPIC_API_KEY`) and the model selection to `/opt/data/config.yaml`. Both are persisted on the host volume.

### Step 3 — Fill in the marketing config

Edit the v4 config template that was scaffolded in step 1:

```bash
sudo chown -R "$USER":"$USER" ~/.hermes-agent-<company>-marketing/  # if Hermes chown'd the volume
nano ~/.hermes-agent-<company>-marketing/social-marketing/config.json
```

Fill exactly these fields:

- `telegram.botToken` + `chatId` (from @BotFather + `getUpdates`)
- `composio.apiKey` + `composio.userId` (per-agent identifier, e.g. `<company>-marketing`)
- flip the platforms you use to `enabled: true`

Leave `mcpServerUrl` and `mcpServerId` empty — `setup.js` writes them in step 5.

### Step 4 — Provision OAuth + credentials in the Composio dashboard

In [https://app.composio.dev](https://app.composio.dev), under the project that owns the API key from step 3:

- Create + connect an OAuth Auth Config for each enabled platform (Instagram / Facebook / TikTok / Google Drive).
- Add the OpenAI Auth Config (paste the API key — `gpt-image-2` needs it).
- Optional: add OpenRouter for weekly trend research.

The Composio `userId` you put in `config.json` must be the entity that owns those OAuth connections. If you connected via the dashboard's "Test" button, the entity ID looks like `pg-test-…` and that's what goes in `composio.userId`.

### Step 5 — Restart the container so `setup.js` runs

```bash
docker compose -f ~/agents/<company>-marketing/docker-compose.yml restart
docker logs -f marketing-agent-<company>-marketing
```

The pre-start script sees `composio.mcpServerUrl` is empty, runs `setup.js`, which calls `composio.mcp.create()` + `mcp.generate()`, writes the URL into config, and verifies by listing tools. When you see `✅ All N checks passed`, the marketing skill is fully wired up. Hermes then starts normally.

### Step 6 — Hand the Telegram bot to the owner

The owner messages the bot. The `restaurant-marketing` skill picks up onboarding from there.

---

## Live Posting Verification

Minimum `config.json` for a live Instagram post (most fields written by setup.js — operator only fills the first six):

```json
{
  "telegram": { "botToken": "<bot token>", "chatId": "<owner chat id>" },
  "composio": {
    "apiKey": "<project API key>",
    "userId": "<per-agent id>",
    "mcpServerUrl": "<written by setup.js>",
    "mcpServerId": "<written by setup.js>"
  },
  "platforms": { "instagram": { "enabled": true } }
}
```

End-to-end test (inside the container):

```bash
docker exec -it marketing-agent-<company>-marketing \
  node /opt/hermes/social-marketing-skill/scripts/post-to-instagram.js \
  --config /opt/data/social-marketing/config.json \
  --dir /opt/data/social-marketing/posts/<post-dir>
```

Expected: `{"ok":true,"platform":"instagram","mode":"live","mediaId":"...","permalink":"https://www.instagram.com/p/..."}` + a Telegram message to the owner.

## References

- **Composio** — https://docs.composio.dev (single-toolkit MCP: https://docs.composio.dev/docs/single-toolkit-mcp)
- **OpenAI gpt-image-2** — https://platform.openai.com/docs/guides/images
- **Upstream external skills** — links in each adapted skill's SKILL.md.
