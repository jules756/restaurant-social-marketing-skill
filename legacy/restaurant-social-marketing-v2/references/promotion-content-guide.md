# Promotion Content Guide

## Overview

When a restaurant runs a promotion (discount, happy hour, seasonal menu, special event), the content strategy shifts to drive awareness and urgency. This guide covers how to create effective promotional content without feeling "salesy."

## Promotion Detection

The AI agent watches for promotional language in conversation:
- Discount percentages ("20% off", "half price", "buy one get one")
- Date ranges ("from April 10 to 17", "this weekend only", "all month")
- Keywords: "special offer", "happy hour", "limited time", "promotion", "deal", "seasonal", "new menu", "event", "collaboration", "prix fixe"

When detected, the agent should:
1. **Confirm:** "Sounds like you have a promotion — 20% off pasta dishes from April 10-17. Want me to create promotional content for this?"
2. **Extract:** What items, what discount, start date, end date, terms/conditions
3. **Store:** Save to promotions.json via `scripts/promotion-manager.js --add`
4. **Plan:** Generate a content calendar for the promotion period

## Content Calendar Template

For a 7-day promotion:

| Day | Type | Content Focus |
|-----|------|---------------|
| Day -2 | TEASER | Build anticipation. "Something special is coming to [Restaurant]..." No details yet |
| Day -1 | TEASER | Hint at what's coming. "Your favorite pasta is about to get even better..." |
| Day 0 | LAUNCH | Announce the promotion. Full details, hero dish image, clear CTA |
| Day 0 | LAUNCH | Second angle. Different hook, different dish, same promotion |
| Day 2 | SOCIAL PROOF | "Everyone's been ordering the carbonara this week" — show demand |
| Day 3 | DEEP DIVE | Feature a specific promoted dish with its recipe story |
| Day 5 | REMINDER | "Only 2 days left" — urgency |
| Day 7 | LAST CHANCE | "Tonight is the last night for 20% off pasta" — maximum urgency |
| Day 8 | WRAP-UP | "Pasta week was incredible — here's what happened" — thank the audience |

### Shorter Promotions (Weekend Special)

| Day | Type | Content Focus |
|-----|------|---------------|
| Day -1 | TEASER | "This weekend only at [Restaurant]..." |
| Day 0 | LAUNCH | Full announcement with urgency ("This weekend ONLY") |
| Day 1 | REMINDER | "Last chance — tomorrow is the last day" |
| Day 2 | WRAP-UP | Quick thank you, hint at future specials |

### Single-Day Events

| Timing | Type | Content Focus |
|--------|------|---------------|
| Day -3 | TEASER | Build anticipation |
| Day -1 | REMINDER | "Tomorrow night — don't miss it" |
| Day 0 (morning) | LAUNCH | Full details, booking CTA |
| Day 0 (evening) | LIVE | If possible, share during the event |
| Day +1 | WRAP-UP | Highlights from the event |

## Hook Formulas for Promotions

### Teaser Hooks
- "Something special is coming to [Restaurant] and I'm not allowed to tell you yet"
- "If you love [cuisine/dish], save this date: [date]"
- "We've been working on something and it's almost ready"
- "Your favorite [dish] is about to get even better..."

### Launch Hooks
- "[Dish] is [discount]% off this week and it's already our most popular dish"
- "We just launched [promotion] and honestly? It's the best deal in [city]"
- "[Restaurant] is doing something they've NEVER done before"
- "Run don't walk — [dish] is [discount]% off starting TODAY"

### Social Proof Hooks (Mid-Promotion)
- "We've already sold [X] portions of [dish] since [promotion] started"
- "Everyone who came this week ordered the [dish] and I understand why"
- "My friend went last night and said it was the best meal she's had in months"

### Urgency Hooks (Last Chance)
- "[Promotion] ends [tomorrow/tonight] — this is your last chance"
- "If you've been meaning to try [Restaurant], tonight is the night"
- "2 days left. After that, it goes back to full price"
- "I'm telling you right now — you'll regret missing this"

### Wrap-Up Hooks
- "[Promotion] is over but the people who came this week..." 
- "We served [X] portions of [dish] in [Y] days — thank you"
- "Everyone's asking if we'll do this again. Stay tuned"

## Text Overlay Guidelines for Promotions

### Promotional Slides
Slide 6 (CTA slide) should include the promotion details:
- Discount amount: "20% OFF"
- Time frame: "This week only"
- Restaurant name
- CTA: "Book now — link in bio"

### Urgency Text
For last-chance posts, the text overlays should convey urgency:
- "LAST NIGHT" or "ENDS TONIGHT" in larger text
- "Don't miss this" reaction text on earlier slides
- Countdown: "2 days left" / "Tomorrow is the last day"

### Don't Overdo It
Promotional text should still feel authentic:
- Keep the reaction-style text on slides 1-5 ("Wait... this is 20% off??")
- Only slide 6 should have explicit promotional text
- The hook should tell a story, not just announce a discount

## The 60/40 Rule

During an active promotion:
- **60% of posts should be regular content** (non-promotional hooks, general restaurant content)
- **40% of posts should be promotional** (featuring the promotion explicitly)

Why? If every post is "20% OFF!", the audience tunes out. Mix promotional posts with your regular storytelling content. The regular posts build trust and engagement; the promotional posts convert.

## Promotion Performance Tracking

### During the Promotion
The daily report tracks:
- Views on promotional vs non-promotional posts
- Booking numbers compared to baseline
- Which promotional hooks perform best
- Which promoted dishes get the most engagement

### After the Promotion
Generate a post-promotion report via `scripts/promotion-manager.js --report <id>`:
- Total views across all promotion posts
- Booking increase vs baseline during promotion period
- Best-performing promotional hook
- Best-performing promoted dish
- Comparison: promotional posts vs regular posts during the same period
- ROI estimate: (additional bookings x average spend) vs normal baseline

### Learning for Next Time
After each promotion, the hook performance data shows:
- Which type of promotional hook worked best (teaser? launch? urgency?)
- Which dishes resonated most in promotional content
- Whether the 60/40 balance was right or needs adjusting
- Optimal posting times during promotions (might differ from regular content)

## Integration with Knowledge Base

When creating promotional content, pull from the knowledge base:
- **menu.json:** Dish descriptions, ingredients, prices for the promoted items
- **recipes.json:** Recipe stories make promotions feel authentic, not salesy
- **chef.json:** "Chef Marco's carbonara is 20% off this week" > "Carbonara is 20% off"

Example:
```
"They cure their own guanciale for 3 WEEKS for this carbonara — 
and this week it's 20% off. This recipe hasn't changed since 1952."
```

This is infinitely more compelling than: "Carbonara is 20% off this week at [Restaurant]."

## Integration with Google Drive

During promotions, prioritize real photos of the promoted dishes:
- Check photo-index.json for photos tagged with the promoted dish names
- Real photos feel more authentic when there's a specific offer attached
- If no real photo exists, use AI-generated but note it for the restaurant owner: "We don't have a real photo of your carbonara — want to take one before the promotion starts?"
