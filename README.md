# Restaurant Social Marketing — Hermes Skill

A skill for [Hermes](https://github.com/NousResearch/hermes-agent) that turns a restaurant's social media into an autonomous marketing partner. Owner chats on Telegram, Hermes posts to Instagram/Facebook/TikTok, syncs photos from Google Drive, generates slideshow images via gpt-image-2, and reports analytics. Goal is **more bookings**, not more views.

## What this repo is

A self-contained skill bundle. It does **not** install Hermes or the Composio MCP — those live in the [hermes-install](../hermes-install/) repo. This repo is what you drop into a *running* per-agent Hermes container to make it act as a restaurant marketer.

## Repo layout

```
restaurant-social-marketing-skill/
├── README.md
├── DESCRIPTION.md
├── install.sh                  # installs into a running per-agent Hermes (idempotent)
├── package.json                # script deps (Composio core, MCP SDK, node-canvas)
│
├── restaurant-marketing/       # main orchestrator skill (Telegram conversation)
├── content-preparation/        # builds slideshow + caption from owner intent
├── marketing-intelligence/     # daily report, weekly trend research, competitor research
├── food-photography-hermes/    # prompt vocab + lighting presets (knowledge-only)
├── social-media-seo-hermes/    # hooks, CTAs, keyword vocab (knowledge-only)
├── social-trend-monitor-hermes/# trend detection patterns
├── xurl/                       # url helper skill
│
├── scripts/                    # what the skills + cron jobs call
│   ├── mcp-client.js           # multi-userId Composio MCP routing
│   ├── setup.js                # one-shot: provisions per-userId MCP servers
│   ├── state-helpers.js        # state.json read/write (per-post pipeline state)
│   ├── drive-sync.js           # Drive → photos cache via GOOGLEDRIVE_FIND/DOWNLOAD
│   ├── generate-slides.js      # gpt-image-2 + img2img edit, parallelized
│   ├── add-text-overlay.js     # node-canvas text overlay (mandatory, fail-loud)
│   ├── post-to-instagram.js    # CREATE_CAROUSEL_CONTAINER + PUBLISH (local files)
│   ├── post-to-facebook.js     # CREATE_PHOTO_POST or UPLOAD_PHOTOS_BATCH
│   ├── post-to-tiktok.js       # POST_PHOTO via verified domain (or skip)
│   ├── daily-report.js         # writes report file Hermes reads
│   ├── weekly-research.js      # OpenRouter perplexity/sonar trend research
│   ├── competitor-research.js
│   └── aggregator.js
│
└── templates/
    ├── SOUL.md                 # Hermes persona (banned words, hard rules)
    ├── config.template.json    # seeds <agent-data>/social-marketing/config.json on install
    └── crontab.template        # cron job definitions (drive sync, daily, weekly)
```

## Prereqs

1. A VM with [hermes-install](../hermes-install/) bootstrapped (Hermes Docker image built).
2. A per-agent container spawned: `bash ~/hermes-install/new-agent.sh <agent-name>`.
3. A [Composio](https://composio.dev) project. Each agent has its own `defaultUserId`. Composio sometimes requires splitting toolkits across multiple userIds (e.g. OpenAI on its own) — the skill supports this via `userIdOverrides`.
4. Node.js 18+ on the VM.

## Install (per agent)

```bash
git clone <this-repo> ~/restaurant-social-marketing-skill
AGENT=<agent-name> bash ~/restaurant-social-marketing-skill/install.sh
```

Replace `<agent-name>` with the agent you spawned earlier (e.g. `rodolfino`).

`install.sh` does:

1. Validates the target agent exists (`~/.hermes-<agent>/` and `~/agents/<agent>/`).
2. Creates `~/agents/<agent>/social-marketing/` with all subdirs.
3. Seeds `config.json` from the template (only if missing — preserves your edits on re-runs).
4. Copies `SOUL.md` + skill folders into `~/.hermes-<agent>/`.
5. Drops an on-boot hook into `~/.hermes-<agent>/hooks/on-boot/` so the agent auto-provisions Composio MCP servers on next restart.
6. Installs npm deps.
7. Symlinks the skill repo into `~/agents/<agent>/` so the in-container hook can find it.
8. Registers cron jobs (tagged with the agent name — multiple agents on one VM each get their own block).

Re-runnable safely. Cron jobs are tagged so re-running replaces them cleanly.

## Configure

Edit `~/agents/<agent>/social-marketing/config.json`:

```json
{
  "composio": {
    "apiKey": "<your-composio-project-api-key>",
    "defaultUserId": "rodolfino-marketing",
    "userIdOverrides": {
      "openai": "rodolfino-openai"
    }
  },
  "platforms": {
    "instagram": { "enabled": true },
    "facebook":  { "enabled": true, "pageId": "<numeric Facebook Page ID>" },
    "tiktok":    { "enabled": false, "verifiedDomain": "" }
  },
  "googleDrive": { "enabled": true, "folderName": "akira-agent_src" }
}
```

### About userIds

A Composio project can have multiple `userId`s, and OAuth connections are scoped per-userId. Sometimes Composio forces you to split toolkits onto separate userIds (e.g. OpenAI on its own, or OpenRouter separate from your OAuth toolkits).

- `defaultUserId` — your main per-agent userId. Most toolkits resolve here.
- `userIdOverrides` — only fill in if a specific toolkit needs a different userId. Format: `{ "<toolkit-slug>": "<userId>" }`. Toolkit slugs match Composio's: `openai`, `openrouter`, `gmail`, `googledrive`, `instagram`, `facebook`, `tiktok`.

`setup.js` reads this map and creates **one MCP server per unique userId**, writing per-userId URLs to `composio.mcpServerUrls[userId]`. The `mcp-client.js` wrapper routes each tool call to the right server automatically.

In Composio's dashboard, connect each toolkit's OAuth (or paste the API key) under the corresponding userId.

### Telegram

You do **not** put the Telegram bot token in this config. Hermes itself owns the Telegram connection — set it once via:

```bash
docker exec -it hermes-<agent> hermes setup
```

(Or whatever the upstream Hermes setup command is.)

### Apply config

```bash
docker restart hermes-<agent>
```

The on-boot hook auto-runs `setup.js` to provision the MCP servers using the keys you put in config.json. Tail logs to confirm:

```bash
docker logs -f hermes-<agent>
```

## How a restaurant uses it

1. Owner messages the agent's Telegram bot.
2. Hermes loads `restaurant-marketing/SKILL.md` and runs **Phase 1 onboarding** — 7 conversational questions (language, restaurant name, signature dishes, vibe, typical guest, booking method, Drive photos). Answers go to `~/agents/<agent>/social-marketing/restaurant-profile.json`.
3. After onboarding, owner can say *"generate post"*, *"how are bookings"*, *"run a promotion for slow Tuesdays"*, or just *"there's a special tonight"*.
4. Cron handles background work: drive sync, daily analytics, weekly trends + competitor research.

## The post pipeline (3 stages, each idempotent)

```
[1] generate-slides.js   →  state.json: "generated"
                            slide-N-raw.png (parallel, p-limit 3)
                            uses OPENAI_CREATE_IMAGE_EDIT with up to 4 ref photos
                            (food + ambiance) when inventory has them; falls back
                            to OPENAI_CREATE_IMAGE for txt2img.

[2] add-text-overlay.js  →  state.json: "overlaid"
                            slide-N.png (node-canvas, mandatory — fails loud
                            if canvas isn't installed).

[3] post-to-{platform}.js → state.json: "posted"
                            Instagram: INSTAGRAM_CREATE_CAROUSEL_CONTAINER
                            (passes child_image_files local paths directly,
                            no S3 dance), then INSTAGRAM_POST_IG_USER_MEDIA_PUBLISH.
                            Facebook: FACEBOOK_UPLOAD_PHOTOS_BATCH or
                            FACEBOOK_CREATE_PHOTO_POST.
                            TikTok: TIKTOK_POST_PHOTO via verified domain (or
                            warn-and-skip if no verifiedDomain set).
```

Each stage reads `state.json` and skips work that's already done. A failed run can be re-run from the same point. No regenerating images to recover from a posting failure.

## What goes where on the VM

| Path | Owner | What's there |
|---|---|---|
| `~/restaurant-social-marketing-skill/` | git, read-only | This skill repo |
| `~/.hermes-<agent>/` | install-time | Per-agent Hermes home: `skills/`, `hooks/on-boot/`, `SOUL.md` |
| `~/agents/<agent>/social-marketing/` | runtime, read-write | `config.json`, `restaurant-profile.json`, `posts/`, `photos/`, `reports/`, `logs/` |
| `~/agents/<agent>/restaurant-social-marketing-skill` | symlink | Points to the skill repo so the in-container hook can find it |
| crontab | install-time | Scheduled jobs, tagged per agent |

## Uninstall (per agent)

```bash
AGENT=<agent> bash ~/restaurant-social-marketing-skill/install.sh --uninstall
```

Removes the cron jobs and the on-boot hook. Skill data, generated posts, photos, reports — all kept. Delete `~/agents/<agent>/social-marketing/` manually for a full wipe.

## Multi-restaurant

Each restaurant gets its own agent on the VM. Run `new-agent.sh` per restaurant in `hermes-install`, then this skill's `install.sh` per restaurant with the right `AGENT=` env var. Same skill repo, isolated data, isolated Telegram bots, isolated Composio userIds.
