# Competitor Research Guide (Restaurant Edition)

## Why This Matters

Before creating content, you MUST understand the landscape. What hooks are other restaurants using? What's getting views in the food niche? What gaps exist? This research directly drives your hook strategy and content differentiation.

## Research Process

### 1. Ask for Browser Permission

Always ask the user before browsing. Something like:

> "I want to research what other restaurants in your area and niche are doing on TikTok — what's getting views, what hooks they use, what's working. Can I use the browser to look around?"

### 2. TikTok Research

Search TikTok for the restaurant's niche. Look for:

- **Competitor restaurant accounts** posting similar content (aim for 3-5)
- **Top-performing food videos** in the niche — what hooks do they use?
- **Content formats** — food close-ups, kitchen prep, ambiance shots, chef POV, before/after plating
- **View counts** — what's average vs exceptional in the food niche?
- **Posting frequency** — how often do successful restaurant accounts post?
- **CTAs** — "link in bio to book", "find us on Google Maps", restaurant name in text
- **Trending sounds** — what music/sounds are popular in food content?
- **Comment sentiment** — what do people ask about? "Where is this?" "How much?" "Do they take reservations?"

### 3. Review Site Research

Check the restaurant's competitors on review platforms:

- Google Maps reviews — what do customers love and hate?
- Yelp / TripAdvisor — what dishes get mentioned most?
- Instagram tags — what do customers photograph and share organically?
- Their website — what do they highlight? Menu, ambiance, chef story?
- Their booking system — how easy is it to actually book a table?

### 4. Gap Analysis

The most valuable output is identifying what competitors AREN'T doing:

- **Content gaps:** Is everyone doing food close-ups but nobody showing kitchen prep? Is anyone doing chef storytelling?
- **Hook gaps:** Are competitors just posting "look at our food" without emotional hooks?
- **Platform gaps:** Are competitors only on Instagram? TikTok opportunity?
- **Audience gaps:** Is everyone targeting foodies but ignoring date-night couples or families?
- **Quality gaps:** Are competitor videos/photos low effort? Can we do much better?
- **Story gaps:** Is anyone telling the story behind the dishes? The chef's background? The ingredients?

### 5. Save Findings

Store in `tiktok-marketing/competitor-research.json`:

```json
{
  "researchDate": "2026-04-08",
  "competitors": [
    {
      "name": "Competitor Restaurant",
      "tiktokHandle": "@competitor",
      "followers": 50000,
      "topHooks": ["hook text 1", "hook text 2"],
      "avgViews": 15000,
      "bestVideo": {
        "views": 500000,
        "hook": "The hook that went viral",
        "format": "food close-up slideshow",
        "url": "https://tiktok.com/..."
      },
      "format": "food slideshows + kitchen clips",
      "postingFrequency": "daily",
      "cta": "link in bio to book",
      "strengths": "Great food photography, consistent posting",
      "weaknesses": "No storytelling, same format every time"
    }
  ],
  "nicheInsights": {
    "trendingSounds": ["sound name 1"],
    "commonFormats": ["food close-up", "chef POV"],
    "averageViews": 15000,
    "topPerformingViews": 500000,
    "gapOpportunities": "Nobody is doing person+conflict hooks in the food niche",
    "avoidPatterns": "Generic 'top 5 dishes' lists get <1K views"
  }
}
```

### 6. Share Findings Conversationally

Don't dump the JSON. Talk about it:

> "So I looked at what other restaurants in your area are doing. [A] is doing well with food close-ups — their best post got [X] views. But I noticed nobody's telling stories about their food — no 'my friend said this place was overrated' hooks, no kitchen behind-the-scenes. That's where I think we can win."

## Ongoing Research

Don't just research once. During weekly reviews:

- Check if competitor restaurants have posted new viral content
- Look for new restaurant accounts blowing up in the niche
- Monitor trending sounds and formats in the food space
- Update `competitor-research.json` with new findings
- Reference competitor data when suggesting hooks
