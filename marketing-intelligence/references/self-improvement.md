# Self-Improvement Loop (Module C)

Runs after every Module B (weekly research) and after every 5 posts.

## Inputs

- Last 20 `hook-performance` records from `memory` or `$HOST_AGENT_HOME/social-marketing/hook-performance.json`.
- Current `$HOST_AGENT_HOME/social-marketing/strategy.json`.
- Latest `$HOST_AGENT_HOME/social-marketing/trend-report.json`.

## Decision Logic

### 1. Per-category performance rollup

For each `hookCategory` in the last 20 records:

- `avgViews` = mean `viewsDelta`
- `avgBookings` = mean `bookingsDelta`
- `consecutiveMisses` = count of trailing records with `viewsDelta < 1000`

### 2. Apply thresholds

| Condition | Action |
|---|---|
| `avgViews > 50000` | Promote to primary rotation. Add 2 variations to next week. |
| `10000 ≤ avgViews < 50000` | Keep in rotation at standard frequency. |
| `avgViews < 1000` for 2+ consecutive posts in this category | **Drop** the category. Remove from `strategy.json.activeCategories`. Wait 4 weeks before retrying. |
| `avgBookings ≥ 2` per post | Mark `highConverting: true` — prioritize even if views are modest. |

### 3. New format from trend report

If `trend-report.json.trendingFormats[*].testNext === true`:

- Add to `strategy.json.testQueue` with `{ format, addedAt, attempts: 0 }`.
- Content-preparation pulls from `testQueue` when picking the next post's angle (up to 2/week).
- After 2 attempts, evaluate and either promote to `activeCategories` or drop.

### 4. Algorithm change from trend report

If `trend-report.json.platformUpdates[*]` contains an algorithm change with `impact` relevant to the restaurant's platforms:

- Update `strategy.json.platformRules.<platform>` with the new guidance.
- Surface to orchestrator:
  > *"TikTok changed something this week — I've adjusted how I write captions for it."*

## strategy.json Schema

```json
{
  "updatedAt": "2026-04-17",
  "activeCategories": [
    { "category": "story-behind-dish", "priority": 1, "weeklyTarget": 3 },
    { "category": "reaction", "priority": 2, "weeklyTarget": 2 },
    { "category": "sourcing", "priority": 2, "weeklyTarget": 1 }
  ],
  "testQueue": [
    { "format": "ingredient flatlay with handwritten labels", "addedAt": "2026-04-14", "attempts": 0 }
  ],
  "droppedCategories": [
    { "category": "price-reveal", "droppedAt": "2026-04-10", "reason": "3 consecutive <1K", "retryAfter": "2026-05-08" }
  ],
  "platformRules": {
    "instagram": {
      "prefer": ["carousel", "reel"],
      "captionFirst125Chars": "keyword-first — cuisine + city + dish"
    },
    "tiktok": {
      "prefer": ["slideshow"],
      "note": "Post as draft; owner adds trending sound"
    }
  }
}
```

## skill-updates.json (Append-Only Change Log)

Every Module C run writes entries:

```json
{
  "date": "2026-04-17",
  "type": "category-drop",
  "details": "Dropped price-reveal after 3 consecutive <1K. Retry after 2026-05-08.",
  "reason": "hook-performance threshold"
}
```

Types: `category-drop`, `category-promote`, `format-added-to-test`, `format-promoted`, `platform-rule-changed`.

The Installer reads this file periodically to audit what the system has been learning.

## What Cannot Self-Update

- API keys — Installer.
- Platform OAuth connections — Installer.
- Skill architecture — Installer (via PR from the cross-client aggregator).
- Restaurant profile — owner (via Telegram conversation).

## Surface to Orchestrator

When a decision is made, return a one-line description the orchestrator can reword for the owner:

- Drop: *"The price-reveal hook has missed 3 times in a row. Dropping it, switching to sourcing stories."*
- Promote: *"Story-behind-dish is our top performer — I'll run 3 of those this week."*
- Test: *"New format trending this week — ingredient flatlays. I'll test one for you."*
