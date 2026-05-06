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

The install runs **inside a Docker container** named after the company + agent. `install.sh` is a thin host-side shim that clones the repo, builds the image, and brings the compose service up.

### One-shot

```bash
COMPANY=rodolfino bash install.sh
```

That clones the repo to `~/restaurant-social-marketing-skill`, builds `restaurant-marketing:v4-alpha`, scaffolds `/var/lib/akira/rodolfino/marketing/` as the data volume, materializes a compose file at `/opt/agents/rodolfino-marketing/docker-compose.yml`, and starts the container.

The container's first boot scaffolds `/data/social-marketing/` and copies the config template — then sleeps so the operator can edit it.

### Operator steps after first boot

1. Edit `/var/lib/akira/<company>/<agent>/social-marketing/config.json`:
   - `telegram.botToken` + `chatId` (from @BotFather + `getUpdates`)
   - `composio.apiKey` + `composio.userId` (per-agent identifier, e.g. `rodolfino-marketing`)
   - flip the platforms you use to `enabled: true`
2. In the [Composio dashboard](https://app.composio.dev), under the company project:
   - Create + connect OAuth for each enabled platform (Instagram / Facebook / TikTok / Google Drive).
   - Add the OpenAI credential for `gpt-image-2` image gen.
   - (Optional) Add an OpenRouter credential if you want weekly trend research.
3. Restart the container so `docker-entrypoint.sh` runs `setup.js`:
   ```bash
   docker compose -f /opt/agents/<company>-marketing/docker-compose.yml restart
   docker logs -f marketing-agent-<company>-marketing
   ```
4. `setup.js` calls `composio.mcp.create()`, writes `mcpServerUrl` into the config, and verifies the URL works. When it reports `✅ All N checks passed`, hand the Telegram bot to the owner.

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
  node /app/scripts/post-to-instagram.js \
  --config /data/social-marketing/config.json \
  --dir /data/social-marketing/posts/<post-dir>
```

Expected: `{"ok":true,"platform":"instagram","mode":"live","mediaId":"...","permalink":"https://www.instagram.com/p/..."}` + a Telegram message to the owner.

## References

- **Composio** — https://docs.composio.dev (single-toolkit MCP: https://docs.composio.dev/docs/single-toolkit-mcp)
- **OpenAI gpt-image-2** — https://platform.openai.com/docs/guides/images
- **Upstream external skills** — links in each adapted skill's SKILL.md.
