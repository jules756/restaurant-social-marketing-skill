# PRD: Restaurant Social Media Marketing Skills
**Version:** 3.0 — Full Rewrite  
**Date:** 2026-04-15  
**Author:** Jules Varnier / Akira Agent  
**Status:** Ready for development with Claude Code + Hermes Agent

---

## Background

The current `restaurant-social-marketing` skill is a single 868-line SKILL.md that fails in production. Problems identified through testing:

1. Mixes Installer (technical) and restaurant owner (client) into one confusing flow
2. Onboarding is too long and technical — owners get confused, agent loses context
3. Platform detection broken — hardcoded TikTok even when not connected
4. All images are pure text-to-image — generic food that looks like any restaurant
5. Google Drive photos collected but never used as image references
6. Knowledge base (chef, recipes, history) collected but never drives content
7. Competitor research limited to TikTok only, runs once, never repeats
8. Zero analytics — no Google Analytics, no UTM, no real feedback loop
9. Skill never improves itself — weekly research findings go nowhere
10. Promotions require formatted commands — owner can't type naturally
11. Agent feels like a bot — no personality, no memory, no opinions

**This PRD defines a clean rebuild as 3 custom skills + 4 external skills for Hermes Agent.**

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    CUSTOM SKILLS (you build)                    │
│                                                                 │
│  skill-1: restaurant-marketing                                  │
│  Orchestrator. Onboarding, daily commands, conversation,        │
│  promotions, calendar intelligence, self-improvement loop       │
│                                                                 │
│  skill-2: content-preparation                                   │
│  Asset pipeline. Decides what to create, finds reference        │
│  photos in Drive, picks generation approach, coordinates        │
│  image generation and text overlay                              │
│                                                                 │
│  skill-3: marketing-intelligence                                │
│  Data layer. Daily analytics cron, weekly trend research,       │
│  competitor analysis, booking correlation                        │
└──────────────────────────┬──────────────────────────────────────┘
                           │ all API calls via
┌──────────────────────────▼──────────────────────────────────────┐
│                      TWO APIs ONLY                              │
│                                                                 │
│  OpenRouter  (OPENROUTER_API_KEY)                               │
│  → All LLM calls (orchestration, captions, hooks, research)     │
│  → Image generation: openai/gpt-image-1.5                       │
│  → Image editing (img2img): verify endpoint support             │
│  Docs: https://openrouter.ai/docs                               │
│  Models: https://openrouter.ai/api/v1/models                    │
│                                                                 │
│  Composio  (COMPOSIO_API_KEY)                                   │
│  → Google Drive (photo sync, inventory)                         │
│  → TikTok (posting + analytics)                                 │
│  → Instagram (posting + analytics)                              │
│  → Facebook (posting + analytics)                               │
│  Docs: https://docs.composio.dev                                │
│  Tools: https://docs.composio.dev/tools                         │
└─────────────────────────────────────────────────────────────────┘
                           │ knowledge only (no extra API keys)
┌──────────────────────────▼──────────────────────────────────────┐
│               EXTERNAL SKILLS (knowledge documents)             │
│                                                                 │
│  food-photography-generation  (eachlabs)                        │
│  → Prompt patterns, lighting presets, food photography vocab    │
│  → API calls stripped — knowledge only                          │
│  Docs: https://skills.sh/eachlabs/skills/food-photography-generation
│                                                                 │
│  social-media-seo  (rfxlamia)                                   │
│  → 100+ caption/hook formulas with avg_engagement metrics       │
│  → Instagram keyword-first SEO, hashtag strategy               │
│  Docs: https://skills.sh/rfxlamia/claude-skillkit/social-media-seo
│                                                                 │
│  social-trend-monitor  (yangliu2060)                            │
│  → Trend research workflow, search patterns, report structure   │
│  → ⚠️ Translate from Chinese before use                         │
│  Docs: https://skills.sh/yangliu2060/smith--skills/social-trend-monitor
└─────────────────────────────────────────────────────────────────┘
```

**Rule:** Custom skills provide restaurant-specific context and decision logic. External skills do the heavy lifting. No duplication between them.

---

## TWO-ACTOR MODEL

The most important architectural principle. Enforced across all skills.

```
Actor 1 — Installer                  Actor 2 — Restaurant Owner
───────────────────────────          ──────────────────────────
Terminal only                        Telegram only
API keys, config, setup              Restaurant info, daily use
Once per client deployment           Every day
Never on Telegram                    Never sees tech config
```

**Current state:** Installer = Jules running Phase 0 manually via terminal.

**Future state:** Installer = a dedicated Hermes agent (separate from the restaurant agent) that handles Phase 0 fully autonomously — reads a client brief, runs the setup script, validates connections, and hands off the configured bot. All Installer actions are scripted and non-interactive by design — this transition should require zero skill rewrites.

**Hard rule:** If the agent sends a Telegram message that requires technical knowledge to answer, that is a bug. Fix it in setup, not in conversation.

---

## HERMES-SPECIFIC REQUIREMENTS

> All skills must be built FOR Hermes Agent. External skills from skills.sh were built for Cursor, Codex, gemini-cli — they work as SKILL.md content but require adaptation.

### Skill File Format

```yaml
---
name: restaurant-marketing
description: Social media marketing partner for restaurants. Handles daily content generation, promotions, analytics, and client conversation via Telegram.
metadata:
  hermes-agent:
    requirements:
      env:
        - OPENROUTER_API_KEY
        - COMPOSIO_API_KEY
      binaries:
        - node
---
```

### Install Commands

```bash
# Custom skills
hermes skills install ./skills/restaurant-marketing/
hermes skills install ./skills/content-preparation/
hermes skills install ./skills/marketing-intelligence/

# External skills (knowledge documents only — no extra API keys)
npx skills add https://github.com/rfxlamia/claude-skillkit --skill social-media-seo
npx skills add https://github.com/yangliu2060/smith--skills --skill social-trend-monitor
# Optional: food-photography-generation for prompt engineering knowledge
npx skills add https://github.com/eachlabs/skills --skill 'Food Photography Generation'
```

### API Keys → `~/.hermes/.env`

Two keys only. Everything goes through these two.

```env
OPENROUTER_API_KEY=sk-or-...    # LLM calls + image generation
COMPOSIO_API_KEY=...             # Google Drive, TikTok, Instagram, Facebook
```

### Config → `~/.hermes/config.yaml`

```yaml
skills:
  restaurant-marketing:
    client_timezone: Europe/Stockholm
    base_dir: social-marketing/
  content-preparation:
    image_model: openai/gpt-image-1.5   # via OpenRouter
    google_drive_sync: true
```

### OpenRouter Configuration

Primary model provider for all LLM calls and image generation.

- **Docs:** https://openrouter.ai/docs
- **Models endpoint:** https://openrouter.ai/api/v1/models
- **Chat completions:** https://openrouter.ai/api/v1/chat/completions
- **Image generation:** Check OpenRouter model list for `openai/gpt-image-1.5` availability
- **Image edit (img2img):** `https://openrouter.ai/api/v1/images/edits` — verify support before building

```javascript
// OpenRouter image generation
const response = await fetch("https://openrouter.ai/api/v1/images/generations", {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    model: "openai/gpt-image-1.5",
    prompt: "iPhone photo of hand-pulled pasta...",
    size: "1024x1536",    // TikTok portrait
    quality: "high"
  })
});

// OpenRouter image edit (img2img — verify availability first)
const formData = new FormData();
formData.append("model", "openai/gpt-image-1.5");
formData.append("image", imageFile);
formData.append("prompt", "Professional food photography version...");
const response = await fetch("https://openrouter.ai/api/v1/images/edits", {
  method: "POST",
  headers: { "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}` },
  body: formData
});
```

> ⚠️ **Before building:** Confirm OpenRouter supports `images/edits` endpoint for gpt-image-1.5. If not, fall back to direct OpenAI API endpoint for img2img only, keeping OpenRouter for all other calls.

### Adapting External Skills for Hermes

External skills are **knowledge documents only** — they inform the agent's behavior but require no additional API keys. All actual API calls go through OpenRouter or Composio.

**food-photography-generation (eachlabs) — knowledge only**
- Use for: food photography prompt patterns, lighting presets, style vocabulary
- Do NOT use the eachlabs API endpoint — use OpenRouter instead
- Strip the API calls from the skill, keep the prompt engineering knowledge
- The `session_id` consistency concept applies to our OpenRouter calls via consistent base prompts

**social-media-seo (rfxlamia) — knowledge only**
- Use for: 100+ caption/hook formulas with avg_engagement metrics
- Filter to Instagram/TikTok only — remove Twitter/Threads content
- Embed the 7 CSV databases or fetch from GitHub raw:
  `https://raw.githubusercontent.com/rfxlamia/claude-skillkit/main/social-media-seo/databases/`
- No API keys needed

**social-trend-monitor (yangliu2060) — knowledge only**
- Use for: trend research workflow, search query patterns, report structure
- **Translate SKILL.md from Chinese to English before use**
- Add food/restaurant domain filter
- Add Sweden/Norway specific search sources
- Uses web search only — no API keys needed

---

## SKILL 1: `restaurant-marketing` (Orchestrator)

### Purpose
Entry point for all restaurant owner interactions. Orchestrates the other skills. Handles onboarding, daily commands, promotions, calendar, and conversation.

### Phase 0 — Technical Setup (Installer, terminal only)

Single validation script before handing bot to client:

```bash
node scripts/setup.js --config social-marketing/config.json
```

Validates:
- OpenRouter API key works + gpt-image-1.5 accessible
- Composio API key works
- Each enabled platform has a working Composio `connected_account_id`
- Google Drive connected via Composio and folder accessible
- node installed (v18+)

Output per item: ✅ or ❌ with fix instruction. **Do not hand bot to client until all ✅.**

**Config: `social-marketing/config.json`**

```json
{
  "restaurant": {},
  "platforms": {
    "instagram": { "enabled": false, "composioAccountId": "ca_xxxxx" },
    "tiktok":    { "enabled": false, "composioAccountId": "ca_xxxxx" },
    "facebook":  { "enabled": false, "composioAccountId": "ca_xxxxx" }
  },
  "googleDrive": {
    "enabled": false,
    "folderId": "",
    "composioAccountId": "ca_gdrive_xxxxx",
    "localCachePath": "social-marketing/photos/",
    "inventoryPath": "social-marketing/photo-inventory.json"
  },
  "analytics": {
    "composio": { "enabled": true },
    "googleAnalytics": { "enabled": false, "propertyId": "" },
    "bookingTracking": { "method": "manual", "dailyBaseline": 0 },
    "utmSource": "social",
    "bookingUrl": ""
  },
  "timezone": "Europe/Stockholm",
  "country": "SE",
  "posting": {
    "schedule": ["11:00", "17:00", "20:30"]
  }
}
```

### Phase 1 — Restaurant Onboarding (Telegram, restaurant owner)

Max 7 questions. One at a time. Conversational. Under 10 minutes. No tech questions ever.

1. **Language** → switch immediately, stay in that language
2. **Restaurant name + cuisine** → follow up to pull detail
3. **Signature dishes** → ask visual description for each (feeds image pipeline)
4. **Vibe/atmosphere** → infers image style
5. **Typical guest** → informs hook writing
6. **Booking method + URL** → enables UTM tracking
7. **Google Drive photos?** → only if Drive is configured

End: *"Perfect. Type **generate post** when you want content."*

Save to `social-marketing/restaurant-profile.json`.

**Never ask in onboarding:** API keys, platforms, Composio, image style, booking tracking setup, TikTok warmup, competitor research.

### Phase 2 — Daily Commands (Telegram)

**`generate post`**
1. Call Skill 2 (`content-preparation`) → get slides + overlays
2. Send images via Telegram immediately
3. Confirm: "Ready to post?"
4. Post via Composio to all enabled platforms
5. TikTok: remind to add trending sound before publishing

**`generate pool`**
Run `generate post` × 5 in sequence. Week of content in one go.

**`check analytics`**
Call Skill 3 → plain language summary, max 5 sentences.

**`research competitors`**
Call Skill 3 → confirm first (takes 15–30 min), then run.

**`show trends`**
Call Skill 3 → latest weekly trend report summary.

### Conversational Intelligence

The agent is a marketing partner, not a command executor. This applies to every Telegram message.

**Personality:**
- Has opinions: *"I'd push the pasta tonight — your last pasta post did 3x average and it's Tuesday, your quietest night."*
- Pushes back: *"That hook is too generic. Let me try something sharper."*
- Celebrates: *"12K views in 4 hours. The story-behind-the-dish format is clearly working."*

**Context memory:**
- Remembers preferences stated in past conversations — never asks twice
- References past posts naturally: *"Like that carbonara post last week…"*
- Notices patterns: *"You've been posting every day this week — nice consistency."*

**Tone adaptation:**
- Owner is short and stressed → tight replies, no fluff
- Owner is chatty → match the warmth
- Owner sends voice note complaining → acknowledge before solving

**Answering any question:**
- *"How's my account doing?"* → pull data, answer conversationally
- *"Why did that post flop?"* → diagnose it honestly
- *"Is TikTok worth it for us?"* → opinion based on their data
- No deflecting. No *"I can only help with posts."* Answer everything.

**Never:**
- Bullet points when a sentence works
- *"I'd be happy to help with that!"*
- Asking a clarifying question when context is clear enough to act

### Natural Language Promotions

Owner types naturally. Agent parses passively always.

Detect: discount %, limited time, seasonal menu, new dish, event, happy hour, prix fixe, collaboration, "special tonight", "just got delivery of".

**Same-day / tonight promotions → post immediately, no approval needed:**
> *"50% off pizza tonight 9pm–midnight"* → generate, post, done. Speed over polish.

**Planned promotions → confirm + content calendar:**
> *"We have a tasting menu starting Friday"* → confirm details, build: teaser → launch → mid-run → last chance

**Spontaneous moments → offer to post:**
> *"We just got our truffle delivery"* → *"Want to post about that now? Ready in 5 minutes."*

60/40 rule during active promotions: 60% regular content, 40% promotional.

### Knowledge Gap Probing

Agent fills its own knowledge gaps over time. One question per day max, naturally timed, never during stress.

Triggers:
- Chef fields empty → *"Quick one — can you tell me about your chef? Where did they train?"*
- No recipe stories → *"Is there a dish with a story behind it?"*
- No sourcing info → *"Do you source from any specific local suppliers?"*
- Drive inventory shows missing dish category → *"I notice I don't have photos of your desserts yet — can you add some to Drive?"*

### Calendar Intelligence

Proactive awareness of booking-driving dates. Checked every Monday during weekly research cron.

Key dates (Sweden default — configurable per country):
Valentine's Day, Alla hjärtans dag, Walpurgis, Midsommar, graduation season (May–June), Mother's Day, Father's Day, Christmas/julbord season, New Year's Eve.

Lead times:
- 4 weeks out → mention, start planning
- 2 weeks out → begin teaser content
- 1 week out → active push
- Day before → urgency post
- Day of → reminder if relevant

Example Telegram (2 weeks before Midsommar):
> *"Midsommar is in 12 days. Worth pushing a summer menu or outdoor seating? I can start a teaser this week."*

Rules: Never autopost without confirmation. Always frame around bookings. Adapt to actual restaurant offering.

---

## SKILL 2: `content-preparation` (Asset Pipeline)

### Purpose
Decides WHAT to create and HOW. Finds reference photos, picks generation approach, coordinates external skills. Does NOT duplicate image generation logic — that lives in `food-photography-generation`.

### Content-Type Decision Matrix

For every post, evaluate in order:

```
1. WHAT CONTENT TYPE IS THIS?
   ├── Regular dish post
   ├── Promotion / time-sensitive
   ├── Knowledge base story (chef, recipe origin, sourcing)
   ├── Trend-driven format (from weekly research)
   └── Spontaneous moment

2. DO WE HAVE A REAL PHOTO?
   ├── Yes → img2img (primary, always preferred)
   └── No → txt2img (fallback)

3. WHAT'S THE URGENCY?
   ├── Same-day / tonight → speed over quality, eco mode
   └── Planned → quality mode, take the time

4. WHAT DID WEEKLY RESEARCH SAY?
   └── Apply trending format if relevant to content type
```

### Image Generation Approach by Scenario

**Real photo exists → img2img (always preferred)**
Even a blurry phone photo produces better results than pure text-to-image. The model understands the actual dish, colors, plating style. Output: polished professional version grounded in the real food.

```
photo from Drive → pass as image reference → gpt-image-1.5 via OpenRouter images/edits endpoint
→ polished version that looks like YOUR food, not generic AI food
```

Use `session_id` (eachlabs) or consistent base prompt (OpenRouter) to keep all 6 slides visually coherent.

**No photo, rich knowledge base → txt2img with specifics**
Knowledge base has recipe details, ingredient sourcing, chef background → use all of it in the prompt. Specific beats generic every time.

```
menu.json + recipes.json → extract dish details, textures, colors, plating
→ detailed prompt: "iPhone photo of hand-pulled pasta, bronze die extruded,
   rough texture visible, slow-cooked pork ragu with pulled texture,
   shaved pecorino, fresh basil, white ceramic bowl,
   dark walnut table, warm candlelit, same table throughout all slides"
```

**Trend-driven format → txt2img adapted to format**
Weekly research found "ingredient flatlay" blowing up this month → adapt prompt to that format regardless of dish.

**Same-day promotion, no photo → txt2img fast**
Standard quality on OpenRouter (faster params). Get it out fast.

**Knowledge base story (chef, sourcing) → mix**
Slide 1–4: real dish photos (img2img). Slides 5–6: AI-generated supporting imagery (ingredient sourcing, kitchen scene).

### Google Drive Inventory

Run `scripts/drive-inventory.js` on first setup and after every sync.

For each photo: detect dish via vision, categorize (dish/ambiance/kitchen/exterior), note quality, track usage.

```json
{
  "lastUpdated": "2026-04-15",
  "totalPhotos": 47,
  "byDish": {
    "Pasta Carbonara": {
      "files": ["carbonara-1.jpg", "carbonara-2.jpg"],
      "bestFile": "carbonara-2.jpg",
      "quality": "high",
      "lastUsed": "2026-04-10",
      "usedInPosts": 3
    }
  },
  "byCategory": {
    "dishes": 31,
    "ambiance": 8,
    "kitchen": 5,
    "exterior": 3
  },
  "missing": ["desserts", "bar area"],
  "note": "12 pasta photos, 0 dessert photos — trigger knowledge gap probe"
}
```

**Before every post:** Check inventory. If real photo exists for the dish → img2img. If not → txt2img. If a category has 0 photos → add to knowledge gap queue.

### Text Overlays

After image generation, add text overlays using `social-media-carousel` skill (inference-sh-8) or node-canvas fallback.

Rules (passed to whichever skill handles this):
- Reactions not labels: *"Wait… is this actually homemade??"* not *"Homemade pasta"*
- 4–6 words per line, 3–4 lines per slide
- No emoji (rendering issues)
- Safe zones: no text bottom 20% or top 10%
- Slide 6 always CTA: *"Book at [Restaurant] — link in bio"*
- Caption written by `social-media-seo` skill with keyword-first Instagram SEO

### Platform Dimensions

Always check `config.platforms` before generating. Use correct dimensions per enabled platform:

| Platform | Dimensions | Slides | Notes |
|----------|-----------|--------|-------|
| TikTok | 1024×1536 | 6 | Post as draft — owner adds music |
| Instagram | 1080×1350 | Up to 10 | Posts directly |
| Facebook | 1200×630 | 1 | Single image |

Never generate TikTok format if TikTok is disabled. Never use `tiktok-marketing/` as path — always `social-marketing/`.

---

## SKILL 3: `marketing-intelligence`

### Purpose
Data layer. Runs two scheduled jobs + on-demand research. Feeds insights back to Skill 1.

### Module A: Daily Analytics Cron

Runs every morning at 10:00 (restaurant timezone).

**Data sources:**

1. **Composio platform stats** — all analytics pulled via Composio connected accounts
   - TikTok: `TIKTOK_LIST_VIDEOS` + `TIKTOK_GET_USER_STATS`
   - Instagram: `INSTAGRAM_GET_MEDIA` + `INSTAGRAM_GET_INSIGHTS`
   - Facebook: equivalent Composio endpoints
   - Composio tools docs: https://docs.composio.dev/tools/tiktok
   - All calls use `connected_account_id` from `config.json`
3. **Google Analytics** (if configured)
   - Property: `config.analytics.googleAnalytics.propertyId`
   - Track: sessions from social → booking page, UTM conversions
   - UTM format: `?utm_source=instagram&utm_medium=social&utm_campaign=carousel&utm_content=YYYY-MM-DD`
   - GA4 API docs: https://developers.google.com/analytics/devguides/reporting/data/v1
4. **Booking data** — manual ask or API depending on config

**Diagnostic framework (applied every daily report):**

| Views | Bookings | Diagnosis | Action |
|-------|----------|-----------|--------|
| High | Up | Working | Scale — 3 hook variations now |
| High | Flat | CTA broken | Test new slide 6 text, check booking page |
| Low | Up | Hook broken | Content converts, nobody sees it — fix slide 1 |
| Low | Flat | Full reset | New format, trigger trend research |

**Daily report:**
- Save: `social-marketing/reports/YYYY-MM-DD-daily.md`
- Telegram message: max 5 sentences, plain language
- Include: best performer, what to do today, one suggested hook

**Hook performance tracking (`social-marketing/hook-performance.json`):**
Log per post: hook text, category, views delta, bookings delta, CTA used, date, img2img vs txt2img.

Decision rules:
- 50K+ views → double down, 3 variations immediately
- 10K–50K → keep in rotation
- 1K–10K → 1 more variation
- <1K twice → drop, try different

### Module B: Weekly Research Cron

Runs every Monday at 9:00 AM. Uses `social-trend-monitor` (adapted) + web search.

**Search queries (run via web search tool):**

Platform updates:
- `"TikTok slideshow algorithm [current month year]"`
- `"Instagram carousel reach algorithm [current month year]"`
- `"Instagram keyword SEO captions [current year]"`

Viral formats:
- `"restaurant TikTok viral [current month year]"`
- `"food Instagram carousel performing [current month]"`
- `"restaurant social media trend [current month year]"`

Industry:
- `"restaurant marketing social media [current month year]"`
- `"hospitality content strategy 2026"`

Sweden/Norway specific:
- `"restaurang TikTok trend [current month]"`
- `"mat Instagram Sverige trend [current month]"`

**Output: `social-marketing/trend-report.json`**

```json
{
  "weekOf": "2026-04-14",
  "platformUpdates": [
    { "platform": "instagram", "update": "...", "impact": "...", "action": "..." }
  ],
  "trendingFormats": [
    { "format": "...", "restaurantApplication": "...", "testNext": true }
  ],
  "hookTrends": ["...", "..."],
  "swedishMarket": ["...", "..."],
  "upcomingDates": ["Midsommar in 9 weeks", "..."],
  "recommendedActions": ["...", "..."]
}
```

**Monday Telegram message to owner:**
> *"Quick update this week: [2 sentences on what's working]. I'm going to try [format] for your posts this week."*

### Module C: Self-Improving Skill Loop

After each weekly research run, evaluate findings vs current strategy:

**New format found:**
- Add to active format library
- Test in next 2 posts
- Track vs existing formats in `hook-performance.json`
- If better → promote to primary rotation
- If worse → drop after 2 attempts

**Algorithm change detected:**
- Update content generation rules immediately
- Notify owner: *"TikTok changed something this week — I've adjusted how I write captions."*

**Format consistently underperforming:**
- *"The price reveal hook has missed 3 times in a row. Dropping it, switching to [X]."*
- Remove from rotation

All changes logged to `social-marketing/skill-updates.json` with date, what changed, why. Installer reviews at will.

**What cannot self-update:** API keys, platform connections, core skill architecture.

### Module D: Competitor Research (on demand)

Triggered by owner typing "research competitors" or Installer from terminal. Takes 15–30 min. Confirm before starting.

**Research across:**
1. TikTok — niche + city, 3–5 competitor accounts
2. Instagram — same, top performing posts
3. Google Maps — recent reviews of top 3 competitors (content gold)
4. TripAdvisor — same
5. Local press: `"best [cuisine] [city] 2026"`

**Per competitor capture:**
- Handle, followers, top hook formats, avg vs best views, posting frequency, CTA style, what they're NOT doing

**Gap analysis (most important):**
> *"Nobody in Stockholm is doing the ingredient sourcing story format. [Competitor A] has weak CTAs. Our angle: [specific opportunity]."*

Save: `social-marketing/competitor-research.json`. Refresh monthly or on demand.

---

## FILE STRUCTURE

```
social-marketing/
├── config.json                    ← Installer only — never shown in Telegram
├── restaurant-profile.json        ← From onboarding
├── photo-inventory.json           ← Auto-generated from Drive sync
├── competitor-research.json       ← From Skill 3
├── hook-performance.json          ← Per-post performance log
├── skill-updates.json             ← Self-improvement change log
├── strategy.json                  ← Current content strategy
├── photos/                        ← Google Drive cache (reference photos)
│   ├── dishes/
│   ├── ambiance/
│   ├── kitchen/
│   └── exterior/
├── knowledge-base/
│   ├── menu.json
│   ├── chef.json
│   ├── history.json
│   └── recipes.json
├── posts/
│   └── YYYY-MM-DD-HHmm/
│       ├── slide-1-raw.png        ← Before text overlay
│       ├── slide-1.png            ← Final with overlay
│       ├── ...
│       └── metadata.json          ← content type, approach used, platform
└── reports/
    ├── YYYY-MM-DD-daily.md
    ├── trend-reports/
    │   └── YYYY-MM-DD-weekly.md
    └── competitor/
        └── YYYY-MM-DD.md
```

> All paths use `social-marketing/` — never `tiktok-marketing/`. Platform-agnostic.

---

## KNOWLEDGE BASE ACTIVATION

Knowledge base is collected during onboarding and expanded via gap probing. It must actively drive content — not sit unused.

**Content types unlocked:**

| KB Source | Content Type | Booking Angle |
|-----------|-------------|---------------|
| Chef background | Chef story post | Builds prestige → reason to book |
| Recipe origin | Recipe history post | Emotional connection → authenticity |
| Sourcing info | Supplier story post | Quality signal → trust |
| Restaurant history | Legacy post | Local identity → loyalty |
| Menu details | Dish visual post | Appetite → booking |

Max 2 knowledge base content posts per week. Always end with booking CTA.

---

## SKILLS TO FIND BEFORE BUILDING

Search skills.sh and GitHub for these before building from scratch:

**1. Image text overlay**
node-canvas is fragile (native deps). Check `inference-sh-8/skills/social-media-carousel` — uses `infsh/html-to-image` for slide rendering, likely cleaner.
→ `https://skills.sh/inference-sh-8/skills/social-media-carousel`

**2. Google Analytics skill**
For UTM tracking + GA4 reporting.
→ Search: `site:skills.sh google analytics`

**3. Hermes built-in social skills**
Check `optional-skills/social/` in Hermes repo before building posting logic.
→ `https://github.com/NousResearch/hermes-agent/tree/main/optional-skills`

---

## COMMON MISTAKES

| Mistake | Fix |
|---------|-----|
| Asking owner about API keys or Composio | Installer handles all tech |
| Generating TikTok format when TikTok disabled | Check `config.platforms` first |
| Using `tiktok-marketing/` path | Always `social-marketing/` |
| Pure text-to-image when Drive photo exists | Always check inventory first — img2img is primary |
| Treating Drive photos as optional | They're mandatory reference sources, not a nice-to-have |
| Asking "what image style do you want?" | Infer from profile, refine after first post |
| Not sending images after generation | Always send files via Telegram — never just say "done" |
| Responding to "show me" with a question | Send the files immediately |
| Research runs once at setup | Weekly cron mandatory |
| Knowledge base collected, never used | Chef/recipe/sourcing → active content weekly |
| Formatted command required for promotions | Parse natural language passively, always |
| Same-day promotion treated like planned campaign | Speed first, eco mode, post immediately |
| Bullet points and formal tone in Telegram | Match owner's energy, conversational |
| Deflecting off-topic questions | Answer everything naturally |
| Using `gpt-image-1` | Always `gpt-image-1.5` |
| Multiple knowledge gap questions at once | One per day, naturally timed |
| Duplicating logic across custom and external skills | Custom = restaurant context; external = generic execution |

---

## DEPLOYMENT REPO ARCHITECTURE

The skills live in a private GitHub repo. Every new restaurant client = clone repo + run install script. Done in minutes.

**Repo:** `akira-agent/restaurant-marketing-skills` (private)

```
restaurant-marketing-skills/
│
├── skills/                           ← custom skills you build
│   ├── restaurant-marketing/
│   │   └── SKILL.md
│   ├── content-preparation/
│   │   └── SKILL.md
│   └── marketing-intelligence/
│       └── SKILL.md
│
├── adapted-skills/                   ← external skills adapted for Hermes
│   ├── food-photography-hermes/
│   │   └── SKILL.md                  ← eachlabs knowledge adapted, API calls removed
│   ├── social-media-seo-hermes/
│   │   └── SKILL.md                  ← rfxlamia + IG/TikTok filter only
│   └── social-trend-monitor-hermes/
│       └── SKILL.md                  ← yangliu2060 + translated + food filter
│
├── scripts/                          ← all Node.js scripts
│   ├── setup.js                      ← validation before client handoff
│   ├── drive-inventory.js            ← Google Drive photo cataloging
│   ├── daily-report.js               ← analytics cron
│   ├── weekly-research.js            ← trend research cron
│   ├── drive-sync.js                 ← Google Drive photo sync
│   └── aggregator.js                 ← cross-client intelligence (see below)
│
├── templates/
│   └── config.template.json          ← blank config for new deployment
│
├── docs/
│   └── PRD.md                        ← this document
│
└── install.sh                        ← one command setup
```

### install.sh

One command does everything for a new client:

```bash
#!/bin/bash
# Clone and run: ./install.sh

# Copy all skills to Hermes
cp -r skills/* ~/.hermes/skills/
cp -r adapted-skills/* ~/.hermes/skills/

# Prompt for API keys → write to ~/.hermes/.env
echo "OpenRouter API key:" && read -s OPENROUTER_API_KEY
echo "Composio API key:" && read -s COMPOSIO_API_KEY

# Write to .env
cat >> ~/.hermes/.env << EOF
OPENROUTER_API_KEY=$OPENROUTER_API_KEY
COMPOSIO_API_KEY=$COMPOSIO_API_KEY
EOF

# Create client working directory
mkdir -p social-marketing/{photos/{dishes,ambiance,kitchen,exterior},posts,reports/trend-reports,knowledge-base}
cp templates/config.template.json social-marketing/config.json

# Run validation
node scripts/setup.js --config social-marketing/config.json

echo "Setup complete. Fill in social-marketing/config.json then run: hermes"
```

### Per-client branches

Each restaurant client gets their own branch:

```
main                    ← master skill definitions, validated learnings
├── client/dansken      ← Dansken's instance + learnings
├── client/tradition    ← Restaurang Tradition's instance
├── client/rodolfino    ← Rodolfino's instance
└── client/[new]        ← each new client
```

Each client branch contains:
- Their `social-marketing/` directory (config, profile, photos, reports)
- Their `hook-performance.json` and `skill-updates.json`
- Their version of the skills (may diverge as self-improvement runs)

---

## CROSS-CLIENT INTELLIGENCE AGGREGATION

Every restaurant is unique — raw performance data doesn't transfer. What transfers is **structural and format learnings** stripped of restaurant-specific content.

```
What DOESN'T transfer:
"Pasta carbonara hook got 50K views at Dansken"
→ useless for a sushi restaurant

What DOES transfer:
"Story-behind-the-dish format outperforms
food-only shots across 6/8 clients"

"Same-day promo posts perform best at 6pm
not 9pm across all clients"

"img2img from real photos outperforms
txt2img by ~40% on engagement"

"Slide 1 with person reaction hook gets
2x completion vs food-only slide 1"
```

### How It Works

A lightweight aggregator agent runs every Monday after all client weekly reports are in.

**`scripts/aggregator.js` — what it does:**

1. Pull `hook-performance.json` from all active client branches
2. Strip all restaurant-specific content (dish names, restaurant names, captions)
3. Keep only structural data: format type, hook category, views delta, bookings delta, img2img vs txt2img, posting time
4. Find patterns that appear across 3+ different clients with consistent direction
5. Extract the structural insight — not the content
6. Open a GitHub PR to `main` with proposed skill update and supporting data
7. Installer reviews, merges or rejects

**Example PR generated by aggregator:**

```
Title: [Intelligence] Story-format hooks outperform food-only across 7 clients

Finding: Story-behind-the-dish hook category (format: "This dish has been 
made the same way since [year]...") outperforms generic food description 
hooks across 7/9 active clients. Average views delta: +340% vs baseline.

Applies to: all cuisine types, all markets tested (SE, NO)
Confidence: high (7 clients, 23 posts analyzed)

Proposed skill update: Promote story-format to primary rotation in 
restaurant-marketing/SKILL.md content strategy section.

Data: [link to aggregated performance table]
```

**Installer reviews in ~10 minutes:**
- Does this make sense intuitively?
- Any obvious confounding factors?
- Merge → all future client deployments get the improvement
- Reject with note → aggregator learns what Installer is looking for

### What the Aggregator Never Does

- Never merges automatically — always a PR, always Installer reviews
- Never transfers content (dish names, captions, photos)
- Never updates a live client without Installer merging first
- Never proposes updates based on fewer than 3 clients

### Client Sync After Main Update

After Installer merges a PR to main:

```bash
# Run on each client VM or automate via cron
git fetch origin main
git merge origin/main --no-commit
# Skills updated, client data untouched
hermes skills update
```

---

## COLD START SCENARIO

The first time the restaurant owner types "generate post" — no Drive photos synced yet, no competitor research done, no trend report exists, no hook performance data. The agent must handle this gracefully.

### What exists after onboarding:
- `restaurant-profile.json` — name, cuisine, dishes, vibe, guest type, booking URL
- `knowledge-base/menu.json` — dish names and descriptions from onboarding
- Nothing else

### Cold start flow:

**Step 1 — Acknowledge the situation honestly:**
> "First post! I don't have your photos yet so I'll generate AI images for now — once you add photos to Google Drive I'll use those instead and the quality will be much better."

**Step 2 — Generate txt2img using profile only:**
- Use cuisine + vibe from `restaurant-profile.json` to infer lighting/style
- Use signature dish from onboarding as subject
- No hook performance data → use the highest avg_engagement formula from `social-media-seo` databases as default
- No trend report → use evergreen food hook formats (story-behind-dish, price reveal, reaction hook)

**Step 3 — Trigger background tasks after first post:**
- Prompt owner to add photos to Google Drive: *"Drop your best dish photos in Drive and I'll use them from the next post."*
- Schedule competitor research for next day: *"I'll research what other restaurants in your area are doing — I'll have a report for you tomorrow."*
- Weekly research runs on next Monday automatically

**Step 4 — First post feedback loop:**
After first post goes live, ask once: *"How did those images look? Does the style feel right for your restaurant?"* Adjust base prompt accordingly. This is the only time the agent asks about image style.

**Rule:** Cold start never blocks posting. Agent always produces something, even if imperfect.

---

## ERROR HANDLING

### Google Drive Sync Failure

The image pipeline depends on Drive. When sync fails:

**Detection:** `scripts/drive-sync.js` returns non-zero exit or timeout.

**Fallback cascade:**
1. Drive sync fails → use locally cached photos from last successful sync
2. No local cache → fall back to txt2img with knowledge base context
3. No knowledge base → fall back to txt2img with profile only

**Never:** Block content generation because Drive is unavailable.

**Notify owner only if cache is stale (>7 days):**
> "Couldn't reach your Google Drive today — using photos from last week. Check your connection when you get a chance."

**Do not notify** for transient failures if cache is fresh.

### Composio Platform Errors

When a platform post fails via Composio:

- Log the error to `social-marketing/errors.json`
- Retry once after 60 seconds
- If retry fails → notify owner: *"Couldn't post to [platform] — there may be a connection issue. Want me to try again?"*
- Save the post to `social-marketing/posts/failed/` so content isn't lost
- Never silently drop a failed post

### OpenRouter / Image Generation Failure

- Retry once immediately
- If fails again → notify owner with honest ETA: *"Image generation is slow right now — I'll retry in 10 minutes."*
- Queue the request, retry automatically
- If still failing after 30 min → notify and offer to try tomorrow

---

## COST ESTIMATE PER CLIENT / MONTH

Understanding costs per client is essential for pricing. All estimates based on 3 posts/day, 30 days/month = ~90 posts/month.

### OpenRouter — Image Generation
- Model: `openai/gpt-image-1.5`
- Cost: ~$0.04–0.08 per image (check current OpenRouter pricing)
- 6 slides per post × 90 posts = 540 images/month
- **Estimated: $22–43/month per client**

### OpenRouter — LLM Calls
- Caption writing, hook generation, analytics interpretation, research synthesis
- ~50–100 LLM calls/day × 30 days = 1,500–3,000 calls/month
- Using a mid-tier model (e.g. claude-sonnet or gpt-4o-mini via OpenRouter)
- **Estimated: $3–8/month per client**

### Composio
- Check current Composio pricing tier for API call volume
- Google Drive syncs: ~1/day = 30/month
- Platform posts: 90/month
- Analytics pulls: ~30/month (daily cron)
- **Estimated: depends on Composio plan — verify at composio.dev/pricing**

### VM / Hosting (Hermes Agent)
- Hermes runs on a $5–10/month VPS (DigitalOcean, Hetzner, etc.)
- One VM can run multiple client agents
- **Estimated: $2–5/month per client** (shared across clients)

### Total Estimated Cost Per Client
```
Image generation:    $22–43/month
LLM calls:           $3–8/month
Composio:            TBD
VM (shared):         $2–5/month
─────────────────────────────────
Total:               ~$30–60/month per client
```

> ⚠️ **Verify all prices before quoting clients.** OpenRouter prices change. Check: https://openrouter.ai/models and https://composio.dev/pricing

**Pricing implication:** At 30–60 SEK/month cost, a 2,000–3,000 SEK/month client price gives healthy margin. Cost scales linearly with post volume — adjust if client wants more than 3 posts/day.

---

## CLIENT OFFBOARDING

When a client stops the service:

### Data that belongs to the client:
- All generated post images (`social-marketing/posts/`)
- Restaurant profile and knowledge base
- Performance reports
- Their own Google Drive photos (untouched — Composio connection simply disconnected)

### Offboarding checklist:
1. Export `social-marketing/` directory → zip and send to client or upload to their Drive
2. Disconnect Composio connected accounts (TikTok, Instagram, Facebook, Drive)
3. Archive client branch in GitHub repo (do not delete — may reactivate)
4. Remove API keys from VM `.env`
5. Shut down or repurpose the client VM
6. Note in aggregator: exclude this client's data from future cross-client analysis

### Data retention:
- Client branch kept in GitHub for 12 months after offboarding
- After 12 months: delete branch unless reactivated
- Aggregated learnings derived from their data remain in `main` (anonymized, no restaurant-specific content)

---

## OUT OF SCOPE (v2.0)

- Video content (slideshows only)
- Direct booking system API integrations (manual tracking sufficient for v2)
- Multi-restaurant / multi-location
- White-label client dashboard
- Review monitoring (separate tool)
- TikTok warmup (note in setup docs only)
