# Installer Brief

**If you are an AI agent running the install on a client VM, read this file to completion before asking the human anything.** If you find yourself about to ask for the restaurant name, cuisine, location, booking URL, menu, or any other restaurant-content detail — stop. Those are out of scope. They come from the restaurant owner via Telegram later.

---

## Your Scope (Four Items)

You are the **Installer**. Your job is to collect four pieces of plumbing and run the Phase 0 validator. Nothing else.

| # | Item                              | Source                                                                 |
|---|-----------------------------------|------------------------------------------------------------------------|
| 1 | `OPENROUTER_API_KEY`              | Ask the human. Starts with `sk-or-…`.                                  |
| 2 | Telegram `botToken` + `chatId`    | Ask. Token from @BotFather; chatId via `getUpdates`.                   |
| 3 | **Composio MCP server URL + `ck_…` key** | Ask. From https://app.composio.dev → MCP Servers. Client creates their own server there; we receive the URL and key. |
| 4 | Enabled platforms list            | Ask which of Instagram / TikTok / Facebook the restaurant is using.   |

**That is the complete list.** Do not invent a fifth item.

## What You DO NOT Ask the Human

- ❌ Restaurant name, cuisine, location, booking URL, menu, signature dishes, vibe, typical guest, image style.
- ❌ Platform `connected_account_id` / `ca_…` values. MCP handles entity scoping internally — you do not need them.
- ❌ Drive folder ID. The folder is named `akira-agent_src`; it's found or created at first use via an MCP call.

These are either owner-scope (collected via Telegram onboarding) or handled automatically by the MCP server.

If the human offers restaurant details unprompted, acknowledge and move on — do not write them to `config.json`.

---

## Installation Sequence

### Step 1 — Clone the repo

```bash
git clone https://github.com/jules756/restaurant-social-marketing-skill.git ~/restaurant-social-marketing-skill
cd ~/restaurant-social-marketing-skill
git pull origin main
```

### Step 2 — Copy skills into Hermes (under `social-media/` category)

Hermes organizes skills by category. Restaurant marketing goes under `social-media/`.

```bash
rm -rf ~/.hermes/skills/social-media/restaurant-social-marketing
rm -rf ~/.hermes/skills/social-media/restaurant-social-marketing-setup-verification
mkdir -p ~/.hermes/skills/social-media
cp -r ~/restaurant-social-marketing-skill/skills/* ~/.hermes/skills/social-media/
cp -r ~/restaurant-social-marketing-skill/adapted-skills/* ~/.hermes/skills/social-media/
```

**Do not** copy `docs/` or `legacy/`.

Verify 6 new skill dirs:

```bash
ls ~/.hermes/skills/social-media/ | grep -E '(restaurant-marketing|content-preparation|marketing-intelligence|food-photography-hermes|social-media-seo-hermes|social-trend-monitor-hermes)' | wc -l
```

Should print `6`.

### Step 3 — Add OpenRouter key to `~/.hermes/.env`

```bash
echo "OPENROUTER_API_KEY=<PASTE_HERE>" >> ~/.hermes/.env
chmod 600 ~/.hermes/.env
```

### Step 4 — Register the Composio MCP server in Hermes

Append this block to `~/.hermes/config.yaml` (create the file if missing):

```yaml
mcp_servers:
  composio:
    url: "<COMPOSIO_MCP_URL_FROM_CLIENT>"
    headers:
      Authorization: "Bearer <ck_SERVER_KEY_FROM_CLIENT>"
```

Replace `<COMPOSIO_MCP_URL_FROM_CLIENT>` with the MCP URL the client gave you (from their Composio dashboard → MCP Servers), and `<ck_SERVER_KEY_FROM_CLIENT>` with the `ck_…` server key.

Inside an active Hermes chat, run `/reload-mcp` to pick up the change.

### Step 5 — Scaffold the working directory

```bash
cd ~
mkdir -p social-marketing/photos/{dishes,ambiance,kitchen,exterior,unsorted}
mkdir -p social-marketing/{posts,knowledge-base}
mkdir -p social-marketing/reports/{trend-reports,competitor}
cp ~/restaurant-social-marketing-skill/templates/config.template.json ~/social-marketing/config.json
```

### Step 6 — Fill in `~/social-marketing/config.json` (Installer fields only)

Only these fields. Leave everything else (template defaults).

```json
{
  "telegram": {
    "botToken": "<from @BotFather>",
    "chatId":   "<owner's chat id>"
  },
  "composio": {
    "mcp": {
      "url": "<COMPOSIO_MCP_URL_FROM_CLIENT>",
      "serverKey": "<ck_SERVER_KEY_FROM_CLIENT>"
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

If the restaurant isn't using Drive, set `googleDrive.enabled: false`. If `config.imageGen.model` already reads `google/gemini-2.5-flash-image-preview`, leave it.

### Step 7 — Run the validator

```bash
set -a && source ~/.hermes/.env && set +a
node ~/restaurant-social-marketing-skill/scripts/setup.js --config ~/social-marketing/config.json
```

Every line must report ✅. Common failures:

- **Telegram `chatId` not set** → have the human send a message to the bot, then `curl https://api.telegram.org/bot<TOKEN>/getUpdates` to read the chat id.
- **`composio.mcp.url` unreachable** → check the URL is the one the client gave you, not a generic default. The `ck_…` key must be valid for that specific URL.
- **`config.imageGen.model` not reachable** → browse https://openrouter.ai/models, pick an image-output model that's listed, and update `config.imageGen.model`.

### Step 8 — Start Hermes

```bash
hermes
```

### Step 9 — Hand the Telegram bot to the owner

The owner starts a chat with the bot. The orchestrator runs ≤7 onboarding questions and writes answers to `~/social-marketing/restaurant-profile.json`. The Installer never touches that file.

---

## Optional: Cron-Based Automation

If the client wants daily analytics reports (sent to Telegram at 10:00) and weekly trend research (Mondays 09:00), those run **outside the Hermes agent loop** via cron. They need Composio's REST API instead of MCP. Add to `config.json`:

```json
"composio": {
  "apiKey":  "<ak_…_REST_KEY>",
  "userId":  "<client's user id in Composio>"
}
```

Without these, cron scripts won't run; the agent-loop features (onboarding, manual `generate post`, in-chat analytics via MCP) still work fine.

---

## Optional: Install the Composio Companion Skill

For better MCP tool guidance, install Composio's own skill:

```bash
npx skills add composiohq/skills --skill composio --dir ~/.hermes/skills/social-media/
```

It's a documentation skill — adds tool-router rules and trigger patterns. Not required.

---

## One-Sentence Summary

**Install the plumbing (skills, Hermes MCP server entry, config.json). Validate it. Hand off to the owner. Never ask the owner-scope questions.**
