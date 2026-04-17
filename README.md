# Restaurant Social Media Marketing — v3

A set of Hermes Agent skills that turn a restaurant's social media into an autonomous marketing partner. The goal is always **more bookings**, not more views.

**Status:** three custom skills + three adapted external skills + shared scripts, backed by the Composio SDK.

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
                           │ all external calls via
┌──────────────────────────▼──────────────────────────────────────┐
│        COMPOSIO SDK — THE ONLY CREDENTIAL ON THE VM             │
│                                                                 │
│  One Composio Organization per restaurant (provisioned by       │
│  Jules). Two config fields: composio.apiKey + composio.userId.  │
│                                                                 │
│  The org holds: OAuth connections (TikTok / Instagram /         │
│  Facebook / Drive) + the OpenRouter credential for image gen.   │
│  No MCP. No REST. No third-party API keys on the VM.            │
│                                                                 │
│  Single integration path:                                       │
│    composio.tools.execute('TOOL_SLUG', { userId, arguments })   │
│    Used by in-agent work AND cron scripts alike.                 │
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

**Repo-internal only** — never copied into Hermes:

```
docs/      ← design reference (PRD, notes). Do NOT copy to ~/.hermes/skills/.
```

`install.sh` only copies `skills/*` and `adapted-skills/*`.

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
mkdir -p ~/.hermes/skills/social-media
cp -r ~/restaurant-social-marketing-skill/skills/* ~/.hermes/skills/social-media/
cp -r ~/restaurant-social-marketing-skill/adapted-skills/* ~/.hermes/skills/social-media/
```

If your Hermes uses a different skill layout (top-level only, or a different category), override: `SKILLS_CATEGORY=""` (top-level) or `SKILLS_CATEGORY=<other>` when running `install.sh`.

### Step 3 — Install SDK dependencies

```bash
cd ~/restaurant-social-marketing-skill && npm install
```

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
- **`composio.apiKey`** + **`composio.userId`** — org-scoped key + entity ID. One Composio Organization per restaurant; the org holds every OAuth + OpenRouter credential.
- **`platforms.<name>.enabled`** — one boolean per platform the restaurant uses.
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

## References

- **OpenRouter** — https://openrouter.ai/docs
- **Composio** — https://docs.composio.dev
- **Upstream external skills** — links in each adapted skill's SKILL.md.
