# Natural Language Promotions Detection & Handling

## Detection Signals

The agent must parse **every message** from the owner for promotion signals. No special command format is required.

### Strong Signals (high confidence)
- Discount: "50% off", "20% discount", "buy one get one", "half price"
- Time-limited: "tonight", "this weekend", "until Friday", "limited time"
- New item: "new dish", "just added", "new on the menu", "just got"
- Event: "tasting menu", "special event", "live music", "happy hour"
- Delivery: "just got a delivery of", "fresh truffles", "new shipment"
- Seasonal: "summer menu", "Christmas menu", "Midsommar special"

### Medium Signals
- "special tonight"
- "prix fixe"
- "collaboration with"
- "launching on Friday"
- "coming soon"

## Response Modes

### 1. Same-Day / Urgent Promotion
**Trigger**: Strong time pressure ("tonight", "now", "this evening")
**Action**: Generate and post immediately, no approval needed.
**Tone**: Fast, energetic, "on it".

**Example**:
Owner: "50% off pizza tonight 9pm–midnight"
Agent: Generates post → posts to Instagram → notifies owner with permalink.

### 2. Planned Promotion
**Trigger**: Future date or multi-day campaign ("starting Friday", "tasting menu next week")
**Action**:
- Confirm details with owner
- Build a full campaign: teaser → launch → mid-run → last chance
- Create content calendar for the promotion

### 3. Spontaneous Moment
**Trigger**: Unexpected positive event ("just got truffle delivery", "chef made something amazing")
**Action**: Offer to post immediately.
**Example Response**: "Want me to post about the fresh truffle delivery right now? I can have it ready in 2 minutes."

## 60/40 Rule

During any active promotion period:
- 60% of posts = regular menu content
- 40% of posts = promotional content

Track this using `memory` of recent posts.

## Implementation Notes

- Parse passively on every message
- Never require formatted commands
- Always prioritize speed for same-day promotions
- Use `memory` to avoid asking the same details twice
- Log all promotions to `knowledge-base/promotions.json` for future reference

## Examples

**Same-day:**
Owner: "Let's do 2 for 1 cocktails tonight"
Agent: Immediately generates and posts promotional carousel.

**Planned:**
Owner: "We're launching a summer tasting menu next Friday"
Agent: "Great! Should I start building a teaser campaign this week?"

**Spontaneous:**
Owner: "The chef just made the most incredible lobster dish"
Agent: "That sounds amazing. Want me to post about it right now?"

---

This file is referenced from `restaurant-marketing/SKILL.md`. Update this file when new promotion patterns are discovered.