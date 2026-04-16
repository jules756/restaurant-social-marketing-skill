# Restaurant Social Media Marketing — v3

A set of Hermes Agent skills that turn a restaurant's social media into an autonomous marketing partner. The goal is always **more bookings**, not more views.

**Status:** v3 architecture — three custom skills + three adapted external skills + shared scripts.

Legacy v2 (single 868-line `SKILL.md`) is archived under [`legacy/`](legacy/) for reference.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    CUSTOM SKILLS (in this repo)                 │
│                                                                 │
│  skills/restaurant-marketing      Orchestrator. Onboarding,     │
│                                   daily commands, conversation, │
│                                   promotions, calendar, self-   │
│                                   improvement loop.             │
│                                                                 │
│  skills/content-preparation       Asset pipeline. Decides what  │
│                                   to create, finds reference    │
│                                   photos, picks img2img vs      │
│                                   txt2img, coordinates overlays │
│                                   and captions.                 │
│                                                                 │
│  skills/marketing-intelligence    Data layer. Daily analytics,  │
│                                   weekly trend research,        │
│                                   competitor research, cross-   │
│                                   client aggregation.           │
└──────────────────────────┬──────────────────────────────────────┘
                           │ all external calls authorized by
┌──────────────────────────▼──────────────────────────────────────┐
│           COMPOSIO IS THE ONLY CREDENTIAL STORE                 │
│                                                                 │
│  One Composio Project per restaurant (provisioned by Jules).    │
│  The Project holds OAuth connections for TikTok / Instagram /   │
│  Facebook / Drive AND the OpenRouter credential for image       │
│  generation and vision. The VM carries no third-party keys.     │
│                                                                 │
│  In-agent path: Composio MCP                                    │
│    → Hermes loads the client's MCP server (ck_ key in           │
│      ~/.hermes/config.yaml). Tools appear natively in chat.     │
│                                                                 │
│  Out-of-agent path: Composio REST                               │
│    → Cron scripts (daily-report, weekly-research, drive-sync)   │
│      use the project API key + user_id from config.json.        │
│    → OpenRouter calls (image gen, vision) go through the        │
│      Composio proxy — no OPENROUTER_API_KEY on the VM.          │
└──────────────────────────┬──────────────────────────────────────┘
                           │ knowledge only — no extra keys
┌──────────────────────────▼──────────────────────────────────────┐
│                   ADAPTED EXTERNAL SKILLS                       │
│                                                                 │
│  adapted-skills/food-photography-hermes                         │
│  adapted-skills/social-media-seo-hermes                         │
│  adapted-skills/social-trend-monitor-hermes                     │
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

**What Hermes loads** (copied into `~/.hermes/skills/` by `install.sh`):

```
skills/                           ← custom skills for Hermes
├── restaurant-marketing/SKILL.md
├── content-preparation/SKILL.md
└── marketing-intelligence/SKILL.md

adapted-skills/                   ← external skills, API calls stripped
├── food-photography-hermes/SKILL.md
├── social-media-seo-hermes/SKILL.md
└── social-trend-monitor-hermes/SKILL.md

scripts/                          ← Node.js scripts (called by skills at runtime)
├── setup.js                      ← Phase 0 validation
├── drive-sync.js
├── drive-inventory.js
├── generate-slides.js
├── add-text-overlay.js
├── daily-report.js
├── weekly-research.js
├── competitor-research.js
└── aggregator.js

templates/
└── config.template.json          ← blank config for new deployments
```

**Repo-internal only** — never copied into Hermes, never loaded as skills:

```
docs/      ← design reference (PRD, OpenRouter notes). Do NOT copy to ~/.hermes/skills/.
legacy/    ← archived v2 skill + scripts. Do NOT copy to ~/.hermes/skills/.
```

`install.sh` only copies `skills/*` and `adapted-skills/*`. If doing a manual install, copy *only* those two directories — loading `docs/` or `legacy/` will confuse Hermes with stale or non-skill content.

---

## Installation (Per Client)

> **If you are an AI agent doing the install from the terminal, read [INSTALLER.md](INSTALLER.md) first — it's the unambiguous brief for what you can and cannot ask the human.**

Run each step below on the client VM. Every step is a single command — paste one at a time.

### Step 1 — Clone the repo

```bash
git clone https://github.com/jules756/restaurant-social-marketing-skill.git ~/restaurant-social-marketing-skill
cd ~/restaurant-social-marketing-skill
```

After this: you should see `skills/`, `adapted-skills/`, `scripts/`, `templates/` inside `~/restaurant-social-marketing-skill`.

### Step 2 — Copy skills into Hermes

Hermes organizes skills by category. These skills go under `social-media/`:

```bash
# Remove any prior v2 install first
rm -rf ~/.hermes/skills/social-media/restaurant-social-marketing
rm -rf ~/.hermes/skills/social-media/restaurant-social-marketing-setup-verification

# Install v3
mkdir -p ~/.hermes/skills/social-media
cp -r ~/restaurant-social-marketing-skill/skills/* ~/.hermes/skills/social-media/
cp -r ~/restaurant-social-marketing-skill/adapted-skills/* ~/.hermes/skills/social-media/
```

If your Hermes uses a different skill layout (top-level only, or a different category), override: `SKILLS_CATEGORY=""` (top-level) or `SKILLS_CATEGORY=<other>` when running `install.sh`.

### Step 3 — Install `@composio/core` globally

```bash
npm install -g @composio/core
```

### Step 4 — Register Composio MCP in Hermes

Append to `~/.hermes/config.yaml` (create the file if missing). The URL and `ck_…` key come from the provisioning bundle for this restaurant:

```yaml
mcp_servers:
  composio:
    url: "https://backend.composio.dev/v3/mcp/<server_id>/mcp?user_id=<entity>"
    headers:
      Authorization: "Bearer <ck_SERVER_KEY>"
```

Inside an active Hermes chat, run `/reload-mcp` to pick up the change.

### Step 5 — Scaffold the client working directory

```bash
cd ~
mkdir -p social-marketing/photos/{dishes,ambiance,kitchen,exterior,unsorted}
mkdir -p social-marketing/{posts,knowledge-base}
mkdir -p social-marketing/reports/{trend-reports,competitor}
cp ~/restaurant-social-marketing-skill/templates/config.template.json ~/social-marketing/config.json
```

### Step 6 — Fill in `~/social-marketing/config.json` (Installer scope only)

`config.json` is Installer-scope only — API plumbing, never restaurant content. **Do not put restaurant name, cuisine, menu, or booking URL here.** Those come from the owner via Telegram during onboarding and land in `restaurant-profile.json`.

Fields you set:
- **`telegram.botToken`** + **`telegram.chatId`** — from @BotFather + `getUpdates`.
- **`composio.projectId`** + **`composio.userId`** + **`composio.projectApiKey`** + **`composio.mcp.{url, serverKey}`** — the full provisioning bundle from Jules's dashboard. One Composio Project per restaurant; the project holds every OAuth + OpenRouter credential.
- **`platforms.<name>.enabled`** — one boolean per platform the restaurant uses. No `ca_…` IDs — Composio resolves them from `user_id`.
- **`googleDrive.enabled`** — `true` if the restaurant is using Drive. `googleDrive.folderName` defaults to `akira-agent_src`. No folder ID needed (auto-created at first use).
- **`timezone`**, **`country`** — defaults are `Europe/Stockholm` / `SE`.

### Step 7 — Validate (Installer only)

```bash
set -a && source ~/.hermes/.env && set +a
node ~/restaurant-social-marketing-skill/scripts/setup.js --config ~/social-marketing/config.json
```

Every check must report ✅. **Do not hand the bot to the owner until `setup.js` reports all green.**

### Step 8 — Start Hermes

```bash
hermes
```

### Step 9 — Hand the Telegram bot to the owner

The owner starts a chat with the bot. The orchestrator runs ≤7 onboarding questions and writes the answers to `~/social-marketing/restaurant-profile.json`. The Installer never touches this file.

---

### Shortcut — one command

If you trust the script end-to-end:

```bash
git clone https://github.com/jules756/restaurant-social-marketing-skill.git ~/restaurant-social-marketing-skill \
  && cd ~/restaurant-social-marketing-skill \
  && CLIENT_DIR=~/social-marketing ./install.sh
```

`install.sh` runs Steps 2–5 + 7 and prompts for the two API keys. You still need to edit `config.json` (Step 6) between the first and second runs.

---

## What's Different from v2

| v2 (archived)                               | v3                                              |
|---------------------------------------------|-------------------------------------------------|
| Single 868-line `SKILL.md`                  | 3 custom skills + 3 adapted external skills     |
| Installer and Owner mixed in one flow       | Two-actor model, strictly enforced              |
| `tiktok-marketing/` paths                   | Platform-agnostic `social-marketing/`           |
| Hardcoded TikTok even when disabled         | Every feature checks `config.platforms`         |
| Pure text-to-image generation               | img2img primary, txt2img fallback               |
| Google Drive photos collected but unused    | Drive inventory drives every post               |
| Knowledge base collected but unused         | Chef / recipe / sourcing posts weekly           |
| Competitor research ran once                | Weekly trend cron + on-demand competitor cron   |
| No self-improvement                         | Module C loop + cross-client aggregator         |
| Formatted commands for promotions           | Natural language passive detection              |
| OpenAI direct + hardcoded `gpt-image-1`     | OpenRouter via Composio proxy + config-driven `imageGen.model` |
| `OPENROUTER_API_KEY` in ~/.hermes/.env      | No `.env` keys — everything lives in the client's Composio Project |
| Composio REST with per-platform `ca_…` IDs  | One Composio Project per restaurant; MCP + user_id resolve connections |

---

## References

- **PRD v3** — `docs/PRD-v3.md` (copy target from `/Users/jules/Downloads/PRD-restaurant-social-marketing-v3.md`)
- **OpenRouter** — https://openrouter.ai/docs
- **Composio** — https://docs.composio.dev/tools
- **Upstream external skills** — links in each adapted skill's SKILL.md.
