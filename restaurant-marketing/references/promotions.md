# Natural-Language Promotion Detection

Parse every owner message passively. No formatted command required. Detect on signals, pick mode, act.

## Signals

Any of these in an owner message → likely promotion:

- Discount phrasing: `X% off`, `half price`, `buy one get one`, `50%`
- Time constraints: `tonight`, `this weekend`, `Friday only`, `until Sunday`, `limited time`
- Menu novelty: `new dish`, `seasonal menu`, `testing a new`, `back by popular demand`
- Event framing: `happy hour`, `tasting menu`, `prix fixe`, `collaboration`, `pop-up`, `chef's table`
- Supply moments: `just got a delivery of`, `fresh shipment`, `last of the truffle season`
- Occasion: `Valentine's`, `Midsommar`, `graduation`, `anniversary`, `birthday special`

If detected, pick a mode.

## Mode 1 — Same-day / tonight

**Trigger:** promotion window is today/tonight, or within 24 hours.

Example: *"50% off pizza tonight 9pm–midnight"*

**Act immediately — no approval needed.** Speed > polish. Use `--urgency fast` on generate-slides.js to get standard-quality images faster. Plain overlay. Post as soon as it's ready. Confirm when it's out, don't confirm before.

Response pattern:
> *"On it. Posting now — live in a minute."*

## Mode 2 — Planned

**Trigger:** promotion starts in the future (tomorrow+, next week, next month).

Example: *"We have a tasting menu starting Friday"*

**Confirm details, build a 4-post calendar:**
- **Teaser** (T-5 to T-3 days): curiosity hook, one dish revealed.
- **Launch** (day of start): full reveal + clear CTA with dates.
- **Mid-run** (midpoint): social-proof / reaction hook — *"booked solid tonight"*, *"this one's going fast"*.
- **Last chance** (T-1 or final day): urgency hook.

Response pattern:
> *"Tasting menu starting Friday — love it. How long does it run? Quick confirm on price and the dishes, then I'll set up a 4-post cadence: teaser Monday, launch Friday, one mid-run, one last-chance."*

## Mode 3 — Spontaneous moment

**Trigger:** owner mentions something happening now that isn't a scheduled promo.

Example: *"We just got our truffle delivery"* or *"The lamb came out amazing tonight"*

**Offer to post. Don't force.**

Response pattern:
> *"Want to post about that now? Ready in 5 minutes. Good hook — the owner-moment content tends to do well."*

If yes, run `generate post` with the spontaneous hook angle.

## The 60/40 Rule

During an active planned promotion, mix: **60% regular content, 40% promo content**. A feed that's 100% promo stops working fast. Track via `memory` how many posts this week were promo vs regular.

## Never

- Wait for a formatted command like `/promo`. Parse naturally.
- Treat a same-day as a planned campaign. Speed matters for *"tonight"*.
- Post a planned promo before confirming price / dates / inclusions.
- Miss a spontaneous moment. *"We just got X"* is gold.
