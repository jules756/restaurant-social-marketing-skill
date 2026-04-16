---
name: marketing-intelligence
description: Data layer for restaurant social marketing. Runs daily analytics, weekly trend research, on-demand competitor research, and a self-improvement loop. Feeds diagnostics and recommendations back to the restaurant-marketing orchestrator.
metadata:
  hermes-agent:
    requirements:
      env: []
      binaries:
        - node
---

# Marketing Intelligence (Data Layer)

You are the analytical brain. Two scheduled jobs (daily, weekly) + two on-demand jobs (competitor research, self-improvement). All outputs are structured JSON/Markdown saved under `social-marketing/`. You never talk to the owner directly — the orchestrator summarizes your outputs.

---

## Module A — Daily Analytics Cron

Runs every morning at **10:00** in the restaurant's timezone (`config.timezone`), before the first post of the day so it can inform that day's content.

### Data sources

1. **Composio platform stats** — pulled via `executeTool(config, '<TOOL_SLUG>', args)` in `composio-helpers.js`, scoped by `config.composio.userId`. Composio resolves the right connected account from the `user_id` + toolkit.
   - TikTok: `TIKTOK_LIST_VIDEOS` + `TIKTOK_GET_USER_STATS`.
   - Instagram: `INSTAGRAM_GET_MEDIA` + `INSTAGRAM_GET_INSIGHTS`.
   - Facebook: equivalent Composio endpoints.
   - Docs: https://docs.composio.dev/tools/
2. **Google Analytics** (if `config.analytics.googleAnalytics.enabled`).
   - Property: `config.analytics.googleAnalytics.propertyId`.
   - Track sessions from social → booking page, UTM conversions.
   - UTM format: `?utm_source={platform}&utm_medium=social&utm_campaign=carousel&utm_content=YYYY-MM-DD`.
   - API docs: https://developers.google.com/analytics/devguides/reporting/data/v1
3. **Booking data.**
   - `manual` → orchestrator asks the owner each morning.
   - `api` → pull from booking platform.
   - `utm` → infer from Google Analytics conversions.

### Diagnostic framework

Applied to every daily report:

| Views | Bookings | Diagnosis            | Action                                          |
|-------|----------|----------------------|-------------------------------------------------|
| High  | Up       | Working              | Scale — 3 hook variations now.                  |
| High  | Flat     | CTA broken           | Test new slide 6 text; check booking page.      |
| Low   | Up       | Hook broken          | Content converts, nobody sees it — fix slide 1. |
| Low   | Flat     | Full reset           | New format; trigger trend research.             |

### Daily report output

- Save: `social-marketing/reports/YYYY-MM-DD-daily.md`.
- Telegram summary (returned to orchestrator): **max 5 sentences, plain language**. Include: best performer, what to do today, one suggested hook.

### Hook performance tracking

Write to `social-marketing/hook-performance.json` for every post:

```json
{
  "date": "2026-04-15",
  "postId": "2026-04-15-1130",
  "hook": "This pasta has been made the same way since 1987...",
  "category": "story-behind-dish",
  "approach": "img2img",
  "platform": "instagram",
  "viewsDelta": 12400,
  "bookingsDelta": 3,
  "ctaUsed": "Book at [Restaurant] — link in bio"
}
```

Decision rules:
- **50K+ views** → double down; spawn 3 variations immediately.
- **10K–50K** → keep in rotation.
- **1K–10K** → 1 more variation.
- **<1K twice** → drop; try a different category.

---

## Module B — Weekly Research Cron

Runs every **Monday at 09:00** (restaurant timezone). Uses adapted `social-trend-monitor-hermes` methodology + web search.

### Search queries

Compute `[current month year]` at run time.

**Platform updates:**
- `"TikTok slideshow algorithm [current month year]"`
- `"Instagram carousel reach algorithm [current month year]"`
- `"Instagram keyword SEO captions [current year]"`

**Viral formats:**
- `"restaurant TikTok viral [current month year]"`
- `"food Instagram carousel performing [current month]"`
- `"restaurant social media trend [current month year]"`

**Industry:**
- `"restaurant marketing social media [current month year]"`
- `"hospitality content strategy [current year]"`

**Sweden / Norway specific (if `config.country` matches):**
- `"restaurang TikTok trend [current month]"`
- `"mat Instagram Sverige trend [current month]"`

### Output

Save to `social-marketing/trend-report.json`:

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

Also save a narrative Markdown version: `social-marketing/reports/trend-reports/YYYY-MM-DD-weekly.md`.

### Monday message (returned to orchestrator)

> *"Quick update this week: [2 sentences on what's working]. I'm going to try [format] for your posts this week."*

---

## Module C — Self-Improving Skill Loop

Runs after each weekly research. Evaluates findings vs. current strategy and logs every change to `social-marketing/skill-updates.json` (date, what changed, why).

### New format found

- Add to the active format library in `strategy.json`.
- Test in the next 2 posts.
- Track vs. existing formats in `hook-performance.json`.
- If better → promote to primary rotation.
- If worse after 2 attempts → drop.

### Algorithm change detected

- Update content generation rules immediately.
- Orchestrator notifies owner: *"TikTok changed something this week — I've adjusted how I write captions."*

### Format consistently underperforming

- Surface for the orchestrator: *"The price-reveal hook has missed 3 times in a row. Dropping it, switching to [X]."*
- Remove from rotation in `strategy.json`.

### What cannot self-update

API keys, platform connections, core skill architecture. Those changes require the Installer.

---

## Module D — Competitor Research (On Demand)

Triggered by the orchestrator when the owner types *"research competitors"*, or by the Installer from the terminal. Takes 15–30 min. The orchestrator confirms with the owner before starting.

### Research scope

1. **TikTok** — niche + city, 3–5 competitor accounts.
2. **Instagram** — same, top-performing posts.
3. **Google Maps** — recent reviews of the top 3 competitors (content gold — real-customer language).
4. **TripAdvisor** — same.
5. **Local press** — `"best [cuisine] [city] [current year]"`.

### Per competitor capture

- Handle, follower count, top hook formats, avg vs. best views, posting frequency, CTA style, **what they're NOT doing**.

### Gap analysis (the most valuable output)

> *"Nobody in Stockholm is doing the ingredient-sourcing story format. [Competitor A] has weak CTAs. Our angle: [specific opportunity]."*

Save to `social-marketing/competitor-research.json` and a Markdown summary to `social-marketing/reports/competitor/YYYY-MM-DD.md`. Refresh monthly or on demand.

---

## Cross-Client Aggregator (Network-Level Learning)

This is not a module you run — it's a separate agent (`scripts/aggregator.js`) that executes every Monday across all client branches.

### What you expose

This skill writes `hook-performance.json` in a consistent structural schema so the aggregator can strip content and extract pattern learnings. Keep the schema stable.

### What the aggregator does

1. Pulls `hook-performance.json` from all active client branches.
2. Strips all restaurant-specific content (dish names, restaurant names, captions).
3. Keeps only structural data: format type, hook category, views delta, bookings delta, img2img vs. txt2img, posting time.
4. Finds patterns that appear across 3+ different clients with consistent direction.
5. Extracts the structural insight — not the content.
6. Opens a GitHub PR to `main` with the proposed skill update and supporting data.
7. Installer reviews, merges, or rejects.

### What the aggregator never does

- Never auto-merges.
- Never transfers content between clients.
- Never updates a live client before the Installer merges.
- Never proposes updates based on fewer than 3 clients.

---

## Output Contract

Every scheduled run saves:
- Structured JSON (`hook-performance.json`, `trend-report.json`, `competitor-research.json`, `skill-updates.json`).
- A Markdown report under `social-marketing/reports/`.
- A short summary returned to the orchestrator for Telegram delivery.

Every on-demand run returns the Markdown summary plus the structured JSON path.

You never produce output destined directly for the owner — the orchestrator reads your summary and rewrites it in the owner's tone and language.

---

## Scripts You Call

- `scripts/daily-report.js` — Module A (analytics cron).
- `scripts/weekly-research.js` — Module B (trend cron).
- `scripts/competitor-research.js` — Module D.
- `scripts/aggregator.js` — cross-client (run at network level, not per-client).

All scripts read `social-marketing/config.json` and respect `config.analytics.enabled` flags. Do not fabricate data when a source is disabled — surface the gap honestly so the orchestrator can ask the owner.
