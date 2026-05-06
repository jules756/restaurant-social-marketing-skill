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

# 3. Install into Hermes home (created by hermes-install).
HERMES_HOME="${HERMES_HOME:-$HOME/.hermes}"
if [[ ! -d "$HERMES_HOME" ]]; then
  echo "✗ $HERMES_HOME not found. Install Hermes first via the hermes-install repo."
  exit 1
fi

# 3a. SOUL.md → Hermes persona file.
cp "$SKILL_DIR/templates/SOUL.md" "$HERMES_HOME/SOUL.md"
echo "  ✓ installed SOUL.md → $HERMES_HOME/SOUL.md"

# 3b. Skill folders → $HERMES_HOME/skills/<skill>/ (where Hermes loads from).
mkdir -p "$HERMES_HOME/skills"
SKILL_NAMES=(restaurant-marketing content-preparation marketing-intelligence \
             food-photography-hermes social-media-seo-hermes social-trend-monitor-hermes xurl)
for skill in "${SKILL_NAMES[@]}"; do
  if [[ -d "$SKILL_DIR/$skill" ]]; then
    rm -rf "$HERMES_HOME/skills/$skill"
    cp -r "$SKILL_DIR/$skill" "$HERMES_HOME/skills/$skill"
  fi
done
echo "  ✓ installed ${#SKILL_NAMES[@]} skill folders → $HERMES_HOME/skills/"

# 3c. On-boot hook so Hermes container picks up this skill on every restart.
mkdir -p "$HERMES_HOME/hooks/on-boot"
cat > "$HERMES_HOME/hooks/on-boot/restaurant-social-marketing-skill.sh" <<'HOOK'
#!/bin/bash
# Auto-installed by restaurant-social-marketing-skill/install.sh.
# Runs inside the Hermes container on every boot. Idempotent — only acts
# if the per-agent MCP server URL is missing.
set -euo pipefail
CONFIG="${HOST_HOME:-/host-home}/social-marketing/config.json"
SKILL_REPO="${HOST_HOME:-/host-home}/restaurant-social-marketing-skill"
[[ -f "$CONFIG" ]] || { echo "[restaurant-marketing] no $CONFIG yet — skipping"; exit 0; }
if [[ -z "$(jq -r '.composio.mcpServerUrl // empty' "$CONFIG")" ]]; then
  echo "[restaurant-marketing] provisioning Composio MCP server"
  node "$SKILL_REPO/scripts/setup.js" --config "$CONFIG" || \
    echo "[restaurant-marketing] setup.js failed — fix config.json then restart Hermes"
fi
HOOK
chmod +x "$HERMES_HOME/hooks/on-boot/restaurant-social-marketing-skill.sh"
echo "  ✓ installed on-boot hook"

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

  2. Restart Hermes so it picks up SOUL.md and the skill folders:
       docker restart hermes

     The on-boot hook will auto-run setup.js to provision the Composio
     MCP server (using the keys you put in config.json). Tail the logs
     to confirm:
       docker logs -f hermes

  3. Message your Telegram bot. Hermes will run Phase 1 onboarding (7 questions).

To uninstall the cron jobs (data is kept):
  bash $SKILL_DIR/install.sh --uninstall
EOF
