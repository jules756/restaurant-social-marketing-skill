# Installer Brief

**If you are an AI agent running the install on a client VM, read this file to completion before asking the human anything.** If you find yourself about to ask the human for the restaurant name, cuisine, location, booking URL, menu, or any other restaurant-content detail — stop. Those are out of scope for the Installer. They come from the restaurant owner via Telegram later.

---

## Your Scope (Four Items Only)

You are the **Installer**. Your entire job is to collect four pieces of API plumbing and run the Phase 0 validator. Nothing else.

| # | Item                         | Source                                                                 |
|---|------------------------------|------------------------------------------------------------------------|
| 1 | `OPENROUTER_API_KEY`         | Ask the human. Starts with `sk-or-…`.                                  |
| 2 | `COMPOSIO_API_KEY`           | Ask the human. From https://app.composio.dev.                          |
| 3 | `telegram.botToken` + `chatId` | Ask the human. Token from @BotFather; chat_id via `getUpdates`.     |
| 4 | `platforms.*.composioAccountId` + `googleDrive.composioAccountId` | Ask the human per connected platform / for Drive. The Drive folder ID is auto-discovered from the folder name (`akira-agent_src`) — you do NOT need to ask the human for it. |

**That is the complete list.** Do not invent a fifth item.

---

## What You DO NOT Ask the Human

- ❌ Restaurant name
- ❌ Cuisine
- ❌ Location / city / neighborhood
- ❌ Booking URL
- ❌ Menu or signature dishes
- ❌ Vibe / atmosphere
- ❌ Typical guest
- ❌ Image style preferences
- ❌ Which platforms to use (they already picked — you only collect the `connected_account_id` for the ones they already connected in Composio)

These are **owner-scope**, collected by the bot via Telegram during onboarding. The orchestrator writes them to `social-marketing/restaurant-profile.json`. Do not touch that file.

If the human offers restaurant details unprompted, acknowledge and move on — do not write them to `config.json`.

---

## Exact Installation Sequence

### Step 1 — Clone

```bash
git clone https://github.com/jules756/restaurant-social-marketing-skill.git ~/restaurant-social-marketing-skill
cd ~/restaurant-social-marketing-skill
git pull origin main   # ensure latest
```

### Step 2 — Copy skills into Hermes

```bash
mkdir -p ~/.hermes/skills
cp -r ~/restaurant-social-marketing-skill/skills/* ~/.hermes/skills/
cp -r ~/restaurant-social-marketing-skill/adapted-skills/* ~/.hermes/skills/
```

**Do not** copy `docs/` or `legacy/`.

### Step 3 — Collect the two API keys, write to `~/.hermes/.env`

```bash
echo "OPENROUTER_API_KEY=<PASTE_HERE>" >> ~/.hermes/.env
echo "COMPOSIO_API_KEY=<PASTE_HERE>" >> ~/.hermes/.env
chmod 600 ~/.hermes/.env
```

### Step 4 — Scaffold the working directory

```bash
cd ~
mkdir -p social-marketing/photos/{dishes,ambiance,kitchen,exterior,unsorted}
mkdir -p social-marketing/{posts,knowledge-base}
mkdir -p social-marketing/reports/{trend-reports,competitor}
cp ~/restaurant-social-marketing-skill/templates/config.template.json ~/social-marketing/config.json
```

### Step 5 — Fill in `~/social-marketing/config.json` (Installer fields only)

The template already contains `models`, `imageGen.provider`, `analytics`, `timezone`, `posting.schedule`, and `paths`. Do not change those unless the human explicitly asks. You only fill in:

```json
{
  "telegram": {
    "botToken": "<from @BotFather>",
    "chatId":   "<owner's chat id>"
  },
  "platforms": {
    "instagram": { "enabled": true,  "composioAccountId": "ca_…" },
    "tiktok":    { "enabled": true,  "composioAccountId": "ca_…" },
    "facebook":  { "enabled": false, "composioAccountId": "ca_xxxxx" }
  },
  "googleDrive": {
    "enabled": true,
    "folderName": "akira-agent_src",
    "composioAccountId": "ca_gdrive_…"
  }
}
```

For any platform the restaurant is **not** using, leave `enabled: false` and the placeholder `ca_xxxxx` value.

`googleDrive.folderId` is auto-discovered by `setup.js` in Step 6 — do not ask the human for it. If you don't know the folder ID, leave the key absent and set `folderName` to `akira-agent_src` (the convention). The validator will search Drive for that folder and write the ID back to `config.json`.

**If `config.imageGen.model` already reads `google/gemini-2.5-flash-image-preview`, leave it.** Do not change it to `google/gemini-3.1-flash-image-preview` or anything else unless the human explicitly hands you a different model name.

### Step 6 — Run the validator

```bash
set -a && source ~/.hermes/.env && set +a
node ~/restaurant-social-marketing-skill/scripts/setup.js --config ~/social-marketing/config.json
```

Every line must report ✅. If any line shows ❌, read the fix instruction on that line and address it — **without asking the human for restaurant content**.

Common failures:
- Telegram `chatId` not set → have the human send a message to the bot, then `curl https://api.telegram.org/bot<TOKEN>/getUpdates` to read the chat id.
- A platform's `composioAccountId` is `ca_xxxxx` → the human either needs to connect it in Composio (and give you the real `ca_…`), or the platform should be `enabled: false`.
- `config.imageGen.model` not reachable → browse https://openrouter.ai/models, pick an image-generation model that's listed, tell the human, and update `config.imageGen.model` with the model they confirm.

### Step 7 — Start Hermes

```bash
hermes
```

The restaurant owner takes over from here, via Telegram. Your job is done.

---

## One-Sentence Summary

**Install the plumbing. Validate it. Hand off to the owner. Never ask the owner-scope questions.**
