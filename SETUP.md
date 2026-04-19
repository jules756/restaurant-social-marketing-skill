# Restaurant Social Media Marketing - Setup & Usage

## Current System State

The "Notary Book" system is now built with autonomous daily posting, learning, and natural owner interaction.

### Features
- Daily autonomous posting at 11:00
- Self-improvement based on performance
- Weekly strategy review
- Natural language promotion detection
- Preference for real Drive photos (img2img)
- Improved caption + hashtag generation

---

## Setup

### 1. Fill in credentials

Edit `~/social-marketing/config.json`:

```json
{
  "composio": {
    "apiKey": "your-composio-api-key",
    "userId": "your-composio-user-id"
  },
  "platforms": {
    "instagram": {
      "enabled": true,
      "igUserId": "17841xxxxxxxxxxxx"
    }
  },
  "telegram": {
    "botToken": "your-bot-token",
    "chatId": "your-chat-id"
  }
}
```

### 2. Install crons

```bash
cd ~/restaurant-social-marketing-skill
./scripts/install-cron.sh daily-post weekly-review
```

### 3. Onboard the restaurant owner

Start Hermes and let the owner talk to the bot. It will ask 8 questions and then automatically run competitor research.

### 4. Test

```bash
node scripts/daily-post.js --config ~/social-marketing/config.json --dry-run
```

---

## How to Use

**Owner commands:**
- `generate post` — create and post content
- `generate pool` — create 5 days of content
- Talk naturally about promotions, new dishes, events
- `check analytics`, `research competitors`, `show trends`

**The agent will:**
- Learn from performance over time
- Use real photos from Drive when available
- Generate captions and hashtags
- Notify you after every post

---

## Monitoring

- Logs: `~/social-marketing/reports/cron.log`
- Posts: `~/social-marketing/posts/`
- Performance: `~/social-marketing/hook-performance.json`
- Strategy: `~/social-marketing/strategy.json`

---

**Note:** The system is in a stable MVP state. Real Composio and Instagram credentials are required for live posting.

Last updated: 2026-04-19