# Scenario Library

A scenario is the **lived moment** the carousel is set inside. It's not the dish. The dish is a beat in the moment, not the subject.

Hermes picks one scenario per post based on:
- Day of week + time (Friday night, Sunday lunch, Wednesday post-work)
- The dish (rich pasta → comfort/celebration; light salad → midweek lunch; shared plates → group)
- `memory` of past posts that performed well for this restaurant
- `trend-report.json` if a scenario type is hot
- Owner cues (*"post about tonight's special"* → infer dinner)

A scenario picks the **characters** (who's at the table) and the **mood** (the emotional register). Both feed every slide's prompt. The same characters thread through slides 2–6 (slide 1 is the standalone hook — see hook-archetypes.md).

---

## How to Pick a Scenario

1. **Match day + time first.** A 11am dish post on a Tuesday is not a date night. A 7pm Friday post about pasta is.
2. **Match dish character.** Carbonara/risotto/steak-frites = comfort/social/celebration. Salad/grain bowl = lunch/solo. Shared plates / tasting menu = group/celebration.
3. **Vary across the week.** If the last 3 posts were "friend night out", pick something else even if the dish leans that way.
4. **Cold start fallback** (no memory yet): pick `friend-night-dinner` for dinner posts, `solo-lunch-pause` for lunch posts. Both tested across most cuisines.

---

## The Library

Each scenario specifies: **occasion** (the social context), **characters** (who's there, what they look like — generic enough that AI gen handles it well), **mood** (emotional register), **typical time**, **what makes the moment universal** (so the viewer projects themselves in).

### 1. `friend-night-dinner` — *Two friends catching up*

- **Occasion**: Friday/Saturday evening, two friends in their late 20s/early 30s
- **Characters**: Two women OR mixed friends, casual-stylish, one in something colorful, one in earth tones
- **Mood**: Warm laughter, real conversation, leaning in, candlelight
- **Time**: Dinner, 8–10pm
- **Why it works**: "We should do this more" energy — the universal "I miss my friends" moment

### 2. `date-night` — *Couple, intimate*

- **Occasion**: Weekday or weekend evening, established or new couple
- **Characters**: Couple, dressed up a notch, candlelit
- **Mood**: Intimate, slower pace, eye contact, hands meeting over the table
- **Time**: Dinner, 7:30–10pm
- **Why it works**: Universal "make tonight feel special" instinct — even regulars need the cue

### 3. `birthday-celebration` — *Group, marking a moment*

- **Occasion**: Someone's birthday — 4 to 8 people
- **Characters**: Mixed group, one person in the center wearing something a touch nicer
- **Mood**: Celebratory, candles on dessert at some point, group laughter
- **Time**: Dinner, but can be lunch
- **Why it works**: "Where should we do my birthday?" is one of the most-googled restaurant queries

### 4. `solo-lunch-pause` — *One person, midweek lunch break*

- **Occasion**: Wednesday/Thursday, ~1pm
- **Characters**: One person, business-casual or creative-casual, possibly with a notebook or phone
- **Mood**: A moment of calm, you-deserve-this-pause energy
- **Time**: Lunch, 12:30–2pm
- **Why it works**: The "I worked through lunch this week, I need this" feeling. Hugely overlooked

### 5. `family-sunday` — *Multi-generational*

- **Occasion**: Sunday lunch, parents + kids OR three generations
- **Characters**: Family of 3–5, comfortable clothes, one older relative, kids if natural
- **Mood**: Relaxed, longer meal, dishes shared in the middle
- **Time**: Lunch, 1–3pm
- **Why it works**: "We're not cooking today" — the weekend reset moment

### 6. `post-work-drinks` — *Spillover into food*

- **Occasion**: Thursday/Friday, drinks that became dinner
- **Characters**: 3–5 colleagues or friends-from-work, blazers half-removed, work bags by the chair
- **Mood**: Decompression, "another round?", food keeps arriving
- **Time**: 6:30–9pm
- **Why it works**: The unplanned-but-perfect night — corporate audience relates instantly

### 7. `weekend-brunch` — *Slow start*

- **Occasion**: Saturday/Sunday late morning
- **Characters**: 2–4 friends, post-workout or just-rolled-out, coffee + carafe energy
- **Mood**: Soft daylight, no rush, scrolling phones briefly between bites
- **Time**: 10:30am–1pm
- **Why it works**: Brunch is a ritual, not a meal — sells differently than dinner

### 8. `anniversary` — *Couple, marking the date*

- **Occasion**: Annual milestone, the "good restaurant" choice
- **Characters**: Couple, dressed up properly this time, possibly with a small wrapped gift on the table
- **Mood**: Tender, slower than date night, longer eye contact, wine clink
- **Time**: Dinner, 8pm onward
- **Why it works**: Different from date-night — this is the *"this is the place"* selection, not a casual outing

### 9. `solo-treat` — *One person, treating themselves*

- **Occasion**: Anytime — not waiting for someone, not working
- **Characters**: One person, dressed for themselves, a glass of wine, a book or just looking out
- **Mood**: Quiet confidence, self-permission, a beat of joy
- **Time**: Any meal, often early dinner (6–7pm) or late lunch
- **Why it works**: Solo dining is normalizing — a quiet but growing audience. Less competition for the message

### 10. `group-celebration` — *Big table, big occasion*

- **Occasion**: Engagement, promotion, reunion, going-away — 6–12 people
- **Characters**: Mixed group, one or two clearly the "honoree", the rest in supporting energy
- **Mood**: Loud, multiple conversations, plates passed across the table, photos taken
- **Time**: Dinner, longer than usual (2–3 hours)
- **Why it works**: The "we need a place for 8 people on Saturday" search — high-intent

### 11. `cozy-rainy-day` — *Comfort food, weather-driven*

- **Occasion**: Rainy/snowy/cold day, walked-in moment
- **Characters**: 1–3 people, coats still nearby, slightly damp hair, hands around hot drinks
- **Mood**: Sanctuary, contrast with outside, warm interior
- **Time**: Lunch or early dinner
- **Why it works**: Weather is the most relatable trigger. *"It's pouring — let's just go get pasta"*

### 12. `after-show-dinner` — *Late, post-event*

- **Occasion**: Post-theater, post-concert, post-game — 9:30pm onward
- **Characters**: 2–4 people, slightly dressed up (tickets-earlier energy), animated by what they just saw
- **Mood**: Buzzing, recapping the show, quick second-wind food
- **Time**: 9:30pm–11:30pm
- **Why it works**: Late-dining audience is underserved on social — most restaurants only show prime-time

---

## Scenario → Scene Arc Mapping

Once a scenario is picked, build the 6-beat sceneArc using the blueprint in `content-preparation/SKILL.md`. The scenario stays constant across all 6 beats; only the moment changes.

Example for `friend-night-dinner` + carbonara:

| Beat | Moment within the scenario |
|---|---|
| 1 — hook | (independent — picks any hook archetype, see hook-archetypes.md) |
| 2 — scene-set | The two friends just sat down, dining room behind them, one pouring wine |
| 3 — dish-arrives | Server placing the carbonara, both faces lighting up |
| 4 — the-bite | One twirls pasta on her fork, mid-laugh, the other watching |
| 5 — connection | Both leaning over the table mid-conversation, dish off-frame, candlelight |
| 6 — outro | Outside the restaurant after, hugging goodbye, warm windows behind |

---

## Variety Rule

For a given restaurant, never use the same scenario twice in 7 days. `memory` records the scenario used per post; the orchestrator pulls the last 7 scenarios and excludes them when picking.

This is what keeps a feed from feeling like *"same two friends every Friday"* — the audience subconsciously notices repetition.
