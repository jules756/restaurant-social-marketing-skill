# Installer Brief

**If you are an AI agent running the install on a client VM, read this file to completion before asking the human anything.** Restaurant content (name, cuisine, location, booking URL, menu) comes from the owner via Telegram later — never ask.

---

## Your Scope (Four Items)

| # | Item                           | Source                                                            |
|---|--------------------------------|-------------------------------------------------------------------|
| 1 | Telegram `botToken` + `chatId` | Ask the human. Token from @BotFather; chatId via `getUpdates`.    |
| 2 | `composio.apiKey`              | Ask the human. Org-scoped API key (`ak_…`) from https://app.composio.dev. One Composio Organization per restaurant client — the key is already scoped to that org. |
| 3 | `composio.userId`              | Ask the human. **Per-restaurant entity identifier** within that org — NOT the operator's personal Composio account ID. All OAuth connections must be created under THIS entity in the Composio dashboard. If connected via Composio dashboard's Test button, the userId is typically `pg-test-<something>`. Mismatch → *"No connected accounts found"*. |
| 4 | `platforms.instagram.igUserId` | Required for Instagram. **Instagram Business Account ID** — a 17-digit number starting `17841…`. Not the Composio userId. Find in Meta Business Suite → Settings → Instagram accounts, or via Graph API Explorer: `me/accounts?fields=instagram_business_account`. Required by Instagram's Graph API; not auto-resolved by Composio. |

**That is the complete list.** Plus which platforms are enabled (booleans). Nothing else.

## What You DO NOT Ask

- ❌ Restaurant name / cuisine / location / booking URL / menu / dishes / vibe / guest type.
- ❌ OpenRouter API key — OpenRouter goes through the Composio org now.
- ❌ Per-platform `connected_account_id` / `ca_…` values — SDK resolves from userId.
- ❌ Drive folder ID — auto-discovered from `folderName` at first use.
- ❌ MCP server URL or `ck_…` key — MCP is not used. Everything goes through the SDK.

---

## Installation Sequence

### Step 1 — Clone the repo

```bash
git clone https://github.com/jules756/restaurant-social-marketing-skill.git ~/restaurant-social-marketing-skill
cd ~/restaurant-social-marketing-skill && git pull origin main
```

### Step 2 — Copy skills into Hermes (under `social-media/` category)

```bash
mkdir -p ~/.hermes/skills/social-media
cp -r ~/restaurant-social-marketing-skill/skills/* ~/.hermes/skills/social-media/
cp -r ~/restaurant-social-marketing-skill/adapted-skills/* ~/.hermes/skills/social-media/
```

**Do not** copy `docs/`. Verify six skill dirs:

```bash
ls ~/.hermes/skills/social-media/ | grep -cE '(restaurant-marketing|content-preparation|marketing-intelligence|food-photography-hermes|social-media-seo-hermes|social-trend-monitor-hermes)'
```

Should print `6`.

### Step 3 — Install SDK dependencies

```bash
cd ~/restaurant-social-marketing-skill && npm install
```

Verify:

```bash
cd ~/restaurant-social-marketing-skill && node -e "console.log(require('@composio/core').Composio)"
```

Should print a function, not throw.

### Step 3b — Install SOUL.md (Hermes persona override)

Without this, Hermes defaults to a general-assistant voice and will do meta-commentary on Telegram ("let me run the validator", "want me to debug?") instead of acting as the restaurant's marketing partner.

```bash
cp ~/restaurant-social-marketing-skill/templates/SOUL.md ~/.hermes/SOUL.md
```

`install.sh` does this automatically — included here in case of manual install.

### Step 4 — Scaffold the client working directory

```bash
mkdir -p ~/social-marketing/photos/{dishes,ambiance,kitchen,exterior,unsorted}
mkdir -p ~/social-marketing/{posts,knowledge-base}
mkdir -p ~/social-marketing/reports/{trend-reports,competitor}
cp ~/restaurant-social-marketing-skill/templates/config.template.json ~/social-marketing/config.json
```

### Step 5 — Fill in `~/social-marketing/config.json`

Only these fields. Leave everything else at template defaults.

```json
{
  "telegram": {
    "botToken": "<from @BotFather>",
    "chatId":   "<owner's chat id>"
  },
  "composio": {
    "apiKey":  "<ak_… org-scoped key>",
    "userId":  "<per-restaurant entity id>"
  },
  "platforms": {
    "instagram": { "enabled": true  },
    "tiktok":    { "enabled": true  },
    "facebook":  { "enabled": false }
  },
  "googleDrive": {
    "enabled": true,
    "folderName": "akira-agent_src"
  }
}
```

### Step 6 — Run the validator

```bash
cd ~/restaurant-social-marketing-skill && node scripts/setup.js --config ~/social-marketing/config.json
```

Every line must be ✅. Common failures:

- **`composio.apiKey` rejected** → wrong key or wrong org. Check https://app.composio.dev → org → API Keys.
- **`composio.userId` doesn't resolve** → userId doesn't match the entity under which OAuth connections were created. Check the org's Entities/Users page.
- **`@composio/core SDK reachable` fails** → run `cd ~/restaurant-social-marketing-skill && npm install`.

### Step 7 — Start Hermes

```bash
hermes
```

### Step 8 — Hand the Telegram bot to the owner

The owner starts a chat with the bot. The orchestrator runs ≤7 onboarding questions and writes answers to `~/social-marketing/restaurant-profile.json`. The Installer never touches that file.

---

## One-Sentence Summary

**Install skills, install SDK, paste two Composio values + Telegram token, validate, hand off.**
