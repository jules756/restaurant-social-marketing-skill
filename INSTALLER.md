# Installer Brief

**If you are an AI agent running the install on a client VM, read this file to completion before asking the human anything.** If you find yourself about to ask for the restaurant name, cuisine, location, booking URL, menu, or any other restaurant-content detail — stop. Those come from the restaurant owner via Telegram later.

---

## Your Scope

You are the **Installer**. Your job is narrow:

1. Install the skill suite into Hermes.
2. Install the Composio SDK globally.
3. Paste five Composio values (from the provisioning bundle) + the Telegram bot token/chatId into `social-marketing/config.json`.
4. Register the client's MCP server in `~/.hermes/config.yaml`.
5. Run the Phase 0 validator.

There are no other API keys to collect. **All external calls from this VM are authorized by Composio** — OAuth tokens for TikTok/Instagram/Facebook/Drive and the OpenRouter credential for image generation all live inside the client's Composio Project. The VM holds nothing but pointers.

## What You DO NOT Ask the Human

- ❌ Restaurant name, cuisine, location, booking URL, menu, signature dishes, vibe, typical guest, image style.
- ❌ OpenRouter API key — OpenRouter goes through Composio now.
- ❌ Per-platform `connected_account_id` / `ca_…` values — MCP + user_id resolve them.
- ❌ Drive folder ID — found/created by name at first use.

---

## Installation Sequence

### Step 1 — Clone the repo

```bash
git clone https://github.com/jules756/restaurant-social-marketing-skill.git ~/restaurant-social-marketing-skill
cd ~/restaurant-social-marketing-skill
git pull origin main
```

### Step 2 — Copy skills into Hermes (under `social-media/` category)

```bash
rm -rf ~/.hermes/skills/social-media/restaurant-social-marketing
rm -rf ~/.hermes/skills/social-media/restaurant-social-marketing-setup-verification
mkdir -p ~/.hermes/skills/social-media
cp -r ~/restaurant-social-marketing-skill/skills/* ~/.hermes/skills/social-media/
cp -r ~/restaurant-social-marketing-skill/adapted-skills/* ~/.hermes/skills/social-media/
```

**Do not** copy `docs/` or `legacy/`. Verify six skill dirs:

```bash
ls ~/.hermes/skills/social-media/ | grep -E '(restaurant-marketing|content-preparation|marketing-intelligence|food-photography-hermes|social-media-seo-hermes|social-trend-monitor-hermes)' | wc -l
```

Should print `6`.

### Step 3 — Install `@composio/core` globally

```bash
npm install -g @composio/core
```

Verify:

```bash
node -e "console.log(require('@composio/core').Composio)"
```

Should print a function/class, not throw.

### Step 4 — Register the Composio MCP server in Hermes

Append to `~/.hermes/config.yaml` (create the file if missing). The URL and `ck_…` key come from the provisioning bundle for this restaurant:

```yaml
mcp_servers:
  composio:
    url: "<COMPOSIO_MCP_URL>"
    headers:
      Authorization: "Bearer <COMPOSIO_MCP_SERVER_KEY>"
```

The URL will look like:
```
https://backend.composio.dev/v3/mcp/<server_id>/mcp?user_id=<entity>
```

Inside an active Hermes chat, run `/reload-mcp` to pick up the change.

### Step 5 — Scaffold the client working directory

```bash
cd ~
mkdir -p social-marketing/photos/{dishes,ambiance,kitchen,exterior,unsorted}
mkdir -p social-marketing/{posts,knowledge-base}
mkdir -p social-marketing/reports/{trend-reports,competitor}
cp ~/restaurant-social-marketing-skill/templates/config.template.json ~/social-marketing/config.json
```

### Step 6 — Fill in `~/social-marketing/config.json`

Paste the five Composio values from the provisioning bundle + Telegram bot info. Everything else stays at template defaults.

```json
{
  "telegram": {
    "botToken": "<from @BotFather>",
    "chatId":   "<owner's chat id>"
  },
  "composio": {
    "projectId":     "<Composio Project ID for this restaurant>",
    "userId":        "<per-restaurant entity identifier>",
    "projectApiKey": "<ak_... project-scoped REST key>",
    "mcp": {
      "url":       "<same URL as Step 4>",
      "serverKey": "<same ck_ key as Step 4>"
    }
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

### Step 7 — Run the validator

```bash
node ~/restaurant-social-marketing-skill/scripts/setup.js --config ~/social-marketing/config.json
```

Every line must report ✅. The checks are:

- `config.json is Installer-scope only` — no restaurant content bled in.
- `node v18+`.
- `@composio/core SDK reachable`.
- `Telegram bot @<username>` + `chat_id`.
- `Composio project API key valid`.
- `composio.userId "<id>" resolves` — verifies the entity exists in the Project.
- `Image model "<model>" reachable via Composio` — confirms OpenRouter credential is attached to the Project.
- `Composio MCP reachable` — JSON-RPC initialize against the MCP URL.
- Per-platform `enabled` booleans.
- Drive `enabled` + `folderName`.

Common failures:

- **`composio.userId resolves`** fails → the `user_id` doesn't match the entity under which OAuth connections were created in the Composio Project. Check the provisioning bundle.
- **`Image model reachable via Composio`** fails → the OpenRouter credential hasn't been added to the Composio Project. Add it via the Project's API Keys / Connections page.
- **`Composio MCP reachable`** fails → the URL format is wrong (expect `https://backend.composio.dev/v3/mcp/<server_id>/mcp?user_id=<entity>`) or the `ck_` key doesn't match that server.

### Step 8 — Start Hermes

```bash
hermes
```

### Step 9 — Hand the Telegram bot to the owner

The owner starts a chat with the bot. The orchestrator runs ≤7 onboarding questions and writes the answers to `~/social-marketing/restaurant-profile.json`. The Installer never touches that file.

---

## One-Sentence Summary

**Install the skills, install the SDK, paste the five Composio values, register MCP in Hermes, validate, hand off.**
