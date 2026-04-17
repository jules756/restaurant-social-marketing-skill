# Calendar Intelligence

Proactive awareness of booking-driving dates. Checked every Monday during weekly research. Country defaults configured in `config.country`; dates below are Sweden-default.

## Key Dates (Sweden)

| Date | Category | Lead time |
|---|---|---|
| Valentine's Day (Feb 14) | Couples | 4w / 2w / 1w / day-before / day-of |
| Alla hjärtans dag (Feb 14) | Couples (local framing) | same |
| Påsk (Easter) | Family | 3w / 1w / day-of |
| Walpurgis (Apr 30) | Social, spring | 2w / day-before |
| Midsommar (late June) | Huge — summer menu, outdoor seating | 4w / 2w / 1w / day-before |
| Graduation season (May–June) | Family, celebration | 3w / 1w / day-of |
| Mother's Day (late May) | Family | 2w / 1w / day-before |
| Father's Day (Nov) | Family | 2w / 1w / day-before |
| Kräftskiva (August) | Crayfish parties — seasonal | 3w / 2w / 1w |
| Thanksgiving (Nov, if relevant to cuisine) | | 2w |
| Christmas / julbord season (late Nov–Dec) | Major — group bookings | 6w / 4w / 2w / 1w |
| New Year's Eve | High-ticket, limited seats | 6w / 4w / 2w / 1w / day-before |

Country overrides: if `config.country` is NO, add Norwegian constitution day (May 17). If FR, Fête de la Musique (Jun 21), 14 juillet, All Saints, etc. Use `web_search` to localize when a new client lands in an unfamiliar market.

## Lead Times

For each qualifying date:

- **4–6 weeks out:** mention to owner, start planning. *"Midsommar is 5 weeks out. Worth thinking about a summer menu or outdoor-seating push?"*
- **2 weeks out:** begin teaser content. Soft angle — *"what's coming"*.
- **1 week out:** active push. Launch post, booking CTA hard.
- **Day before:** urgency post. *"A few tables left for tomorrow."*
- **Day of:** reminder if capacity isn't full. Otherwise, let it ride.

## Adapt to the Restaurant

Don't force a date on a restaurant that doesn't fit:
- Late-night pizza place gets skipped for Valentine's Day (wrong audience).
- Vegan café skips julbord.
- Casual brunch spot skips NYE.

Read `restaurant-profile.json` → cuisine, typicalGuest, vibe. If a date doesn't match, silently skip it. Don't ask the owner *"do you want to do Valentine's?"* — either the restaurant fits (you push proactively) or it doesn't (you stay silent).

## Rule

**Never autopost a calendar moment without owner confirmation.** Always frame around bookings: *"Pushing this now should drive X table bookings — run the post?"*.
