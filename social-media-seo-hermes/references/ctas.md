# CTA Library — Slide 6 and Caption Close

Every post ends with a booking CTA. Slide 6 is the visual CTA; the last line of the caption is the text CTA. Both should drive to the same action.

## Slide 6 CTA (visual — 4–6 words max)

| Style | Example |
|---|---|
| Default / safe | `Book at [Restaurant] — link in bio` |
| Urgency-soft | `Book for this week — link in bio` |
| Social-proof | `Join the regulars — link in bio` |
| Direct | `Reserve your table — link in bio` |
| Question | `When are you coming in? Book — link in bio` |
| Promo-specific | `[Promo name] ends [date] — book in bio` |
| Local | `Best table in [city]. Book — link in bio` |

Replace `[Restaurant]`, `[city]`, `[promo name]`, `[date]` with real values from `restaurant-profile.json` / promotion context.

## Caption CTA (text — one line at the end)

Append to the caption after hashtags. Examples:

- `Book at [Restaurant] → [bookingUrl]?utm_source={platform}&utm_medium=social&utm_campaign={campaign}`
- `Tables open this week. Reserve → [bookingUrl]`
- `Taking bookings for [day]. [bookingUrl]`

## UTM Convention

Every booking URL in a caption carries UTM parameters:

```
?utm_source=instagram      (or tiktok / facebook)
&utm_medium=social
&utm_campaign=carousel     (or promo / story / spontaneous)
&utm_content=YYYY-MM-DD
```

This is what makes `marketing-intelligence` Module A able to attribute bookings to specific posts. A caption without UTM is a bug.

## Never

- Put the phone number in a CTA unless `bookingMethods` is phone-only. URL > phone for tracking.
- Use `"DM us to book"` — friction kills conversion. Always a link.
- Omit the CTA "because the slide already has one". The caption needs one too (different readers see different things).
