---
name: marketing-intelligence
description: Data layer for restaurant social marketing — daily analytics, weekly trend research, on-demand competitor research, and self-improvement loop. Load when the restaurant-marketing orchestrator calls for `check analytics`, `show trends`, `research competitors`, or when evaluating whether a hook category is still worth rotating. Uses Hermes's web_search, browser_*, and memory tools directly.
---

# Marketing Intelligence

Analytical brain for the restaurant. Four workflows — two scheduled, two on-demand. All outputs are structured files + a short summary returned to the [restaurant-marketing orchestrator](../restaurant-marketing/SKILL.md) for the owner. **You never message the owner directly.**

Uses Hermes's native tools for research (`web_search`, `web_extract`, `browser_navigate`, `browser_vision`) and for learning persistence (`memory`, `session_search`). Platform stats come through Composio SDK scripts.

## Module A — Daily Analytics (Scheduled, 10:00 local)

**Trigger:** cron at `config.timezone` 10:00, before the first post of the day. Also runs on `check analytics` command from the orchestrator.

**Execution:**

1. `read_file` `$HOST_AGENT_HOME/social-marketing/config.json` for timezone, bookingTracking method, platforms enabled.
2. Invoke `terminal`:
   ```bash
   node $HOST_AGENT_HOME/restaurant-social-marketing-skill/scripts/daily-report.js --config $HOST_AGENT_HOME/social-marketing/config.json --days 3
   ```
   The script pulls Composio platform stats for each enabled platform (TikTok, Instagram, Facebook), pulls booking data per `bookingTracking.method`, cross-references views↔bookings over a 3-day window, and writes `$HOST_AGENT_HOME/social-marketing/reports/<YYYY-MM-DD>-daily.md` + appends to `$HOST_AGENT_HOME/social-marketing/hook-performance.json`.
3. `read_file` the daily report; extract the Telegram-summary block at the bottom (script prints `---TELEGRAM-SUMMARY---` markers).
4. `memory` append the day's diagnosis + action so next session knows yesterday's verdict.
5. Return the 5-sentence summary to the orchestrator.

**Diagnostic framework + hook-performance schema + booking-tracking branches:** [references/daily-analytics.md](references/daily-analytics.md).

## Module B — Weekly Trend Research (Scheduled, Monday 09:00)

**Trigger:** cron Monday 09:00 local. Also on `show trends` command if no report exists for this week.

**Execution:**

1. Compute date tokens: `<current month>`, `<current year>`, `<current month year>`.
2. `read_file` `$HOST_AGENT_HOME/social-marketing/config.json` for `country` (gates the local-market query bucket).
3. Invoke `web_search` for each query in the buckets below — parallelize if Hermes supports multi-query. Full query list: [references/trend-queries.md](references/trend-queries.md).
   - Platform updates (algorithm changes, format rollouts)
   - Viral formats in restaurant / food niche
   - Industry trends (hospitality content strategy)
   - Local market (Sweden / Norway when `country in [SE, NO]`)
4. For each result, `web_extract` for body content when the snippet isn't enough.
5. Synthesize findings — you (LLM) do the synthesis, not a script. Write:
   - Structured: `$HOST_AGENT_HOME/social-marketing/trend-report.json` (schema in [references/trend-queries.md](references/trend-queries.md))
   - Narrative: `$HOST_AGENT_HOME/social-marketing/reports/trend-reports/<YYYY-MM-DD>-weekly.md`
   (use `patch` or `terminal` to write)
6. `memory` append: the top new format found + whether to test next week.
7. Return Monday summary to orchestrator:
   > *"Quick update: [2 sentences on what's working]. I'm going to try [format] for your posts this week."*

The old `scripts/weekly-research.js` only wrote a query plan — we now do the actual web work in-session.

## Module C — Self-Improving Loop

Runs after every Module B completes, and after every 5 posts (whichever comes first).

**Execution:**

1. `memory` → pull the last 20 `hook-performance` records for this restaurant.
2. Group by `hookCategory`. For each category:
   - Average `viewsDelta` and `bookingsDelta`.
   - Count consecutive misses (<1K views twice → drop signal).
3. Compare against the trend report — any new format flagged `testNext: true`?
4. Write changes to `$HOST_AGENT_HOME/social-marketing/skill-updates.json` (append-only log: date, what changed, why).
5. Surface to orchestrator when a category drops from the rotation:
   > *"The price-reveal hook has missed 3 times in a row. Dropping it, switching to [X]."*

**Decision thresholds + strategy.json schema:** [references/self-improvement.md](references/self-improvement.md).

What cannot self-update: API keys, platform connections, skill architecture. Those require the Installer.

## Module D — Competitor Research (On Demand)

**Trigger:** `research competitors` from the orchestrator. Takes 15–30 min. The orchestrator confirms with the owner before starting.

**Execution:**

1. `read_file` `$HOST_AGENT_HOME/social-marketing/restaurant-profile.json` for cuisine, location, typicalGuest.
2. Use `web_search` to find 3–5 competitor accounts:
   - `"<cuisine> TikTok <city>"` and `"best <cuisine> <city> 2026"`
   - `"<cuisine> Instagram <city>"`
3. For each competitor, use `browser_navigate` + `browser_vision` to inspect their Instagram or TikTok profile:
   - Capture: handle, follower count, top-performing hook formats, avg vs best views, posting frequency, CTA style.
   - **Most important: what they are NOT doing.** Gap analysis is the valuable output.
4. `web_search` + `web_extract` on Google Maps and TripAdvisor review pages for the top 3 competitors — extract reviewer language (real phrases real customers use).
5. `web_search` for local press mentions: `"best <cuisine> <city> <year>"`.
6. Synthesize — write:
   - Structured: `$HOST_AGENT_HOME/social-marketing/competitor-research.json`
   - Narrative: `$HOST_AGENT_HOME/social-marketing/reports/competitor/<YYYY-MM-DD>.md`
7. Return a gap-focused summary to the orchestrator — not a competitor-stats dump. Example:
   > *"Nobody in <city> is doing the ingredient-sourcing story format. <Competitor A> has weak CTAs. Our angle: <specific opportunity>."*

Full template + per-competitor capture fields: [references/competitor-research.md](references/competitor-research.md).

## What You Do Not Do

- Talk to the owner directly — orchestrator owns Telegram.
- Write captions or generate posts — content-preparation owns that.
- Post to platforms — platform posting belongs to the orchestrator's post step.
- Fabricate data. If a source is disabled (e.g. booking tracking = manual, GA = off), surface the gap honestly so the orchestrator can ask the owner. A made-up number is a trust killer.

## Cross-Client Aggregator (Network-Level)

Separate agent (`scripts/aggregator.js`) runs at network level, not per-client. It strips hook-performance records of restaurant-specific content and finds patterns across 3+ clients, then opens a PR to the skills repo proposing updates. Your job here is to **keep the hook-performance schema stable** so the aggregator can parse records from all clients. Schema: [references/daily-analytics.md](references/daily-analytics.md).
