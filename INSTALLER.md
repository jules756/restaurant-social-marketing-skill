# Installer Brief — v4

**If you are an AI agent running the install on a host VM, read this file to completion before asking the human anything.** Restaurant content (name, cuisine, location, booking URL, menu) comes from the owner via Telegram later — never ask.

v4 is **Docker-first**, layered on `nousresearch/hermes-agent`. The flow is:

1. Build the image + start the per-agent container (sleeps until configured).
2. Run **Hermes setup** in the TUI to pick model + provider key.
3. Fill the marketing-specific `config.json` with Telegram + Composio creds.
4. Connect OAuth in the Composio dashboard.
5. Restart the container so v4's pre-start runs `setup.js` and provisions the per-agent MCP server.

---

## Your Scope (Items to Ask the Human)

| # | Item                                                           | Source                                                                |
|---|----------------------------------------------------------------|-----------------------------------------------------------------------|
| 1 | Provider + API key for Hermes (OpenRouter / OpenAI / Anthropic) | Asked by `hermes setup` wizard in step 2.                              |
| 2 | Telegram `botToken` + `chatId`                                 | From @BotFather + `getUpdates`. Goes in `config.json` step 3.         |
| 3 | `composio.apiKey`                                              | Project-scoped key from https://app.composio.dev. Goes in `config.json`. |
| 4 | `composio.userId`                                              | Entity that owns the OAuth connections. Often `pg-test-…` if you used the dashboard "Test" button. |

**That is the complete list.** Plus which platforms are enabled.

## What You DO NOT Ask

- Restaurant name / cuisine / location / booking URL / menu / dishes / vibe / guest type.
- OpenAI / OpenRouter API keys for image gen / research — both live in the Composio project, not on the VM.
- Instagram Business Account ID, Facebook Page ID, TikTok user id — Composio resolves these from the OAuth connection.
- Drive folder ID — Composio resolves it by name on each call.
- MCP server URL — `setup.js` writes it via `composio.mcp.create()`.
- imgbb / image-host keys — gone in v4.

---

## Installation Sequence

### Step 1 — Build the image + start the container

```bash
COMPANY=<short-id> bash install.sh
```

Where `<short-id>` is a slug for the company (e.g. `rodolfino`). That single command:

1. Clones the repo to `$HOME/restaurant-social-marketing-skill` (if not already there).
2. Builds `restaurant-marketing:v4-alpha` (layered on `nousresearch/hermes-agent`).
3. Creates `~/.hermes-agent-<company>-marketing/` as the host volume.
4. Materializes a per-agent compose file at `~/agents/<company>-marketing/docker-compose.yml`.
5. Brings the container up.

The container's first boot scaffolds `/opt/data/social-marketing/` inside the volume and writes the v4 config template. It then sleeps until `config.json` is filled — it does **not** crash-loop.

### Step 2 — Run Hermes setup interactively

This is Hermes's standard first-time setup (model + provider key):

```bash
docker run --rm -it \
  --name marketing-agent-<company>-marketing-setup \
  -v ~/.hermes-agent-<company>-marketing:/opt/data \
  restaurant-marketing:v4-alpha hermes setup
```

The wizard asks for:
- The provider (OpenRouter / OpenAI / Anthropic / etc.)
- The provider API key (stored in `/opt/data/.env` as e.g. `OPENROUTER_API_KEY=…`)
- The model (stored in `/opt/data/config.yaml`)

Both files persist on the host volume (`~/.hermes-agent-<company>-marketing/.env` and `~/.hermes-agent-<company>-marketing/config.yaml`).

### Step 3 — Fill in the marketing config

If Hermes chown'd the volume to UID 10000 (which it does on first boot), restore host write access first:

```bash
sudo chown -R "$USER":"$USER" ~/.hermes-agent-<company>-marketing/
```

Then edit:

```bash
nano ~/.hermes-agent-<company>-marketing/social-marketing/config.json
```

Fill exactly these fields:

```json
{
  "telegram": {
    "botToken": "<from @BotFather>",
    "chatId":   "<owner's chat id>"
  },
  "composio": {
    "apiKey": "<project API key>",
    "userId": "<entity id, often pg-test-…>"
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

### Step 4 — Connect OAuth + add credentials in the Composio dashboard

At https://app.composio.dev, in the project that owns the API key from step 3:

- For each enabled platform (`instagram` / `facebook` / `tiktok` / `googledrive`): create an Auth Config and finish the OAuth connect flow **under the same `userId`** you put in `config.json`.
- Add an `openai` Auth Config with the OpenAI API key (gpt-image-2 needs it).
- Optionally add an `openrouter` Auth Config for weekly trend research.

Do **not** put any of these keys in `config.json`. They live in Composio.

### Step 5 — Restart the container so `setup.js` runs

```bash
docker compose -f ~/agents/<company>-marketing/docker-compose.yml restart
docker logs -f marketing-agent-<company>-marketing
```

The pre-start script detects an empty `mcpServerUrl`, runs `node /opt/hermes/social-marketing-skill/scripts/setup.js`, which calls `composio.mcp.create()` + `composio.mcp.generate()`, writes the URL into config, and verifies it by listing tools.

Every check must be ✅. Common failures:

- **`composio.apiKey` rejected** → wrong key or wrong project.
- **`auth config exists for "<toolkit>"` failed** → no Auth Config in the Composio dashboard for that toolkit. The error message hint says whether to finish OAuth (for OAuth toolkits) or paste an API key (for `openai`).
- **`MCP client lists tools` fails** → server up but advertising 0 tools. Usually means OAuth wasn't completed for the toolkits you expected.

After ✅, Hermes starts normally and the marketing skill is wired up.

### Step 6 — Hand the Telegram bot to the owner

The owner messages the bot. The `restaurant-marketing` skill picks up onboarding (≤7 questions) and writes answers to `/opt/data/social-marketing/restaurant-profile.json`. The Installer never touches that file.

---

## One-Sentence Summary

**`COMPANY=<id> bash install.sh` → `hermes setup` for the model → edit `config.json` for Telegram + Composio → connect OAuth in dashboard → restart container → hand off.**

---

## Where things live inside the container

| What | Path |
|---|---|
| v4 marketing scripts | `/opt/hermes/social-marketing-skill/scripts/` |
| v4 marketing config | `/opt/data/social-marketing/config.json` |
| Restaurant profile (owner-provided) | `/opt/data/social-marketing/restaurant-profile.json` |
| Photos / posts / knowledge-base | `/opt/data/social-marketing/{photos,posts,knowledge-base}/` |
| Hermes provider key | `/opt/data/.env` |
| Hermes model selection | `/opt/data/config.yaml` |
| Hermes skills (auto-synced) | `/opt/data/skills/social-media/` |
