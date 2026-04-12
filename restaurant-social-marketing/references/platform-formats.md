# Platform Formats & Best Practices

## Dimensions by Platform

| Platform | Format | Dimensions | Aspect Ratio | Notes |
|----------|--------|-----------|--------------|-------|
| TikTok | Slideshow | 1024x1536 | 2:3 portrait | Exactly 6 slides required. Posts as draft (SELF_ONLY) — add trending sound before publishing |
| Instagram | Feed (single) | 1080x1350 | 4:5 portrait | Best engagement for food content |
| Instagram | Feed (carousel) | 1080x1350 | 4:5 portrait | 1-10 slides. First image is the thumbnail |
| Instagram | Reels | 1080x1920 | 9:16 portrait | Same as Stories. Full-screen vertical |
| Instagram | Stories | 1080x1920 | 9:16 portrait | 24-hour lifespan. Good for time-sensitive promos |
| Facebook | Feed (photo) | 1200x630 | ~1.9:1 landscape | Landscape performs best in Facebook feed |
| Facebook | Stories | 1080x1920 | 9:16 portrait | Same vertical format as Instagram Stories |

## Platform-Specific Posting

### TikTok
- **Format:** 6-slide photo carousel (slideshow)
- **Posting method:** `TIKTOK_POST_PHOTO` via Composio
- **Privacy:** Always `SELF_ONLY` (draft) — user adds trending sound before publishing
- **Music:** CRITICAL. Silent slideshows get buried. Trending sounds = 10x reach
- **Captions:** Long storytelling captions (3x more views). Hook -> Problem -> Discovery -> Result -> CTA
- **Hashtags:** Max 5. Include #fyp, #foodtiktok, and niche tags
- **Best times (restaurants):** 11:00 AM (lunch decisions), 5:00 PM (dinner planning), 8:30 PM (evening FOMO)

### Instagram
- **Format:** Carousel (up to 10 slides) or single image
- **Posting method:** Two-step: `INSTAGRAM_POST_IG_USER_MEDIA` then `INSTAGRAM_POST_IG_USER_MEDIA_PUBLISH`
- **Captions:** Longer captions perform well. Include line breaks for readability
- **Hashtags:** 5-15 relevant hashtags. Mix popular + niche. Can go in caption or first comment
- **Alt text:** Add descriptive alt text for accessibility
- **Best times (restaurants):** 12:00 PM (lunch browse), 6:00 PM (dinner scroll)
- **Carousel tip:** First slide = hook image. Last slide = CTA. Middle slides = story/reveal

### Facebook
- **Format:** Single photo post (landscape) or album
- **Posting method:** `FACEBOOK_CREATE_PHOTO_POST` via Composio
- **Captions:** Can be longer and more detailed than other platforms. Tell the full story
- **Hashtags:** 1-3 max. Facebook algorithm doesn't heavily weight hashtags
- **Tagging:** Tag location for local discovery
- **Best times (restaurants):** 10:00 AM (morning browse), 5:00 PM (dinner planning)
- **Note:** Facebook prioritizes local content — great for neighborhood restaurants

## Content Adaptation Per Platform

### Same Content, Different Presentation

The core content (dishes, hooks, story) stays the same across platforms. What changes:

| Element | TikTok | Instagram | Facebook |
|---------|--------|-----------|----------|
| Image orientation | Portrait (2:3) | Portrait (4:5) | Landscape (~2:1) |
| Slide count | Exactly 6 | 3-10 (flexible) | 1 (single photo) |
| Caption length | Long + storytelling | Medium + hashtags | Long + detailed |
| Hashtag count | 3-5 | 5-15 | 1-3 |
| CTA style | "Link in bio to book" | "Link in bio" or "DM to book" | Direct link in caption |
| Tone | Casual, reactive, emotional | Aesthetic, aspirational | Informative, community |
| Music/sound | Required (trending) | Optional (Reels only) | N/A |

### Image Adaptation

When generating images for multiple platforms from the same content:

1. **Generate at the largest needed size** — TikTok's 1024x1536 or Instagram Reels' 1080x1920
2. **Crop for other platforms:**
   - Portrait → Facebook landscape: crop to center section, or use a different "hero shot" for FB
   - Portrait → Instagram feed: slight crop from 2:3 to 4:5 (minimal change)
3. **Or generate platform-specific images** using the `--platform` flag in generate-slides.js

### Caption Templates Per Platform

**TikTok:**
```
[emotional hook matching slide 1] [2-3 sentences of story].
So we went to [RESTAURANT] and honestly?? [reaction].
Book a table — link in bio
#foodtiktok #[cuisine] #[city]eats #fyp
```

**Instagram:**
```
[hook] ✨

[2-3 sentences of story with line breaks for readability]

[specific dish recommendation]
[CTA: Link in bio to book / DM for reservations]

.
.
.
#[cuisine] #[city]food #[neighborhood]eats #foodie #restaurant
#[dish1] #[dish2] #foodphotography #foodstagram #[city]restaurants
```

**Facebook:**
```
[hook]

[Longer story — 3-5 sentences. More detail than other platforms.
Mention the chef, the ingredients, the atmosphere.]

[Restaurant name] | [address]
[Booking link — can include direct URL on Facebook]
Open [hours]. Reservations recommended.
```

## Posting Frequency

| Platform | Minimum | Recommended | Maximum |
|----------|---------|-------------|---------|
| TikTok | 1x/day | 3x/day | 5x/day |
| Instagram | 3x/week | 1x/day | 2x/day |
| Facebook | 2x/week | 4x/week | 1x/day |

**Consistency > frequency.** Better to post 3x/week reliably than 3x/day for a week then go silent.

## Analytics by Platform

### TikTok (via Composio)
- `TIKTOK_GET_USER_STATS` — followers, total likes, video count
- `TIKTOK_LIST_VIDEOS` — video list with metadata
- Proxy to TikTok API — per-video view_count, like_count, comment_count, share_count

### Instagram (via Composio)
- `INSTAGRAM_GET_USER_INSIGHTS` — account reach, impressions, follower growth
- `INSTAGRAM_GET_IG_MEDIA_INSIGHTS` — per-post reach, impressions, likes, saves, shares

### Facebook (via Composio)
- `FACEBOOK_GET_PAGE_INSIGHTS` — page views, reach, engagement, follower growth
- `FACEBOOK_GET_POST_INSIGHTS` — per-post reach, impressions, clicks, reactions
