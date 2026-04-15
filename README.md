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
                           │ all API calls via
┌──────────────────────────▼──────────────────────────────────────┐
│                         TWO APIs ONLY                           │
│                                                                 │
│  OpenRouter  (OPENROUTER_API_KEY)                               │
│    → LLM calls + image generation (openai/gpt-image-1.5)        │
│                                                                 │
│  Composio  (COMPOSIO_API_KEY)                                   │
│    → Google Drive, TikTok, Instagram, Facebook                  │
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

```
restaurant-social-marketing-skill/
├── skills/                           ← custom skills built for Hermes
│   ├── restaurant-marketing/SKILL.md
│   ├── content-preparation/SKILL.md
│   └── marketing-intelligence/SKILL.md
│
├── adapted-skills/                   ← external skills, API calls stripped
│   ├── food-photography-hermes/SKILL.md
│   ├── social-media-seo-hermes/SKILL.md
│   └── social-trend-monitor-hermes/SKILL.md
│
├── scripts/                          ← Node.js scripts (next phase)
│   ├── setup.js                      ← Phase 0 validation
│   ├── drive-sync.js
│   ├── drive-inventory.js
│   ├── generate-slides.js
│   ├── add-text-overlay.js
│   ├── daily-report.js
│   ├── weekly-research.js
│   ├── competitor-research.js
│   └── aggregator.js
│
├── templates/
│   └── config.template.json          ← blank config for new deployments
│
├── docs/
│   └── PRD-v3.md                     ← design reference
│
└── legacy/                           ← archived v2 skill + docs
```

---

## Installation (Per Client)

Run each step below on the client VM. Every step is a single command — paste one at a time.

### Step 1 — Clone the repo

```bash
git clone https://github.com/jules756/restaurant-social-marketing-skill.git ~/restaurant-social-marketing-skill
cd ~/restaurant-social-marketing-skill
```

After this: you should see `skills/`, `adapted-skills/`, `scripts/`, `templates/` inside `~/restaurant-social-marketing-skill`.

### Step 2 — Copy skills into Hermes

```bash
mkdir -p ~/.hermes/skills
cp -r ~/restaurant-social-marketing-skill/skills/* ~/.hermes/skills/
cp -r ~/restaurant-social-marketing-skill/adapted-skills/* ~/.hermes/skills/
```

### Step 3 — Add the OpenRouter key

Replace `sk-or-...` with your real key:

```bash
echo "OPENROUTER_API_KEY=sk-or-REPLACE_ME" >> ~/.hermes/.env
```

### Step 4 — Add the Composio key

Replace the placeholder with your real key:

```bash
echo "COMPOSIO_API_KEY=REPLACE_ME" >> ~/.hermes/.env
chmod 600 ~/.hermes/.env
```

### Step 5 — Scaffold the client working directory

```bash
cd ~
mkdir -p social-marketing/photos/{dishes,ambiance,kitchen,exterior,unsorted}
mkdir -p social-marketing/{posts,knowledge-base}
mkdir -p social-marketing/reports/{trend-reports,competitor}
cp ~/restaurant-social-marketing-skill/templates/config.template.json ~/social-marketing/config.json
```

### Step 6 — Fill in `~/social-marketing/config.json`

Open the file and set at minimum:
- `restaurant.name`, `restaurant.cuisine`, `restaurant.location`, `restaurant.bookingUrl`
- For each platform you're enabling: `platforms.<name>.enabled = true` and `platforms.<name>.composioAccountId = "ca_..."` (from Composio dashboard)
- If using Drive: `googleDrive.enabled = true`, `googleDrive.folderId`, `googleDrive.composioAccountId`

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
| OpenAI direct + `gpt-image-1`               | OpenRouter + `gpt-image-1.5`                    |

---

## References

- **PRD v3** — `docs/PRD-v3.md` (copy target from `/Users/jules/Downloads/PRD-restaurant-social-marketing-v3.md`)
- **OpenRouter** — https://openrouter.ai/docs
- **Composio** — https://docs.composio.dev/tools
- **Upstream external skills** — links in each adapted skill's SKILL.md.
