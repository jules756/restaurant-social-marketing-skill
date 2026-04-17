# Restaurant Social Media Marketing — v3

Hermes Agent skills + Node scripts that turn a restaurant's social media into an autonomous marketing partner. Goal is **more bookings**, not more views.

## Status

**Working end-to-end** (verified on Rodolfino, 2026-04-17):
- Slide generation via OpenRouter Gemini image models (`generate-slides.js`).
- Text overlays via node-canvas (`add-text-overlay.js`).
- Live Instagram carousel publish via Composio SDK (`post-to-instagram.js`) — 6-slide carousels go live on the feed, `ig_user_id` resolved from config, `image_file` parameter handles Composio-side hosting.
- Telegram notification to the owner with post permalink + "convert to Reel for music" hint after publish.

**Working but untested against live platform APIs:**
- TikTok draft post (`post-to-tiktok.js`).
- Facebook multi-photo carousel (`post-to-facebook.js`).

**Crons (install via `./scripts/install-cron.sh`):**
- `daily-report.js` — 10:00 local. Pulls IG post insights via Composio, computes yesterday vs 7d baseline, sends Telegram summary + diagnostic action.
- `weekly-research.js` — Mondays 09:00. OpenRouter web-search (perplexity/sonar by default) synthesises platform updates, viral formats, hook trends, upcoming dates + 3 actions for the week. Delivered via Telegram.

**Not wired up yet (next phase):**
- Telegram-triggered `generate post` — Hermes orchestration layer still hallucinates instead of invoking scripts. All pipeline commands today are run manually from the VM terminal.
- Drive img2img (bot uses real food photos as references). `drive-sync.js` saves the folder ID; AI picks which subfolder at post time.
- Platform posting scripts for TikTok + Facebook need live verification.

## Known platform constraints

- **No trending music on carousels via API.** Instagram's Graph API doesn't expose the consumer music library to business accounts. After publish, `post-to-instagram.js` pings the owner on Telegram: *"Want music? Open the post → ⋯ → Share as Reel."* Instagram's mobile app handles the conversion + music picker natively.
- **Scheduled posts via API don't reliably appear in Meta Business Suite's Planner.** Composio's `INSTAGRAM_POST_IG_USER_MEDIA` may silently drop the `scheduled_publish_time` parameter. Default mode is live publish; if scheduling is needed, use the mobile app's native scheduler.
- **Composio `uploadFile` presign uses signed R2 URLs that Instagram rejects.** We bypass by passing `image_file: <absolute path>` directly to `INSTAGRAM_POST_IG_USER_MEDIA` — Composio handles the upload + URL on their backend.

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
├── composio-helpers.js           ← SDK wrappers (executeTool, uploadFile)
├── generate-slides.js            ← OpenRouter image gen (txt2img + img2img)
├── add-text-overlay.js           ← node-canvas overlays on generated slides
├── drive-sync.js                 ← pull reference photos from Drive via Composio
├── drive-inventory.js            ← vision classification → photo-inventory.json
├── post-to-instagram.js          ← carousel publish + Telegram notify (LIVE)
├── post-to-tiktok.js             ← TikTok draft (untested live)
├── post-to-facebook.js           ← Facebook multi-photo (untested live)
├── daily-report.js               ← Module A analytics cron
├── weekly-research.js            ← Module B trend research cron (OpenRouter web search)
├── competitor-research.js        ← Module D competitor scan (skeleton)
└── aggregator.js                 ← Cross-client pattern learning (network-level)

tests/                            ← Offline test harness
├── test-posting.js               ← 32 assertions; uses --dry-run mode
└── fixtures/                     ← Test config + fake slides

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

## Live Posting Verification (Current Working Path)

Minimum config.json fields for a live Instagram post:

```json
{
  "telegram": { "botToken": "<bot token>", "chatId": "<owner chat id>" },
  "composio": {
    "apiKey": "ak_<org-scoped key>",
    "userId": "pg-test-<or your entity id>"
  },
  "platforms": {
    "instagram": {
      "enabled": true,
      "igUserId": "17841<17-digit IG Business Account ID>"
    }
  },
  "imageGen": { "model": "google/gemini-3.1-flash-image-preview" },
  "imageHost": { "imgbbApiKey": "<imgbb key — currently unused since image_file path>" }
}
```

Gotchas from the live bring-up:
- `composio.userId` must match the **entity** under which OAuth was connected (often `pg-test-…` if you connected via Composio's dashboard "Test" button) — not your operator account ID.
- `igUserId` is the **Instagram Business Account ID** (17-digit starting `17841…`), not Composio's user. Find it in Meta Business Suite → Settings → Instagram accounts, or via Graph API Explorer `me/accounts?fields=instagram_business_account`.
- `imgbbApiKey` is configured but not used in the current Instagram flow (we use `image_file` → Composio handles hosting). Keep it for future flows or remove.
- Run `npm install` in the repo before first invocation — `@composio/core` is a local dep.

End-to-end test (VM terminal):

```bash
cd ~/restaurant-social-marketing-skill && node scripts/post-to-instagram.js --config ~/social-marketing/config.json --dir ~/social-marketing/posts/<post-dir>
```

Expected: `{"ok":true,"platform":"instagram","mode":"live","mediaId":"...","permalink":"https://www.instagram.com/p/..."}` + a Telegram message to the owner.

## References

- **OpenRouter** — https://openrouter.ai/docs
- **Composio** — https://docs.composio.dev (Instagram toolkit: https://docs.composio.dev/toolkits/instagram)
- **Upstream external skills** — links in each adapted skill's SKILL.md.
