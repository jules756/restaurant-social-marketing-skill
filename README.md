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

```bash
# 1. Copy skills to Hermes
cp -r skills/* ~/.hermes/skills/
cp -r adapted-skills/* ~/.hermes/skills/

# 2. Set API keys
cat >> ~/.hermes/.env <<EOF
OPENROUTER_API_KEY=sk-or-...
COMPOSIO_API_KEY=...
EOF

# 3. Create working directory
mkdir -p social-marketing/{photos/{dishes,ambiance,kitchen,exterior},posts,reports/trend-reports,knowledge-base}
cp templates/config.template.json social-marketing/config.json
# Fill in restaurant + Composio connected_account_ids in config.json

# 4. Validate (Installer)
node scripts/setup.js --config social-marketing/config.json

# 5. Start Hermes — bot is ready for the owner
hermes
```

Do **not** hand the bot to the owner until `setup.js` reports all ✅.

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
