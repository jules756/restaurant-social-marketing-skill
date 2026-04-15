---
name: social-media-seo-hermes
description: Knowledge-only adaptation of the rfxlamia social-media-seo skill. Provides 100+ caption and hook formulas with engagement metrics, filtered to Instagram and TikTok only. Used by content-preparation for caption and hook writing.
metadata:
  hermes-agent:
    requirements:
      env: []
      binaries:
        - node
---

# Social Media SEO (Hermes Adaptation)

**Knowledge document. No API keys required.** Used by `content-preparation` to write captions and hooks. Used by `marketing-intelligence` to reason about why a hook category is or isn't working.

**Upstream source:** https://skills.sh/rfxlamia/claude-skillkit/social-media-seo

**What was adapted from upstream:**
- Filter to Instagram and TikTok only. Remove all Twitter/Threads content.
- Embed the 7 CSV databases locally, or fetch from GitHub raw:
  `https://raw.githubusercontent.com/rfxlamia/claude-skillkit/main/social-media-seo/databases/`
- Keep the `avg_engagement` scoring column — this is what powers cold-start hook selection.
- No API keys required. Data is static reference.

---

## Database Files (Embed or Fetch)

Expected under `adapted-skills/social-media-seo-hermes/databases/`:

- `hook_formulas.csv` — 100+ hook patterns with `avg_engagement` score and category.
- `caption_templates.csv` — caption structures (keyword-first Instagram SEO).
- `cta_variations.csv` — slide-6 CTA patterns.
- `keyword_primer.csv` — food / restaurant keyword seeds.

If the databases are not embedded, fetch from the upstream URL above on first use and cache locally.

---

## How It Is Used

### Cold start (first post)

`marketing-intelligence` has no `hook-performance.json` data yet. Pull the highest `avg_engagement` hook formula from the restaurant's cuisine category and use it.

### Ongoing

Every post writes a record into `hook-performance.json` referencing which formula was used. After 30 days, this client's own performance data overrides the generic `avg_engagement` score.

### Instagram SEO

Captions are **keyword-first**, not personality-first. The first 125 characters of an Instagram caption are indexable — lead with what the post is about in natural language, not with a hook.

```
Good:
"Hand-pulled rigatoni with slow-cooked pork ragu — bronze-die extruded,
simmered 6 hours. Book at Dansken, link in bio. Stockholm's best pasta
[hook continues] …"

Bad:
"You won't BELIEVE what happened in our kitchen today 👀 [keywords at line 9]"
```

### Hashtag Strategy

- 3–5 hyper-specific hashtags (neighborhood, cuisine, dish).
- 3–5 mid-tail hashtags (category).
- Skip mega hashtags (>10M posts) — they bury small accounts.

---

## Hook Categories (High-Signal for Restaurants)

| Category             | Pattern                                    | When to use                     |
|----------------------|--------------------------------------------|---------------------------------|
| Story-behind-dish    | "This dish has been made the same way…"    | Knowledge-base content          |
| Price reveal         | "Guess how much this costs"                 | Value-signaling restaurants     |
| Reaction hook        | "Wait — is this actually homemade??"        | Visual food content             |
| Sourcing story       | "Our [ingredient] comes from…"              | Premium / supplier narrative    |
| Behind-the-scenes    | "6am in our kitchen"                        | Chef / craft content            |
| Reservation urgency  | "We have 3 tables left for Saturday"        | Booking push                    |

`marketing-intelligence` tracks which categories are performing for this client and promotes/demotes accordingly.

---

## What This Skill Does Not Do

- No API calls.
- No caption generation happens here — `content-preparation` generates the final text; this skill provides the patterns and scoring.
- No cross-client learning — that belongs to the aggregator.
