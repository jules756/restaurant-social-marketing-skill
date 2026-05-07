# Weekly Trend Research — Queries + Output Schema

## Query Buckets (run via `web_search`)

Compute tokens at run time: `<month>` = "April", `<year>` = "2026", `<month year>` = "April 2026".

### Platform updates

- `TikTok slideshow algorithm <month year>`
- `Instagram carousel reach algorithm <month year>`
- `Instagram keyword SEO captions <year>`
- `Facebook restaurant page reach <month year>`

### Viral formats (restaurant/food niche)

- `restaurant TikTok viral <month year>`
- `food Instagram carousel performing <month>`
- `restaurant social media trend <month year>`
- `food content hook formats <month year>`

### Industry signals

- `restaurant marketing social media <month year>`
- `hospitality content strategy <year>`
- `small restaurant Instagram growth <year>`

### Local market (only if `config.country in [SE, NO]`)

- SE: `restaurang TikTok trend <month>`, `mat Instagram Sverige trend <month>`
- NO: `restaurant Oslo TikTok <month>`, `mat Instagram Norge trend <month>`

For markets outside SE/NO, use `web_search` once at onboarding to learn local restaurant/food content language, then adapt these templates per market.

## Filter Results

- Include: food, restaurant, hospitality, café, bar, chef, cuisine, dining terms.
- Exclude: crypto, fashion, fitness, general lifestyle/influencer content unfiltered.
- Exclude: posts older than 60 days unless it's a foundational algorithm update (rare).

## Output Schema

### Structured — `/host-agent-home/social-marketing/trend-report.json`

```json
{
  "weekOf": "2026-04-14",
  "platformUpdates": [
    {
      "platform": "instagram",
      "update": "Reels boosted over carousels in feed algorithm",
      "impact": "Carousel reach down ~30% over 2 weeks",
      "action": "Start mixing Reels into Instagram rotation; keep carousels for multi-slide storytelling"
    }
  ],
  "trendingFormats": [
    {
      "format": "ingredient flatlay with handwritten labels",
      "restaurantApplication": "Works for tasting menus, sourcing-story posts",
      "testNext": true
    }
  ],
  "hookTrends": [
    "POV: you ordered the special and..",
    "Chef's 3 rules for [dish]"
  ],
  "localMarket": [
    "Swedish restaurant accounts leaning into 'lokalt producerat' language",
    "Stockholm food scene: olive oil / fermentation content trending"
  ],
  "upcomingDates": [
    "Midsommar in 9 weeks",
    "Graduation season starts in 3 weeks"
  ],
  "recommendedActions": [
    "Test one ingredient-flatlay post this week",
    "Start Midsommar teaser content in 5 weeks"
  ],
  "sources": [
    "https://…",
    "https://…"
  ]
}
```

### Narrative — `/host-agent-home/social-marketing/reports/trend-reports/<YYYY-MM-DD>-weekly.md`

```
# Weekly Trend Report — Week of <YYYY-MM-DD>

## Platform Updates
- [Platform]: [update] → [impact] → [action]

## Trending Formats
- [Format]: [description] → [restaurant application]

## Hook Trends
- [Short bullet] — [why it's working]

## Local Market (if applicable)
- [City/country specific signal]

## Upcoming Dates
- [Date]: [weeks out] → [suggested action]

## Recommended Actions This Week
1. [Action]
2. [Action]
3. [Action]

## Sources
- [URL]
- [URL]
```

## Monday Telegram Summary

Orchestrator gets a 2-3 sentence snippet:

> *"Quick update: Instagram carousels are losing reach to Reels this month. I'm going to test one Reel for you this week, plus an ingredient-flatlay post — that format's blowing up for food accounts."*

Never mention Composio, cron, script paths, or internal tool names.
