---
name: social-trend-monitor-hermes
description: Knowledge-only adaptation of the yangliu2060 social-trend-monitor skill. Provides the trend research workflow, search query patterns, and report structure used by marketing-intelligence Module B (weekly research cron). Translated from Chinese, filtered to food/restaurant domain, with Sweden/Norway sources added.
metadata:
  hermes-agent:
    requirements:
      env: []
      binaries:
        - node
---

# Social Trend Monitor (Hermes Adaptation)

**Knowledge document. No API keys required.** Used by `marketing-intelligence` Module B to run the weekly research cron. Research is performed via the web search tool available to Hermes — this skill provides the query patterns, filtering rules, and report structure.

**Upstream source:** https://skills.sh/yangliu2060/smith--skills/social-trend-monitor

**What was adapted from upstream:**
- **Translated from Chinese to English.** The original SKILL.md is in Chinese — do not ship untranslated.
- **Food / restaurant domain filter** applied to all search queries.
- **Sweden / Norway specific sources** added (when `config.country` matches).
- No extra API keys — web search only.

---

## Weekly Research Workflow

Every Monday at 09:00 (restaurant timezone), `scripts/weekly-research.js` runs this workflow.

### 1. Compute date tokens

- `[current month year]` — e.g. "April 2026".
- `[current year]` — e.g. "2026".
- `[current month]` — e.g. "April".

### 2. Run searches by bucket

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

**Sweden / Norway (only if `config.country` in ["SE", "NO"]):**
- `"restaurang TikTok trend [current month]"`
- `"mat Instagram Sverige trend [current month]"`
- `"restaurant Oslo TikTok [current month]"` (NO only)

### 3. Filter results

- **Include:** food, restaurant, hospitality, café, bar, chef, cuisine, dining.
- **Exclude:** crypto, fashion, fitness, general influencer / lifestyle content.
- **Exclude:** results older than 60 days unless they're a foundational algorithm update.

### 4. Synthesize the report

Produce `social-marketing/trend-report.json` with the schema defined in `marketing-intelligence` Module B. Also produce a narrative Markdown version under `social-marketing/reports/trend-reports/YYYY-MM-DD-weekly.md`.

---

## Report Structure

```
# Weekly Trend Report — [Week of YYYY-MM-DD]

## Platform Updates
- [Platform]: [update] → [impact on us] → [action]

## Trending Formats
- [Format]: [description] → [restaurant application]

## Hook Trends
- [Short bullet] — [why it's working]

## Local Market (if applicable)
- [Sweden/Norway specific signal]

## Upcoming Dates
- [Date]: [weeks out] → [suggested action]

## Recommended Actions for This Week
1. [Action]
2. [Action]
3. [Action]
```

---

## Self-Improvement Integration

After the report is written, `marketing-intelligence` Module C evaluates findings vs. current `strategy.json`. New format candidates go into the test queue. Underperformers get dropped. All changes are logged to `skill-updates.json`.

This is what makes the system self-improving. A report that gets written and never read is just noise — `marketing-intelligence` is the loop that closes it.

---

## What This Skill Does Not Do

- No API calls beyond web search.
- No report writing happens here — the workflow is documented, but `scripts/weekly-research.js` is what executes it.
- No actions on the owner's account. Only `restaurant-marketing` can post or notify.
