# Installer Brief — v4

**If you are an AI agent running the install on a host VM, read this file to completion before asking the human anything.** Restaurant content (name, cuisine, location, booking URL, menu) comes from the owner via Telegram later — never ask.

v4 is **Docker-first**. The install runs inside a per-agent container; you only touch the host enough to bring the container up.

---

## Your Scope (Three Items)

| # | Item                           | Source                                                            |
|---|--------------------------------|-------------------------------------------------------------------|
| 1 | Telegram `botToken` + `chatId` | Ask the human. Token from @BotFather; chatId via `getUpdates`.    |
| 2 | `composio.apiKey`              | Ask the human. Project-scoped API key from https://app.composio.dev. One Composio project per company. |
| 3 | `composio.userId`              | Ask the human. **Per-agent identifier** (e.g. `rodolfino-marketing`). Composio uses it to scope the MCP server. |

**That is the complete list.** Plus which platforms are enabled (booleans). Nothing else.

## What You DO NOT Ask

- Restaurant name / cuisine / location / booking URL / menu / dishes / vibe / guest type.
- OpenAI / OpenRouter API keys — both live in the Composio project, not on the VM.
- Instagram Business Account ID, Facebook Page ID, TikTok user id — Composio resolves these from the OAuth connection.
- Drive folder ID — Composio resolves it by name on each call.
- MCP server URL — `setup.js` writes it via `composio.mcp.create()`.
- imgbb / image-host keys — gone in v4.

---

## Installation Sequence

### Step 1 — Run the host-side installer

```bash
COMPANY=<short-id> bash install.sh
```

Where `<short-id>` is a slug for the company (e.g. `rodolfino`). That single command:
1. Clones the repo to `$HOME/restaurant-social-marketing-skill` (if not already there).
2. Builds the Docker image `restaurant-marketing:v4-alpha`.
3. Creates `/var/lib/akira/<company>/marketing/` as the host volume.
4. Materializes a per-agent compose file at `/opt/agents/<company>-marketing/docker-compose.yml`.
5. Brings the container up.

The container's first boot scaffolds `/data/social-marketing/` and copies the config template. It then sleeps so the operator can edit the config — it does **not** crash-loop.

### Step 2 — Edit `config.json`

The template lives at `/var/lib/akira/<company>/marketing/social-marketing/config.json` on the host (mounted to `/data/social-marketing/config.json` inside the container).

Fill exactly these fields:

```json
{
  "telegram": {
    "botToken": "<from @BotFather>",
    "chatId":   "<owner's chat id>"
  },
  "composio": {
    "apiKey": "<project API key>",
    "userId": "<per-agent id>"
  },
  "platforms": {
    "instagram": { "enabled": true },
    "tiktok":    { "enabled": true },
    "facebook":  { "enabled": false }
  },
  "googleDrive": {
    "enabled": true,
    "folderName": "akira-agent_src"
  }
}
```

Leave `mcpServerUrl`, `mcpServerId`, and `imageGen.toolSlug` blank — `setup.js` writes them.

### Step 3 — Connect OAuth + add OpenAI credential in the Composio dashboard

The operator does this once per company at https://app.composio.dev:

- For each enabled platform (`instagram` / `facebook` / `tiktok` / `googledrive`): create an Auth Config and finish the OAuth connect flow under the same `userId`.
- Add an `openai` Auth Config with the OpenAI API key (gpt-image-2 needs it).
- Optionally add an `openrouter` Auth Config for weekly trend research (Perplexity sonar).

Do **not** put any of these keys in `config.json`. They live in Composio.

### Step 4 — Restart the container so `setup.js` runs

```bash
docker compose -f /opt/agents/<company>-marketing/docker-compose.yml restart
docker logs -f marketing-agent-<company>-marketing
```

`docker-entrypoint.sh` detects the empty `mcpServerUrl`, runs `node /app/scripts/setup.js`, which calls `composio.mcp.create()` + `composio.mcp.generate()`, writes the URL into config, and verifies it by listing tools.

Every line must be ✅. Common failures:

- **`composio.apiKey` rejected** → wrong key or wrong project.
- **`auth config exists for "<toolkit>"` failed** → operator hasn't created the Auth Config in the Composio dashboard for that toolkit. The error message tells you whether the toolkit is OAuth (finish the connect flow) or API-key (paste the key).
- **`MCP client lists tools` fails** → connection works but the server returned 0 tools. Usually means OAuth wasn't completed for the toolkits whose tools you'd expect.

### Step 5 — Hand the Telegram bot to the owner

The owner starts a chat with the bot. The orchestrator runs ≤7 onboarding questions and writes answers to `/data/social-marketing/restaurant-profile.json`. The Installer never touches that file.

---

## One-Sentence Summary

**`COMPANY=<id> bash install.sh`, edit one config file, finish OAuth in the Composio dashboard, restart the container, hand off.**
