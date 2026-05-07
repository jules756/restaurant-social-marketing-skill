# Onboarding — 7 Questions

Max 7 questions. One at a time. Conversational. Under 10 minutes. Save each answer to `/host-agent-home/social-marketing/restaurant-profile.json` as you collect it.

## Profile Schema

```json
{
  "name": "",
  "cuisine": "",
  "location": "",
  "bookingUrl": "",
  "bookingMethods": [],
  "signatureDishes": [
    { "name": "", "visualDescription": "" }
  ],
  "vibe": "",
  "typicalGuest": "",
  "language": "",
  "drivePhotosAtOnboarding": null,
  "onboardedAt": "YYYY-MM-DD"
}
```

## Questions

### 1. Language

Ask first in English:
> *"Hi! Let's set up your marketing. Which language should we talk in?"*

Switch immediately to their choice and stay there for the rest of the session. Save `language`.

### 2. Restaurant name + cuisine

> *"What's your restaurant called, and what kind of food do you serve?"*

Follow up naturally — don't interrogate. One line about specialty is enough. Save `name` + `cuisine`.

### 3. Signature dishes (most important)

> *"What are you known for? Pick 2 or 3 dishes."*

For each dish, pull visual detail:
> *"What does the [dish] actually look like on the plate? Colors, textures, anything distinctive?"*

This is what feeds the image pipeline. Skimping here means generic AI-looking posts. Save each as `{ name, visualDescription }`.

### 4. Vibe / atmosphere

> *"What's the vibe? Cozy candlelit, bright and fresh, rustic, sleek?"*

One-sentence description. Infers image style and caption tone. Save `vibe`.

### 5. Typical guest

> *"Who's your typical guest? Date-night couples? Families? Tourists? Foodies? Locals?"*

Informs hook voice. Save `typicalGuest`.

### 6. Booking method + URL

> *"How do people book a table? OpenTable, your website, phone, walk-ins?"*

Capture the URL if there is one — UTM tracking and the booking CTA in every post depend on it. Save `bookingMethods` (array) and `bookingUrl`.

### 7. Google Drive photos (only if Drive is configured)

**Before asking**, silently check the folder. Invoke `terminal`:

```
node /host-agent-home/scripts/drive-sync.js --config /host-agent-home/social-marketing/config.json 2>&1 | tail -10
```

Two paths:

- **Folder has photos** → *"I can see you've already dropped photos in your shared folder. I'll use those as references when I make your posts so they look like your actual food."* Save `drivePhotosAtOnboarding: true`.
- **Folder is empty** → *"When you have a sec, drop your best dish photos in the shared folder in your Drive. I'll use them as **references** to generate posts that look like your real food. Nothing to do now — I can start with AI-generated images and swap to your photos as soon as you add some."* Save `drivePhotosAtOnboarding: false`.

**Critical:** Drive photos are REFERENCES for image generation. They are NOT the images posted to Instagram. Never say *"I'll post your photos"* — that's wrong. Always *"I'll use them as references"*.

## Closing

> *"Perfect. Type **generate post** when you want content, or just tell me what's going on tonight and I'll figure it out."*

## Never Ask

Image style, platform choice, Composio, TikTok warmup, competitor research scheduling, cron, user_id, API keys, MCP. If any of these are broken on the tech side, that's an Installer bug — do not cover it with an onboarding question.
