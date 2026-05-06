#!/usr/bin/env bash
# install.sh — install the Restaurant Social Marketing skill into a running Hermes.
#
# Prereq: Hermes is already installed and Composio MCP is wired up (see hermes-install repo).
#
# What this does (idempotent — safe to re-run):
#   1. Create ~/social-marketing/ directory tree.
#   2. Seed ~/social-marketing/config.json from templates/ (only if it doesn't exist).
#   3. Install npm deps for the scripts.
#   4. Register the cron jobs from templates/crontab.template.
#   5. Print next-steps for filling in config.json (Telegram bot token, Composio API key).
#
# Usage:
#   bash install.sh                # install / refresh
#   bash install.sh --uninstall    # remove cron jobs (keeps ~/social-marketing/ data)

set -euo pipefail

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATA_DIR="$HOME/social-marketing"
CONFIG="$DATA_DIR/config.json"
CRON_TAG="# restaurant-social-marketing-skill"

uninstall_cron() {
  echo "→ Removing cron jobs tagged $CRON_TAG"
  if crontab -l 2>/dev/null | grep -q "$CRON_TAG"; then
    crontab -l 2>/dev/null | sed "/$CRON_TAG/,/$CRON_TAG END/d" | crontab -
    echo "  removed."
  else
    echo "  none found."
  fi
}

if [[ "${1:-}" == "--uninstall" ]]; then
  uninstall_cron
  echo "Done. ~/social-marketing/ data was kept. Delete it manually if you want a full wipe."
  exit 0
fi

echo "→ Installing Restaurant Social Marketing skill from $SKILL_DIR"

# 1. Data dir tree
mkdir -p "$DATA_DIR"/{posts,photos,reports,reports/trend-reports,reports/competitor,knowledge-base,logs}
echo "  ✓ created $DATA_DIR/"

# 2. Seed config.json (idempotent — keeps existing user config)
if [[ ! -f "$CONFIG" ]]; then
  sed "s|{{HOME}}|$HOME|g" "$SKILL_DIR/templates/config.template.json" > "$CONFIG"
  echo "  ✓ seeded $CONFIG (you must fill in telegram + composio keys)"
else
  echo "  ✓ $CONFIG already exists — left untouched"
fi

# 3. SOUL.md (Hermes persona) — copy to ~/.hermes/ if Hermes is using that path
HERMES_HOME="${HERMES_HOME:-$HOME/.hermes}"
if [[ -d "$HERMES_HOME" ]]; then
  cp "$SKILL_DIR/templates/SOUL.md" "$HERMES_HOME/SOUL.md"
  echo "  ✓ installed SOUL.md → $HERMES_HOME/SOUL.md"
else
  echo "  ⚠ $HERMES_HOME not found — skipping SOUL.md install. Set HERMES_HOME and re-run if needed."
fi

# 4. npm deps for the scripts
if command -v npm >/dev/null 2>&1; then
  echo "→ Installing npm deps (this can take a minute)"
  (cd "$SKILL_DIR" && npm install --silent --omit=dev)
  echo "  ✓ deps installed"
else
  echo "  ⚠ npm not found — install Node.js 18+ first"
fi

# 5. Register cron jobs
uninstall_cron
TMP_CRON="$(mktemp)"
trap "rm -f $TMP_CRON" EXIT
crontab -l 2>/dev/null > "$TMP_CRON" || true
{
  echo "$CRON_TAG"
  sed "s|{{HOME}}|$HOME|g; s|{{SKILL_DIR}}|$SKILL_DIR|g" "$SKILL_DIR/templates/crontab.template"
  echo "$CRON_TAG END"
} >> "$TMP_CRON"
crontab "$TMP_CRON"
echo "  ✓ cron jobs registered (run 'crontab -l' to see them)"

# 6. Next steps
cat <<EOF

✅ Skill installed.

Next steps:
  1. Edit $CONFIG and fill in:
     - telegram.botToken   (from @BotFather)
     - composio.apiKey     (your Composio project API key)
     - composio.userId     (e.g. "rodolfino-marketing")
     - platforms.{instagram,tiktok,facebook}.enabled  (true for the ones you'll post to)
     - googleDrive.enabled + folderName  (if syncing photos from Drive)

  2. Run setup to create the per-agent Composio MCP server:
     SOCIAL_MARKETING_CONFIG="$CONFIG" npm run --prefix "$SKILL_DIR" setup

  3. Start (or restart) Hermes. It will load this skill and SOUL.md automatically.

  4. Message your Telegram bot. Hermes will run Phase 1 onboarding (7 questions).

To uninstall the cron jobs (data is kept):
  bash $SKILL_DIR/install.sh --uninstall
EOF
