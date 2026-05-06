# Competitor Research (Module D)

On-demand, 15–30 minutes, uses Hermes's `web_search` + `browser_navigate` + `browser_vision` + `web_extract` tools.

## Scope — 5 Research Paths

Run these in parallel when Hermes supports it.

### 1. TikTok — niche + city

`web_search`: `<cuisine> TikTok <city>` and `best <cuisine> <city> 2026`

Identify 3–5 competitor accounts. For each:

- `browser_navigate` to their TikTok profile.
- `browser_vision` to capture: handle, follower count, last 10 videos' view counts, hook styles used on top performers.

### 2. Instagram — same niche + city

Same pattern. Pay extra attention to:

- Reel vs carousel split.
- First 3 words of their top captions (keyword strategy).
- CTA placement and phrasing.

### 3. Google Maps reviews (top 3 competitors)

`web_search`: `<competitor name> reviews Google Maps`.
`browser_navigate` + `web_extract` the review page.

Extract reviewer phrases — real words real customers use about this cuisine in this city. This is gold for caption writing.

### 4. TripAdvisor (same 3 competitors)

Same pattern. Different reviewer demographic (more tourist-leaning in many markets).

### 5. Local press

`web_search`: `best <cuisine> <city> <year>`, `<city> restaurant list <year>`.

Skim top 5 hits. Note which competitors appear in press lists — these are the entrenched players to position against.

## Per-Competitor Capture

Write one JSON object per competitor to `competitor-research.json`:

```json
{
  "handle": "@competitor_name",
  "platform": "instagram",
  "followers": 12400,
  "postingFrequency": "~1 post every 2 days",
  "topHookFormats": ["reaction", "price-reveal"],
  "avgViews": 3200,
  "bestVideoViews": 48000,
  "bestVideoHook": "Wait until you see what they do with the truffle",
  "ctaStyle": "'DM to book' (friction — weak)",
  "captionPattern": "Short, emoji-heavy, no keyword-first SEO",
  "notDoing": [
    "No story-behind-dish content",
    "No sourcing / provenance angles",
    "No chef POV shots"
  ],
  "capturedAt": "2026-04-17"
}
```

The `notDoing` field is the most valuable — it's the list of gaps we can exploit.

## Gap Analysis (The Valuable Output)

Synthesize across all 5 research paths. Find:

1. **Format gaps** — what nobody in the market is doing.
2. **Language gaps** — words real customers use (from reviews) that nobody's putting in captions.
3. **Angle gaps** — story types, sourcing details, chef narratives nobody's telling.
4. **CTA weaknesses** — if every competitor uses weak CTAs ("DM to book"), ours being stronger is a clear win.

Return to orchestrator as one sentence of strategic insight:

> *"Nobody in Stockholm is doing the ingredient-sourcing story format. [Competitor A] has the biggest following but weak CTAs. Our angle: sourcing-provenance content with direct booking URLs — clear whitespace."*

## Output Files

- Structured: `$HOST_AGENT_HOME/social-marketing/competitor-research.json` — array of per-competitor objects + a top-level `gapOpportunities` array.
- Narrative: `$HOST_AGENT_HOME/social-marketing/reports/competitor/<YYYY-MM-DD>.md` — human-readable write-up for the Installer to review.

## Refresh Cadence

- Monthly by default.
- On demand when the owner says *"research competitors"* or when a category drops from rotation (Module C may trigger it).

## What NOT to Do

- Don't copy competitor content. Use their gaps to inform ours, not their successes to duplicate.
- Don't fabricate numbers if `browser_vision` failed to read a count — mark `"followers": null`, continue.
- Don't scrape rate-limited. Use `browser_navigate` politely with delays if many competitors.
