# Analytics & Feedback Loop (Composio + Booking Tracking)

## Performance Tracking

### Composio Analytics API

**Account-level stats** (followers, total likes, video count):
```
POST https://backend.composio.dev/api/v3/tools/execute/TIKTOK_GET_USER_STATS
x-api-key: {apiKey}
Content-Type: application/json

{
  "connected_account_id": "{tiktokConnectedAccount}",
  "user_id": "{userId}",
  "arguments": {}
}
```

Response:
```json
{
  "data": {
    "follower_count": 1250,
    "following_count": 120,
    "likes_count": 6709,
    "video_count": 43,
    "display_name": "Restaurant Name",
    "username": "restauranthandle"
  },
  "successful": true
}
```

**List videos** (metadata, pagination):
```
POST https://backend.composio.dev/api/v3/tools/execute/TIKTOK_LIST_VIDEOS
x-api-key: {apiKey}
Content-Type: application/json

{
  "connected_account_id": "{tiktokConnectedAccount}",
  "user_id": "{userId}",
  "arguments": {
    "max_count": 20,
    "cursor": ""
  }
}
```

Response:
```json
{
  "data": {
    "videos": [
      {
        "id": "7605531854921354518",
        "title": "Post title",
        "create_time": 1712534400,
        "share_url": "https://www.tiktok.com/...",
        "duration": 15
      }
    ],
    "cursor": "next_page_cursor",
    "has_more": true
  },
  "successful": true
}
```

**Per-video analytics** (via proxy to TikTok's API):
```
POST https://backend.composio.dev/api/v3/tools/execute/proxy
x-api-key: {apiKey}
Content-Type: application/json

{
  "connected_account_id": "{tiktokConnectedAccount}",
  "endpoint": "https://open.tiktokapis.com/v2/video/query/",
  "method": "POST",
  "body": {
    "filters": {
      "video_ids": ["7605531854921354518"]
    },
    "fields": ["id", "title", "view_count", "like_count", "comment_count", "share_count", "create_time"]
  }
}
```

Response:
```json
{
  "data": {
    "videos": [
      {
        "id": "7605531854921354518",
        "title": "...",
        "view_count": 45000,
        "like_count": 1200,
        "comment_count": 45,
        "share_count": 89,
        "create_time": 1712534400
      }
    ]
  },
  "successful": true
}
```

Note: Per-video analytics via TikTok's query endpoint may require Business API access. If unavailable, the daily report falls back to delta tracking: monitoring account-level stat changes between report runs to estimate per-period performance.

### Booking Data

Booking data is tracked in `tiktok-marketing/bookings.json`:
```json
{
  "entries": [
    {
      "date": "2026-04-07",
      "bookings": 52,
      "covers": 120,
      "source": "manual"
    }
  ],
  "baseline": {
    "avgDailyBookings": 45,
    "avgDailyCovers": 100,
    "measurementPeriod": "2026-03-01 to 2026-03-31"
  }
}
```

The agent asks the user daily for booking numbers (or pulls from their booking system API if available). The baseline is the average BEFORE TikTok marketing started — this is the "before" number.

## The Feedback Loop

### After Every Post (24-72h)
Record in `hook-performance.json`:
```json
{
  "hooks": [
    {
      "date": "2026-04-08",
      "text": "My friend said this place was overrated",
      "category": "person-conflict",
      "views_delta": 15000,
      "bookings_delta": 8,
      "cta": "Book at [Restaurant] — link in bio",
      "lastChecked": "2026-04-09"
    }
  ]
}
```

### Weekly Review
1. Sort posts by views delta
2. Identify top 3 hooks -> create variations
3. Identify bottom 3 hooks -> drop or radically change
4. Check if any hook CATEGORY consistently wins
5. Cross-reference with booking data — which hooks drive actual reservations?
6. Update prompt templates with learnings

### Decision Rules

| Views | Action |
|-------|--------|
| 50K+ | DOUBLE DOWN — make 3 variations immediately |
| 10K-50K | Good — keep in rotation, test tweaks |
| 1K-10K | Okay — try 1 more variation before dropping |
| <1K (twice) | DROP — radically different approach needed |

### What to Vary When Iterating
- **Same hook, different person:** "friend" -> "mum" -> "boyfriend" -> "colleague"
- **Same structure, different dish:** pasta -> pizza -> dessert -> full spread
- **Same images, different text:** proven images can be reused with new hooks
- **Same hook, different time:** morning vs lunch vs evening posting

## Booking Tracking

### Funnel
```
Views -> Profile Visits -> Link Clicks -> Booking Page -> Reservation Made -> Diner Shows Up
```

### Benchmarks
- 0.5% conversion (views -> booking page visit) = average
- 1-2% = good
- 2%+ = great

### Attribution Tips
- Track booking spikes within 24-72h of high-view posts
- Use UTM links in bio: `?utm_source=tiktok&utm_medium=social`
- Compare weekly booking numbers with weekly view totals
- Ask new diners: "How did you hear about us?" — track TikTok mentions

## Daily Analytics Cron

Set up a cron job to run every morning before the first post (e.g. 10:00 AM user's timezone):

```
Task: node scripts/daily-report.js --config tiktok-marketing/config.json --days 3
Output: tiktok-marketing/reports/YYYY-MM-DD.md
```

The daily report:
1. Fetches account stats from Composio (followers, views delta)
2. Lists recent videos and compares with previous snapshot
3. Pulls booking data from bookings.json
4. Cross-references: maps booking spikes to post timing (24-72h attribution window)
5. Applies the diagnostic framework:
   - High views + More bookings -> SCALE (make variations)
   - High views + Same bookings -> FIX CTA (hook works, booking path is broken)
   - Low views + More bookings -> FIX HOOKS (content converts, needs more eyeballs)
   - Low views + Same bookings -> FULL RESET (try radically different approach)
6. Suggests 3-5 new hooks based on what's working
7. Updates `hook-performance.json` with latest data
8. Messages the user with a summary

### Why 3 Days?
- TikTok posts peak at 24-48 hours (not instant like Twitter)
- Booking attribution takes up to 72 hours (user sees post -> checks restaurant -> books table)
- 3-day window captures the full lifecycle of each post

### Booking Data Makes It Intelligent
When booking data is connected, the daily report can:
- Tell you which hooks drive actual reservations, not just views
- Distinguish between a viral post that fills no seats and a modest post that books 10 tables
- Flag when the booking page needs work (high views + low bookings = landing page issue)
- Identify when the restaurant experience needs attention (high bookings + bad reviews)

Without booking data, you optimize for views. With it, you optimize for revenue.
