# Daily Analytics — Framework + Schema

## Data Sources

| Source | Method | When |
|---|---|---|
| Platform stats | Composio SDK (`scripts/daily-report.js` calls the SDK per enabled platform) | Always |
| Google Analytics | GA4 Data API (if `config.analytics.googleAnalytics.enabled`) | Optional |
| Booking data | Depends on `config.analytics.bookingTracking.method` | Always |

### Platform tool slugs (called via `mcp-client.js`)

| Platform | Tools called |
|---|---|
| TikTok | `TIKTOK_LIST_VIDEOS`, `TIKTOK_GET_USER_STATS` |
| Instagram | `INSTAGRAM_GET_MEDIA`, `INSTAGRAM_GET_INSIGHTS` |
| Facebook | `FACEBOOK_GET_PAGE_INSIGHTS`, `FACEBOOK_GET_POST_INSIGHTS` |

### Booking tracking branches

- `manual` → orchestrator asks the owner each morning (*"How many covers yesterday?"*). You flag `promptRequired: true` in the summary.
- `api` → daily-report.js pulls from the configured booking platform (OpenTable/Resy/etc.).
- `utm` → infer from Google Analytics conversions on the booking URL.

## Diagnostic Framework (Views × Bookings)

Applied every day:

| Views | Bookings | Diagnosis | Action |
|---|---|---|---|
| High | Up | Working | Scale — 3 hook variations in this category. |
| High | Flat | CTA broken | Test new slide-6 text; verify the booking page loads and tracks. |
| Low | Up | Hook broken | Content converts when seen — fix slide 1 hook, same body. |
| Low | Flat | Full reset | Drop the format, trigger Module B trend research. |

"High" = above the restaurant's own rolling 7-day mean for the platform. "Up" = bookings > yesterday + >0 attributable to posts (UTM or manual correlation).

## Hook-Performance Schema (stable — don't break)

Append one record per posted slide-set to `/host-agent-home/social-marketing/hook-performance.json`:

```json
{
  "date": "2026-04-15",
  "postId": "2026-04-15-1130",
  "hook": "This pasta has been made the same way since 1987",
  "hookCategory": "story-behind-dish",
  "approach": "img2img",
  "platform": "instagram",
  "dish": "Bolognese",
  "viewsDelta": 12400,
  "bookingsDelta": 3,
  "ctaUsed": "Book at Rodolfino — link in bio",
  "postedAt": "2026-04-15T11:30:00+02:00"
}
```

Do not add client-specific fields. The cross-client aggregator relies on this shape.

## Hook-Promotion Thresholds

After a post collects final numbers (48h window):

- **50K+ views** → double down. Spawn 3 variations in the same `hookCategory` in the next 7 days. Log the promotion in `skill-updates.json`.
- **10K–50K views** → keep in rotation. Standard frequency.
- **1K–10K views** → one more variation to confirm. If the next also lands in this band, keep but don't promote.
- **<1K twice in a row in the same category** → drop the category for this restaurant. Log the demotion. Wait 4 weeks before retrying that category.

## Telegram Summary Rules

Max 5 sentences. Plain language. Include:

1. Best performer (yesterday's top post).
2. Diagnosis (from the table above).
3. One concrete action for today.
4. (If manual booking tracking) *"How many covers did you do yesterday?"*

Example:
> *"Yesterday's Bolognese post did 14K views and pulled 3 bookings — the story-behind-dish angle is working. Today I'd push another story-angle post, maybe the sourcing for your pecorino. How many covers did you do yesterday?"*

Never mention "Composio", "pipeline", "UTM", "analytics framework", etc. Speak as a marketing partner, not a dashboard.
