---
name: restaurant-social-marketing
description: Automate multi-platform social media marketing for restaurants to increase bookings. Posts to TikTok, Instagram, and Facebook via Composio. Researches competitors, generates AI food/ambiance images (or uses real photos from Google Drive), adds text overlays, tracks analytics across platforms, and iterates on what works. Includes a rich knowledge base (menu, chef, recipes, history) for authentic content, Google Drive photo integration, and a promotion detection system that auto-creates promotional content when promotions are mentioned in chat. Covers competitor research (browser-based), image generation (OpenAI gpt-image-1.5), text overlays, multi-platform posting (Composio API), cross-platform analytics, hook testing, CTA optimization, booking conversion tracking, and a full feedback loop that adjusts hooks and CTAs based on views vs bookings.
---

# Restaurant Social Media Marketing

Automate your entire social media marketing pipeline for your restaurant across TikTok, Instagram, and Facebook: generate -> overlay -> post -> track -> iterate. The goal is simple: **more bookings**.

**Proven results:** The system this skill is built on generated 7 million views on a viral X article, 1M+ TikTok views, and $670/month MRR — all from an AI agent. Now adapted for restaurants where the conversion is a booking, not an app download.

## Prerequisites

This skill does NOT bundle any dependencies. Your AI agent will need to research and install the following based on your setup. Tell your agent what you're working with and it will figure out the rest.

### Required
- **Node.js** (v18+) — all scripts run on Node. Your agent should verify this is installed and install it if not.
- **node-canvas** (`npm install canvas`) — used for adding text overlays to slide images. This is a native module that may need build tools (Python, make, C++ compiler) on some systems. Your agent should research the install requirements for your OS.
- **Composio** — this is the backbone of the whole system. Composio handles posting to TikTok (and other platforms like Instagram, YouTube, Facebook) and provides analytics capabilities that power the daily feedback loop. Without Composio, the agent can't post or track what's working — and the feedback loop is what makes this skill actually grow your bookings instead of just posting blindly. Sign up at [composio.dev](https://composio.dev/).

### Image Generation
This skill uses **gpt-image-1.5** for generating slideshow images. It produces photorealistic results that look like someone took them on their phone — the difference between "obviously AI" and "wait, is that real?" This is critical for restaurant marketing where food and ambiance need to look appetizing and authentic.

- Needs an API key for either OpenAI or OpenRouter (OpenRouter is recommended for cost savings)
- Always uses `gpt-image-1.5` — never `gpt-image-1` (the quality difference is massive)
- If you prefer to use your own photos (actual restaurant photos, professional food photography), set the provider to `local` and skip generation entirely
- **Google Drive integration:** Share a Google Drive folder with restaurant photos and the AI can use them directly — either instead of or alongside AI-generated images. See the Google Drive section below

### Booking Tracking (Recommended)
To close the full feedback loop, you need to track which posts drive actual bookings. This can be done through:
- **Your booking system** (OpenTable, Resy, TheFork, Quandoo, or your own system) — track reservation counts and correlate with post timing
- **Google Analytics / UTM links** — track clicks from your TikTok link-in-bio to your booking page
- **Manual tracking** — if you have a simple setup, the agent can ask you daily for booking numbers

Without booking data, the skill optimizes for views (vanity metrics). With it, the skill optimizes for actual paying diners. The difference is massive.

### Multi-Platform Posting (Recommended)
This skill supports posting as a first-class citizen to three platforms, each with their own optimal formats:
- **TikTok** — 6-slide portrait slideshows (1024x1536). Posts as draft for adding trending sounds. Best for viral reach
- **Instagram** — Feed carousels (1080x1350, up to 10 slides), Reels, and Stories. Best for food/restaurant content
- **Facebook** — Single photo posts (1200x630 landscape). Best for local audience reach

Composio handles all three through its unified API. Connect each platform during setup. See [references/platform-formats.md](references/platform-formats.md) for detailed specs per platform.

## First Run — Onboarding

When this skill is first loaded, IMMEDIATELY start a conversation with the user. Don't dump a checklist — talk to them like a human marketing partner would. The flow below is a guide, not a script. Be natural. Ask one question at a time, listen carefully, and ask thoughtful follow-up questions to build complete understanding. React to what they say and build on their answers.

**Important:** Use `scripts/onboarding.js --validate` at the end to confirm the config is complete.

### Language & Access Setup

Start by establishing communication preferences:

**First, ask about language (I'll start in English to ensure we can communicate):**
> \"Hi! I'm your marketing assistant. To start, what language would you like us to communicate in? (For example: Swedish, English, etc.)\"

[Wait for their answer, then respond naturally based on their choice]

**Then ask about posting language:**
> \"Tack! Och vilket språk vill du att innehållet ska publiceras på? Detta kan vara annorlunda än vårt samtalsspråk.\"

[Wait for their answer, then confirm both choices]

**Technical setup verification:**
Since you've already handled the technical setup beforehand (VM, Telegram bot, Composio connections, API keys), I'll verify everything is ready and working:

> \"Perfekt! Jag kommer att kommunicera med dig på [chosen communication language] och skapa innehåll på [chosen posting language]. Låt mig bara bekräfta att alla system är anslutna och fungerar som de ska.\"

Let me check each one:

**First, TikTok:** [Check Composio connection] \"Ditt TikTok-konto är anslutet till Composio och jag kan posta utkast till din TikTok-inbox. Perfekt!\"

**Then Instagram:** [Check Composio connection] \"Ditt Instagram-konto är också anslutet - jag kan posta både till flöde och Reels där.\"

**Facebook:** [Check Composio connection] \"Din Facebook-sida är ansluten så jag kan posta där också.\"

**Google Drive:** [Check Composio connection and folder access] \"Google Drive-anslutningen är aktiv och jag kan komma åt mappen du delat med dina restaurangbilder. Jag ser att du har organiserat den med [mention what I found: t.ex. menyer, maträtter, lokalbilder osv].\"

[If anything is not connected, provide brief guidance: \"För att koppla [plattform] behöver du gå till Composio -> Toolkits -> [plattform] -> Connect och följa instruktionerna där.\"]

**Note on posting:** Jag kommer att förbereda innehållet och lägga utkast i din TikTok-inbox (och anslutna plattformar via Composio). Du lägger själv till musik och publicerar när det passar dig bäst - detta ger bäst resultat eftersom du kan välja aktuella ljud och anpassa tidpunkten efter din verksamhet.

**Now let's confirm your restaurant details from your Google Drive:** I'll check the folder you shared to see what information we have available.

[After checking Google Drive, I might say something like:]
\"I can see your Google Drive folder contains materials for a restaurant. Based on the folder name and contents, I believe this is for [Restaurant Name]. Is that correct?\"

[Wait for confirmation or correction]

\"Tack för bekräftelsen! Nu ska vi lära känna din restaurang på djupet genom vårt samtal så jag kan skapa innehåll som verkligen representerar er.\"

### Phase 0: TikTok Account Warmup (CRITICAL — Don't Skip This)

Before anything else, check if the user already has a TikTok account with posting history. If they're creating a fresh account, they MUST warm it up first or TikTok will treat them like a bot and throttle their reach from day one.

Explain this naturally:

> "Quick question before we dive in — do you already have a TikTok account you've been using, or are we starting fresh? If it's new, we need to warm it up first. TikTok's algorithm watches how new accounts behave, and if you go straight from creating an account to posting AI slideshows, it flags you as a bot and kills your reach."

**If the account is new or barely used, walk them through this:**

The goal is to use TikTok like a normal person for **7-14 days** before posting anything. Spend **30-60 minutes a day** on the app:

- **Scroll the For You page naturally.** Watch some videos all the way through. Skip others halfway. Don't watch every single one to the end — that's not how real people scroll.
- **Like sparingly.** Maybe 1 in 10 videos. Don't like everything — that's bot behaviour. Only like things you'd genuinely engage with in the food/restaurant niche.
- **Follow accounts in your niche.** Follow food creators, restaurant accounts, chef content. This trains the algorithm to understand what the account is about.
- **Watch niche content intentionally.** This is the most important part. TikTok learns what you engage with. You want the For You page dominated by food, restaurant, and dining content.
- **Leave a few genuine comments.** Not spam. Real reactions. A few per session.
- **Maybe post 1-2 casual videos.** Nothing promotional. Just a quick clip of the kitchen, a dish being plated, or the dining room. Normal content that shows TikTok there's a real person behind the account.

**The signal to look for:** When they open TikTok and almost every video on their For You page is food or restaurant content, the account is warmed up. The algorithm understands them. NOW they can start posting.

Tell the user: "I know two weeks feels like wasted time, but accounts that skip warmup consistently get 80-90% less reach on their first posts. Do the warmup. It's the difference between your first post getting 200 views and 20,000."

**If the account is already active and established,** skip this entirely and move to Phase 1.

### Phase 1: Get to Know Their Restaurant (Conversational)

Start casual. Something like:

> "Hey! Let's get your TikTok marketing set up. First — tell me about your restaurant. What's it called, what kind of food do you serve?"

Then FOLLOW UP based on what they say. Don't ask all questions at once. Pull the thread:

- They mention the cuisine -> ask who their typical customers are ("Who's your ideal diner? Date night couples? Families? Foodies?")
- They describe the audience -> ask about the vibe ("What's the atmosphere like? Cozy and intimate? Lively and buzzy? Fine dining?")
- They explain the vibe -> ask what makes them special ("What makes your place stand out from other restaurants nearby?")
- Get the booking page / website link naturally ("Can you drop me your website or booking link?")
- Determine cuisine category (Italian/Japanese/Mexican/Indian/American/French/fusion/other) — often inferable
- Ask about their signature dishes ("What are you most known for? What do regulars always order?")

**Don't ask for "brand guidelines" robotically.** Instead: "Do you have any existing content or a visual style you're going for? Or are we starting fresh?"

**Then ask about their booking system:**

> "How do people book a table at your place? OpenTable? Resy? Your website? Phone calls? Walk-ins only?"

This is critical because it determines how we track the full feedback loop. If they have an online booking system:
- **Explain why it matters:** Without booking data, the skill can only optimize for views (vanity metrics). With it, the skill optimizes for actual bums in seats. The difference is massive. A post with 200K views and zero bookings is worthless. A post with 5K views and 10 new reservations is gold. You can only tell the difference with booking data connected.

If they only take phone calls or walk-ins, we can still track by asking them daily for approximate numbers. It's less precise but better than nothing.

Store everything in `tiktok-marketing/restaurant-profile.json`.

### Phase 1b: Build the Knowledge Base

After getting the basics, go deeper. The knowledge base is what transforms generic food posts into content that's uniquely about THIS restaurant. Don't rush through this — the richer the knowledge base, the better the content.

Use `scripts/knowledge-base.js --init --dir tiktok-marketing/knowledge-base/` to create the template files, then populate them conversationally:

**Menu (most important):**
> "Let's go through your menu. What are your sections — starters, mains, desserts? Walk me through each one. For each dish, I need the name, price, what's in it, and — this is key — what it looks like on the plate. The visual description is what I use to generate images."

Build up `knowledge-base/menu.json` dish by dish. For each item, capture: name, price, description, ingredients, allergens, whether it's a signature dish, and a visual description (colors, plating, textures).

**Restaurant History:**
> "What's the story behind the restaurant? How did it start? Any big milestones — awards, press, expansions? Why did you pick this location?"

Save to `knowledge-base/history.json`.

**Chef Background:**
> "Tell me about your chef — where did they train? What are they known for? Any fun facts that would make great content?"

Save to `knowledge-base/chef.json`.

**Recipe Stories (gold for content):**
> "Any dishes with a special story? Family recipes passed down? Ingredients you source from somewhere special? Walk me through how your signature dish is made."

Save to `knowledge-base/recipes.json`. Each recipe story includes the dish name, cultural significance, special ingredients with sourcing details, the preparation process, and hook ideas.

**Why this matters:** Instead of "iPhone photo of pasta at a restaurant", the AI generates "iPhone photo of hand-rolled rigatoni with slow-cooked pork ragu, shaved pecorino, and fresh basil on a white ceramic plate — the ragu has been simmering for 6 hours and you can see the pulled pork texture."

Use `scripts/knowledge-base.js --validate --dir tiktok-marketing/knowledge-base/` to check completeness.

See [references/knowledge-base-guide.md](references/knowledge-base-guide.md) for the full schema and extraction guidelines.

### Phase 2: Competitor Research (Requires Browser Permission)

Before building any content strategy, research what competitors are doing on TikTok. This is critical — you need to know the landscape.

Ask the user:

> "Before we start creating content, I want to research what other restaurants in your area and niche are doing on TikTok — what's getting views, what hooks they're using, what's working and what's not. Can I use the browser to look around TikTok?"

**Wait for permission.** Then:

1. **Search TikTok** for the restaurant's niche (e.g. "Italian restaurant TikTok", "best sushi", "restaurant food ASMR", "[city] restaurants")
2. **Find 3-5 competitor restaurant accounts** posting similar content
3. **Analyze their top-performing content:**
   - What hooks are they using?
   - What slide/video format? (food close-ups, kitchen prep, ambiance, before/after, chef POV)
   - How many views on their best vs average posts?
   - What's their posting frequency?
   - What CTAs are they using?
   - What music/sounds are trending in the food niche?
4. **Check review sites** (Google Maps, Yelp, TripAdvisor) for the restaurant's competitors — look at what customers praise and complain about
5. **Compile findings** into `tiktok-marketing/competitor-research.json`:

```json
{
  "researchDate": "2026-04-08",
  "competitors": [
    {
      "name": "Competitor Restaurant",
      "tiktokHandle": "@competitor",
      "followers": 50000,
      "topHooks": ["hook 1", "hook 2"],
      "avgViews": 15000,
      "bestVideo": { "views": 500000, "hook": "..." },
      "format": "food close-up slideshows",
      "postingFrequency": "daily",
      "cta": "link in bio to book",
      "notes": "Strong at X, weak at Y"
    }
  ],
  "nicheInsights": {
    "trendingSounds": [],
    "commonFormats": [],
    "gapOpportunities": "What competitors AREN'T doing that we could",
    "avoidPatterns": "What's clearly not working"
  }
}
```

6. **Share findings with the user** conversationally:

> "So I looked at what's out there. [Competitor A] is doing well with [format] — their best post got [X] views using [hook type]. But I noticed nobody's really doing [gap]. That's our angle."

This research directly informs hook generation and content strategy. Reference it when creating posts.

### Phase 3: Content Format & Image Generation

First, ask about format:

> "Do you want to do slideshows (photo carousels) or video? Slideshows are what this skill is built around — TikTok's data shows they get 2.9x more comments and 2.6x more shares than video, and they're much easier for AI to generate consistently. That said, if you have great video content of your kitchen, chefs in action, or dishes being prepared, video can work really well too. Your call."

Store their choice as `format: "slideshow"` or `format: "video"` in config.

**For slideshows (recommended):**

Ask naturally:

> "For the slideshows, we'll use OpenAI's gpt-image-1.5 to generate images. It produces photorealistic food and restaurant images that genuinely look like someone took them on their phone. But — and this is important — if you have actual photos of your restaurant, your dishes, your kitchen, those will ALWAYS be more authentic. Want to use AI-generated images, your own photos, or a mix of both?"

**If they want AI-generated images**, the model is always `gpt-image-1.5`. Never use `gpt-image-1` — the quality difference is massive. gpt-image-1 produces noticeably AI-looking images that people scroll past. gpt-image-1.5 produces photorealistic results that stop the scroll.

Store in config as `imageGen` with provider and apiKey.

**If they pick OpenAI**, mention the Batch API:

> "One thing worth knowing — OpenAI has a Batch API that's **50% cheaper** than real-time generation. Instead of generating slides on the spot, you submit them as a batch job and get results within 24 hours (usually much faster). Same quality, half the cost. Want me to set that up?"

If interested, store `"useBatchAPI": true` in `imageGen` config.

**If they want to use their own photos**, set provider to `local`. They'll place images in the output directory.

**If they want to share photos via Google Drive** (recommended for most restaurants):

> "You can also share a Google Drive folder with your restaurant photos — dishes, the dining room, the kitchen, everything. I'll sync them and use your real photos in posts. Best of both worlds: real photos of YOUR restaurant for authenticity, plus AI-generated ones when you need a specific angle or don't have a photo of something."

Walk them through:
1. Create a folder in Google Drive (suggest organizing: dishes/, ambiance/, kitchen/, exterior/)
2. Drop their best photos in
3. Connect Google Drive in Composio (Toolkits -> Google Drive -> Connect)
4. Add the folder ID and connected account to config
5. Run `scripts/google-drive-sync.js --sync --config tiktok-marketing/config.json`

Set provider to `googledrive` (all real photos) or `mixed` (real photos where available, AI fills gaps). See [references/google-drive-setup.md](references/google-drive-setup.md) for full setup guide.

**Then — and this is critical — work through the image style with them.** Bad images = nobody watches. Ask these naturally:

> "Now let's figure out what these images should look like. What kind of shots work best for your restaurant? Close-ups of dishes? The dining room atmosphere? Kitchen action shots? Chef plating?"

Then based on their answer, dig deeper:

- **What's the food style?** "What does your signature dish look like? Describe the plating, the colors."
- **What vibe?** "Cozy candlelit? Bright and fresh? Rustic and homey? Sleek and modern?"
- **Consistency:** "Should all 6 slides feel like the same restaurant? If yes — I need to lock down specific details so each slide doesn't look totally different."
- **Must-have elements?** "Anything that HAS to be in every image? Specific dishware? A wood-fired oven? A particular view?"

Build the base prompt WITH them. A good base prompt for a restaurant looks like:

```
iPhone photo of [specific dish/scene] at [restaurant style], [specific details].
Warm ambient lighting, natural colors, taken on iPhone 15 Pro.
No text, no watermarks, no logos.
[Consistency anchors: "same wooden table", "same white plates", "exposed brick wall in background"]
```

**Save the agreed prompt style to config as `imageGen.basePrompt`** so every future post uses it.

**Key prompt rules (explain these as they come up, don't lecture):**
- "iPhone photo" + "warm ambient lighting" = looks real, not AI-generated
- Lock the setting (table, plates, background) in EVERY slide prompt for consistency
- Include realistic details (condensation on glasses, crumbs on the table, napkin folds) for authenticity
- For food: show texture, steam, sauce drips — make it look appetizing
- Portrait orientation (1024x1536) always — this is TikTok
- Extremely specific > vague ("close-up of hand-pulled mozzarella on a rustic wooden board with basil leaves and cherry tomatoes" > "a nice pizza")

**NEVER use generic prompts** like "a nice dish" or "a restaurant interior" — they produce generic images that get scrolled past.

### Phase 4: Composio Setup (ESSENTIAL — Powers the Entire Pipeline)

Composio is what handles posting to TikTok (and other platforms) and provides the analytics data that powers the feedback loop.

Frame it naturally to the user:

> "So here's the key piece — we need Composio to handle posting and analytics. It's what lets me post your slideshows to TikTok and track every post's performance. Without it, I'd have to post manually and we'd be guessing what works. With it, I can run a daily report that shows you exactly which hooks are driving views and bookings."

Walk them through connecting step by step:

1. **Sign up at [composio.dev](https://composio.dev/)** — create an account
2. **Get the API key** — from the Composio dashboard. This is how the scripts talk to Composio programmatically
3. **Connect TikTok** — Toolkits -> TikTok -> Connect. Note the `connected_account_id` (format: `ca_xxxxx`)
4. **Connect Instagram** (recommended) — Toolkits -> Instagram -> Connect. Requires a Business or Creator account. Especially strong for food content
5. **Connect Facebook** (recommended for local reach) — Toolkits -> Facebook -> Connect. Requires a Facebook Page (not personal profile). Great for neighborhood restaurants
6. **(If using Google Drive photos)** Connect Google Drive — Toolkits -> Google Drive -> Connect. Authorize access to the photo folder

Explain how Composio works:

> "Composio uses a single API pattern for everything — posting, analytics, listing videos. Each platform you connect gets a 'connected account ID'. I'll use that to post and pull data. It also handles OAuth token refresh automatically, so you won't need to re-authenticate."

Explain the draft workflow:

> "One important thing — posts go to your TikTok inbox as drafts, not straight to your feed. Before you publish each one, add a trending sound from TikTok's sound library. Music is the single biggest factor in TikTok reach — silent slideshows get buried. It takes 30 seconds per post and makes a massive difference."

**Don't move on until Composio is connected and the API key works.** Test it by calling `TIKTOK_GET_USER_STATS` via the Composio API. If it returns your account data, you're good.

### Phase 5: Booking Tracking (THE Intelligence Loop)

This is where the skill goes from "content automation" to "intelligent marketing system." Without booking tracking, you're optimizing for vanity metrics. With it, you're optimizing for actual revenue.

Explain WHY it matters:

> "Right now with Composio, I can track which posts get views and engagement. That's the top of the funnel. But views alone don't fill tables — we need to know which posts actually drive bookings."
>
> "When I combine TikTok analytics with your booking data, I can make genuinely intelligent decisions:"
>
> "If a post gets **50K views but zero bookings**, I know the hook is great but the call-to-action or your booking page needs work. If a post gets **2K views but 5 new reservations**, I know the content converts amazingly — we just need more eyeballs on it, so we fix the hook."
>
> "Without booking data, I'm optimizing for vanity metrics. With it, I'm optimizing for revenue."

**Walk them through setup based on their booking system:**

**If they use an online booking platform (OpenTable, Resy, TheFork, Quandoo, etc.):**
1. Ask if their platform has an API or export feature
2. If yes, set up automated data pulling (the agent should research the specific platform's API)
3. If no, set up a daily manual check — the agent asks for yesterday's booking count each morning

**If they use their own website booking system:**
1. Ask if they have Google Analytics on their booking page
2. If yes, set up UTM links in the TikTok bio: `?utm_source=tiktok&utm_medium=social&utm_campaign=slideshow`
3. Track booking page visits and completions from TikTok specifically

**If they rely on phone/walk-in only:**
1. Set up a simple daily prompt — the agent asks "How many covers did you do yesterday?" each morning
2. Track the trend over time and correlate with posting activity

Store the tracking method in config as `bookingTracking`:
```json
{
  "bookingTracking": {
    "method": "manual|api|utm",
    "platform": "opentable|resy|thefork|website|manual",
    "dailyBaseline": 45,
    "notes": "Average covers before TikTok marketing started"
  }
}
```

**The baseline is critical.** Before starting to post, record their average daily/weekly bookings. This is the "before" number that lets us measure the impact of TikTok marketing. Without it, you can't tell if bookings went up because of the content or because of seasonality.

**What booking data gives the daily report:**
- Correlation between post timing and booking spikes (24-72h window)
- Which hooks drive the most bookings, not just views
- Whether the booking page itself needs work (high views + low bookings = landing page issue)

**Without booking data:** The loop still works on Composio analytics (views/likes/comments). You can optimize for engagement. But you're flying blind on revenue.

**With booking data:** You optimize for actual paying diners. Every decision the daily report makes is better with booking data.

### Phase 6: Content Strategy (Built from Research)

Using the competitor research AND the restaurant profile, build an initial content strategy:

> "Based on what I found and what your restaurant offers, here's my plan for the first week..."

Present:
1. **3-5 hook ideas** tailored to their cuisine + competitor gaps
2. **Posting schedule** recommendation (default: 11:00am, 5:00pm, 8:30pm — their timezone, timed around meal decisions)
3. **Which hook categories to test first** (reference what worked for competitors)
4. **Cross-posting plan** (which platforms, same or adapted content)

**Restaurant-specific posting times:**
- **11:00 AM** — lunch decision time (people deciding where to eat)
- **5:00 PM** — dinner planning (couples/families figuring out evening plans)
- **8:30 PM** — evening scroll + FOMO (people see food content and think "I need to go there")

Save the strategy to `tiktok-marketing/strategy.json`.

### Phase 7: Set Up the Daily Analytics Cron

This is what makes the whole system self-improving. Set up a daily cron job that:

1. Pulls recent video data from Composio (via `TIKTOK_LIST_VIDEOS` and `TIKTOK_GET_USER_STATS`)
2. Pulls booking data (from the configured tracking method)
3. Cross-references views with bookings to diagnose what's working
4. Generates a report with specific recommendations
5. Suggests new hooks based on performance patterns

Explain to the user:

> "I'm going to set up a daily check that runs every morning. It looks at how your posts performed — views, engagement, and your booking numbers. Then it tells you exactly what's working and what to change."

**Set up the cron:**

Use the agent's cron system to schedule a daily analytics job. Run it every morning before the first post of the day (e.g. 10:00 AM in the user's timezone) so the report informs that day's content:

```
Schedule: daily at 10:00 (user's timezone)
Task: Run scripts/daily-report.js --config tiktok-marketing/config.json --days 3
Output: tiktok-marketing/reports/YYYY-MM-DD.md + message to user with summary
```

The daily report uses the diagnostic framework:
- **High views + More bookings** -> SCALE IT — more of the same, test posting times
- **High views + Same bookings** -> Hook works, CTA/booking page is broken — test new CTAs on slide 6, check booking page
- **Low views + More bookings** -> Content converts but nobody sees it — fix the hooks, keep the CTA
- **Low views + Same bookings** -> Full reset — new format, new audience angle, new hook categories

This is the intelligence layer. Without it, you're just posting and hoping. With it, every day's content is informed by data.

### Phase 8: Save Config & First Post

Store everything in `tiktok-marketing/config.json` (this is the source of truth for the entire pipeline):

```json
{
  "restaurant": {
    "name": "Restaurant Name",
    "cuisine": "Italian",
    "description": "Detailed description of the restaurant",
    "audience": "Target diners (date night couples, families, foodies, etc.)",
    "vibe": "Cozy, intimate, candlelit",
    "differentiator": "What makes it stand out",
    "signatureDishes": ["Dish 1", "Dish 2"],
    "bookingUrl": "https://...",
    "location": "City, Neighborhood",
    "priceRange": "$$"
  },
  "imageGen": {
    "provider": "openai",
    "apiKey": "sk-...",
    "model": "gpt-image-1.5",
    "basePrompt": "iPhone photo of..."
  },
  "composio": {
    "apiKey": "your-composio-api-key",
    "connectedAccounts": {
      "tiktok": "ca_xxxxx",
      "instagram": "ca_yyyyy",
      "facebook": "ca_zzzzz",
      "googledrive": "ca_gdrive_xxxxx"
    },
    "userId": "user_123"
  },
  "platforms": {
    "tiktok": { "enabled": true, "dimensions": "1024x1536", "slides": 6 },
    "instagram": { "enabled": true, "postTypes": ["feed", "reels"], "feedDimensions": "1080x1350" },
    "facebook": { "enabled": true, "pageId": "page_id_here", "feedDimensions": "1200x630" }
  },
  "bookingTracking": {
    "method": "manual",
    "platform": "opentable",
    "dailyBaseline": 45
  },
  "knowledgeBase": {
    "dir": "tiktok-marketing/knowledge-base",
    "menu": "tiktok-marketing/knowledge-base/menu.json",
    "history": "tiktok-marketing/knowledge-base/history.json",
    "chef": "tiktok-marketing/knowledge-base/chef.json",
    "recipes": "tiktok-marketing/knowledge-base/recipes.json"
  },
  "googleDrive": {
    "enabled": true,
    "folderId": "google-drive-folder-id",
    "localCachePath": "tiktok-marketing/photos/"
  },
  "posting": {
    "privacyLevel": "SELF_ONLY",
    "schedule": ["11:00", "17:00", "20:30"],
    "platformSchedule": {
      "tiktok": ["11:00", "17:00", "20:30"],
      "instagram": ["12:00", "18:00"],
      "facebook": ["10:00", "17:00"]
    }
  },
  "competitors": "tiktok-marketing/competitor-research.json",
  "strategy": "tiktok-marketing/strategy.json"
}
```

Then generate the **first test slideshow** — but set expectations:

> "Let's create our first slideshow. This is a TEST — we're dialing in the image style, not posting yet. I'll generate 6 slides and we'll look at them together. If the images look off, we tweak the prompts and try again. The goal is to get the look nailed down BEFORE we start posting."

**THE REFINEMENT PROCESS IS PART OF THE SKILL:**

Getting the images right takes iteration. This is normal and expected. Walk the user through it:

1. **Generate a test set of 6 images** using the prompts you built together
2. **Show them the results** and ask: "How do these look? Does the food look appetizing? Is the vibe right?"
3. **Tweak based on feedback** — adjust the base prompt, regenerate
4. **Repeat until they're happy** — this might take 2-5 rounds, that's fine
5. **Lock the prompt style** once it looks right — save to config

Things to watch for and ask about:
- "Does the food look appetizing or does it look AI-generated?"
- "Is the lighting right? Too bright? Too moody? Too clinical?"
- "Does this match the actual vibe of your restaurant?"
- "Would this make YOU want to book a table?"

**You do NOT have to post anything you don't like.** The first few generations are purely for refining the prompt. Only start posting once the images consistently look good.

Once the style is locked in, THEN use the hook strategy from competitor research and their cuisine category (see [references/slide-structure.md](references/slide-structure.md)) and start the posting schedule.

---

## Core Workflow

### 1. Generate Slideshow Images

Use `scripts/generate-slides.js`:

```bash
node scripts/generate-slides.js --config tiktok-marketing/config.json --output tiktok-marketing/posts/YYYY-MM-DD-HHmm/ --prompts prompts.json
```

The script uses OpenAI's gpt-image-1.5 for generation, or skips generation if provider is set to `local` (for using your own photos).

**Timeout warning:** Generating 6 images takes 3-9 minutes total (30-90 seconds each for gpt-image-1.5). Set your exec timeout to at least **600 seconds (10 minutes)**. If you get `spawnSync ETIMEDOUT`, the exec timeout is too short. The script supports resume — if it fails partway, re-run it and completed slides will be skipped.

**Critical image rules:**
- ALWAYS portrait aspect ratio (1024x1536 or 9:16 equivalent) — fills TikTok screen
- Include "iPhone photo" and "warm ambient lighting" in prompts
- ALL 6 slides share the EXACT same base description (only dish/style/angle changes)
- Lock key elements across all slides (table setting, plates, background, lighting direction)
- See [references/slide-structure.md](references/slide-structure.md) for the 6-slide formula

### 2. Add Text Overlays

This step uses `node-canvas` to render text directly onto your slide images. The text sizing, positioning, and styling are dialled in for viral TikTok slides.

#### Setting Up node-canvas

Before you can add text overlays, your human needs to install `node-canvas`. Prompt them:

> "To add text overlays to the slides, I need a library called node-canvas. Can you run this in your terminal?"
>
> ```bash
> npm install canvas
> ```
>
> "If that fails, it's because node-canvas needs some system libraries. Here's what to install first:"
>
> **macOS:**
> ```bash
> brew install pkg-config cairo pango libpng jpeg giflib librsvg
> npm install canvas
> ```
>
> **Ubuntu/Debian:**
> ```bash
> sudo apt-get install build-essential libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev
> npm install canvas
> ```
>
> **Windows:**
> ```bash
> # node-canvas auto-downloads prebuilt binaries on Windows
> npm install canvas
> ```

Use `scripts/add-text-overlay.js`:

```bash
node scripts/add-text-overlay.js --input tiktok-marketing/posts/YYYY-MM-DD-HHmm/ --texts texts.json
```

**Text content rules:**
- **REACTIONS not labels** — "Wait... this is actually their PASTA??" not "Homemade pasta"
- **4-6 words per line** — short lines are scannable at a glance
- **3-4 lines per slide is ideal**
- **No emoji** — canvas can't render them reliably
- **Use `\n` for manual line breaks** (gives you control over rhythm)
- **Safe zones:** No text in bottom 20% (TikTok controls) or top 10% (status bar)

**Good text examples for restaurants:**
```json
[
  "My friend said this\nplace looks expensive\nbut check the prices",
  "We walked in and\nthe smell alone\nmade me hungry",
  "Then they brought\nout the starter and\nI lost it",
  "Wait... is this\nactually homemade\npasta??",
  "Okay I'm literally\nnever cooking\nat home again",
  "Book a table at\n[Restaurant Name]\nlink in bio"
]
```

### 3. Post to Platforms

**Post to all enabled platforms at once** using the orchestrator:

```bash
node scripts/post-to-platforms.js --config tiktok-marketing/config.json --dir tiktok-marketing/posts/YYYY-MM-DD-HHmm/ --caption "caption" --title "title"
```

Or post to individual platforms:

```bash
# TikTok (6-slide slideshow, posts as draft)
node scripts/post-to-tiktok.js --config tiktok-marketing/config.json --dir <dir> --caption "text" --title "title"

# Instagram (carousel up to 10 slides, or single image)
node scripts/post-to-instagram.js --config tiktok-marketing/config.json --dir <dir> --caption "text" --type feed

# Facebook (single photo post)
node scripts/post-to-facebook.js --config tiktok-marketing/config.json --dir <dir> --caption "text"
```

See [references/platform-formats.md](references/platform-formats.md) for per-platform dimensions, caption formats, and posting best practices.

### Why We Post TikTok as Drafts (SELF_ONLY) — Best Practice

Posts go to your TikTok inbox as drafts, NOT published directly. This is intentional and critical:

1. **Music is everything on TikTok.** Trending sounds massively boost reach. The algorithm favours posts using popular audio. An API can't pick the right trending sound — you need to browse TikTok's sound library and pick what's hot RIGHT NOW in the food niche.
2. **You add the music manually**, then publish from your TikTok inbox. Takes 30 seconds per post.
3. **Posts without music get buried.** Silent slideshows look like ads and get skipped. A trending sound makes your content feel native.
4. **Creative control.** You can preview the final slideshow with music before it goes live. If something looks off, fix it before publishing.

**Tell the user during onboarding:** "Posts will land in your TikTok inbox as drafts. Before publishing each one, add a trending sound from TikTok's library — this is the single biggest factor in reach. It takes 30 seconds and makes a massive difference."

Cross-posts to any connected platforms (Instagram, YouTube, etc.) automatically via Composio.

**Caption rules:** Long storytelling captions (3x more views). Structure: Hook -> Problem -> Discovery -> What it offers -> Result -> max 5 hashtags. Conversational tone. Mention the restaurant name naturally.

### 4. Track Post Performance

After the user publishes from their TikTok inbox, the daily cron handles analytics automatically. It:

1. Fetches the video list via Composio's `TIKTOK_LIST_VIDEOS`
2. Gets account-level stats via `TIKTOK_GET_USER_STATS`
3. Tracks delta changes (followers gained, total views increase)
4. Cross-references with booking data
5. Generates the daily report

Use `scripts/check-analytics.js` for manual checks:

```bash
node scripts/check-analytics.js --config tiktok-marketing/config.json --days 3
```

---

## The Feedback Loop (CRITICAL — This is What Makes It Work)

This is what separates "posting TikToks" from "running a marketing machine." The daily cron pulls data from two sources:

1. **Composio** -> TikTok analytics (account stats, video list, engagement delta)
2. **Booking data** (from the configured tracking method) -> reservation counts

Combined, the agent can make intelligent decisions about what to do next — not guessing, not vibes, actual data-driven optimization.

### The Daily Cron (Set Up During Onboarding)

Every morning before the first post, the cron runs `scripts/daily-report.js`:

1. Pulls account stats from Composio (followers, total views delta)
2. Lists recent videos and compares with previous snapshot
3. Pulls booking data (API, UTM analytics, or asks user)
4. Cross-references: which posting periods correlated with booking spikes
5. Applies the diagnostic framework (below) to determine what's working
6. Generates `tiktok-marketing/reports/YYYY-MM-DD.md` with findings
7. Messages the user with a summary + suggested hooks for today

### The Diagnostic Framework

This is the core intelligence. Two axes: **views** (are people seeing it?) and **bookings** (are people reserving?).

**High views + More bookings** -> SCALE IT
- This is working. Make 3 variations of the winning hook immediately
- Test different posting times to find the sweet spot
- Cross-post to more platforms for extra reach
- Don't change anything about the CTA — it's converting

**High views + Same bookings** -> FIX THE CTA
- The hook is doing its job — people are watching. But they're not booking
- Try different CTAs on slide 6 (direct vs subtle, "book now" vs "check the menu")
- Check if the booking page matches the promise in the slideshow
- Test different caption structures — maybe the CTA is buried
- Check that "link in bio" actually works and goes to the booking page
- The hook is gold — don't touch it. Fix everything downstream

**Low views + More bookings** -> FIX THE HOOKS
- The people who DO see it are booking — the content and CTA are great
- But not enough people are seeing it, so the hook/thumbnail isn't stopping the scroll
- Test radically different hooks (person+conflict, POV, listicle, chef secrets)
- Try different posting times and different slide 1 images
- Keep the CTA and content structure identical — just change the hook

**Low views + Same bookings** -> FULL RESET
- Neither the hook nor the conversion path is working
- Try a completely different format or approach
- Research what's trending in the food niche RIGHT NOW (use browser)
- Consider a different target audience angle
- Test new hook categories from scratch
- Reference competitor research for what's working for others

**High views + Many bookings but bad reviews** -> EXPERIENCE ISSUE
- The marketing is working. People are watching AND booking. But the experience isn't matching.
- This is NOT a content problem — the restaurant experience needs attention
- Check: Are you overselling in the content? Does reality match the slideshows?
- Check: Is the kitchen keeping up with increased demand?
- **This is a signal to pause scaling and fix the experience first**

**The daily report automates all of this.** It cross-references TikTok stats with booking data and tells you exactly which part of the funnel is broken. It also auto-generates new hook suggestions based on your winning patterns and flags when CTAs need rotating.

### Hook Evolution

Track in `tiktok-marketing/hook-performance.json`:

```json
{
  "hooks": [
    {
      "date": "2026-04-08",
      "text": "My friend said this place was overrated so I took her there",
      "restaurant": "La Trattoria",
      "category": "person-conflict",
      "views_delta": 45000,
      "bookings_delta": 8,
      "cta": "Book at La Trattoria — link in bio",
      "lastChecked": "2026-04-09"
    }
  ],
  "ctas": [
    {
      "text": "Book a table — link in bio",
      "timesUsed": 5,
      "totalViewsDelta": 120000,
      "totalBookingsDelta": 18,
      "bookingRate": 0.15
    }
  ],
  "rules": {
    "doubleDown": ["person-conflict-food"],
    "testing": ["chef-secrets", "kitchen-pov"],
    "dropped": ["generic-food-shots", "price-comparison"]
  }
}
```

**The daily report updates this automatically.** Each post gets tagged with its hook text, CTA, view delta, and attributed bookings. Over time, this builds a clear picture of which hook + CTA combinations actually drive revenue.

**CTA rotation:** When the report detects high views but low bookings, it automatically recommends rotating to a different CTA and tracks performance of each CTA separately.

**Decision rules:**
- 50K+ views -> DOUBLE DOWN — make 3 variations immediately
- 10K-50K -> Good — keep in rotation
- 1K-10K -> Try 1 more variation
- <1K twice -> DROP — try something radically different

### CTA Testing

When views are good but bookings are low, cycle through CTAs:
- "Book a table at [Restaurant] — link in bio"
- "[Restaurant] takes reservations — link in bio"
- "This is [Restaurant] in [neighborhood] — link in bio"
- "We're open tonight — link in bio to book"
- No explicit CTA (just restaurant name visible on slide 6)

Track which CTAs convert best per hook category.

---

## Posting Schedule

Optimal times for restaurant content (adjust for audience timezone):
- **11:00 AM** — lunch decision time
- **5:00 PM** — dinner planning
- **8:30 PM** — evening scroll + FOMO

3x/day minimum. Consistency beats sporadic viral hits. 100 posts beats 1 viral.

## Cross-Posting

Composio supports cross-posting to multiple platforms. Recommend:
- **Instagram Reels** — especially strong for food/restaurant content
- **YouTube Shorts** — long-tail discovery
- **Facebook** — local audience reach (especially for neighborhood restaurants)

Same slides, different algorithms, more surface area.

## Restaurant Category Templates

See [references/app-categories.md](references/app-categories.md) for cuisine-specific slide prompts and hook formulas.

---

## Promotion Detection (WATCH FOR THIS)

The AI agent should ALWAYS watch for promotional language in conversation. When a restaurant owner mentions a promotion, the agent detects it, confirms, and creates promotional content automatically.

### What to Watch For
- Discount percentages: "20% off", "half price", "buy one get one"
- Date ranges: "from April 10 to 17", "this weekend only", "all month"
- Keywords: "special offer", "happy hour", "limited time", "promotion", "deal", "seasonal menu", "new dish", "event", "collaboration", "prix fixe", "tasting menu"

### When Detected

1. **Confirm with the user:**
   > "Sounds like you have a promotion — 20% off pasta dishes from April 10-17. Want me to create promotional content for this?"

2. **Extract the details:** What items, what discount/offer, start date, end date, terms

3. **Store the promotion:**
   ```bash
   node scripts/promotion-manager.js --add --dir tiktok-marketing/ --data '{"name":"Pasta Week","type":"discount","discount":"20%","items":["Carbonara","Cacio e Pepe"],"startDate":"2026-04-10","endDate":"2026-04-17","terms":"Dine-in only"}'
   ```

4. **Generate a content calendar:**
   ```bash
   node scripts/promotion-manager.js --content-plan --dir tiktok-marketing/ --id promo_20260410_pasta-week
   ```

5. **Create the content** following the calendar: teasers before launch, launch posts, mid-promo social proof, last-chance urgency, and wrap-up

### Promotion Content Rules
- **60/40 rule:** During an active promotion, 60% of posts should be regular content, 40% promotional. Don't spam
- **Use the knowledge base:** Pull recipe stories and ingredient details for richer promotional content
- **Use real photos:** If Google Drive has photos of the promoted dishes, prioritize those over AI-generated
- **Track everything:** Add `--promotion <id>` flag when generating slides so performance is attributed

### The Daily Report Handles Promotions Automatically
The daily cron flags active promotions, warns about expiring ones, and tracks performance vs baseline. After a promotion ends, `scripts/promotion-manager.js --report <id>` generates a summary of what worked.

See [references/promotion-content-guide.md](references/promotion-content-guide.md) for the full content calendar template, hook formulas for promotions, and the 60/40 balance rule.

---

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| 1536x1024 (landscape) | Use 1024x1536 (portrait) |
| Font at 5% | Use 6.5% of width |
| Text at bottom | Position at 30% from top |
| Different settings per slide | Lock table/plates/background in EVERY prompt |
| Labels not reactions | "Wait this pasta is INSANE" not "Homemade pasta" |
| Only tracking views | Track bookings — views without reservations = vanity |
| Same hooks forever | Iterate based on data, test new formats weekly |
| No cross-posting | Use Composio to post everywhere simultaneously |
| Generic food photos | Be specific: show YOUR dishes, YOUR restaurant |
| Posting at random times | Post at meal decision times (11am, 5pm, 8:30pm) |
| No music on TikTok | Add trending sound before publishing — silent = buried |
| `spawnSync ETIMEDOUT` | Exec timeout too short — image gen takes 3-9 min. Use 10-minute timeout |
