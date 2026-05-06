#!/usr/bin/env bash
# install.sh — install the Restaurant Social Marketing skill into a
# specific Hermes agent on this VM.
#
# Prereq: hermes-install repo's new-agent.sh has already spawned the
# target agent (creates ~/.hermes-<agent>/ and ~/agents/<agent>/).
#
# What this does (idempotent — safe to re-run):
#   1. Validate target agent exists.
#   2. Create ~/agents/<agent>/social-marketing/ tree (skill data dir).
#   3. Seed config.json from templates/ (only if it doesn't exist).
#   4. Install SOUL.md + skill folders into ~/.hermes-<agent>/.
#   5. Register an on-boot hook so the agent provisions the Composio MCP
#      servers on next restart.
#   6. Install npm deps.
#   7. Register the cron jobs.
#
# Usage:
#   AGENT=<agent-name> bash install.sh           # install / refresh
#   AGENT=<agent-name> bash install.sh --uninstall  # remove cron + on-boot hook (data kept)

set -euo pipefail

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ─── Validate AGENT ────────────────────────────────────────────────────
AGENT="${AGENT:-}"
if [[ -z "$AGENT" ]]; then
  echo "✗ AGENT env var is required."
  echo "  Example: AGENT=rodolfino bash install.sh"
  echo "  Spawn an agent first with: bash ~/hermes-install/new-agent.sh <agent-name>"
  exit 1
fi
if ! [[ "$AGENT" =~ ^[a-z0-9][a-z0-9_-]*$ ]]; then
  echo "✗ Invalid AGENT name '$AGENT' (lowercase letters, digits, dashes, underscores; must start with letter/digit)."
  exit 1
fi

HERMES_HOME="$HOME/.hermes-$AGENT"
AGENT_HOME="$HOME/agents/$AGENT"
SKILL_DATA_DIR="$AGENT_HOME/social-marketing"
CONFIG="$SKILL_DATA_DIR/config.json"
CRON_TAG="# restaurant-social-marketing-skill@$AGENT"

uninstall_cron_and_hook() {
  echo "→ Removing cron jobs tagged '$CRON_TAG'"
  if crontab -l 2>/dev/null | grep -q "$CRON_TAG"; then
    crontab -l 2>/dev/null | sed "/$CRON_TAG\$/,/$CRON_TAG END\$/d" | crontab -
    echo "  removed."
  else
    echo "  none found."
  fi
  echo "→ Removing on-boot hook"
  rm -f "$HERMES_HOME/hooks/on-boot/restaurant-social-marketing-skill.sh"
}

if [[ "${1:-}" == "--uninstall" ]]; then
  uninstall_cron_and_hook
  echo "Done. $SKILL_DATA_DIR is kept; delete manually for full wipe."
  exit 0
fi

if [[ ! -d "$HERMES_HOME" ]]; then
  echo "✗ $HERMES_HOME not found."
  echo "  Spawn this agent first: bash ~/hermes-install/new-agent.sh $AGENT"
  exit 1
fi

echo "→ Installing Restaurant Social Marketing skill"
echo "  agent:        $AGENT"
echo "  Hermes home:  $HERMES_HOME"
echo "  skill data:   $SKILL_DATA_DIR"

# 1. Skill data dir tree
mkdir -p "$SKILL_DATA_DIR"/{posts,photos,reports,reports/trend-reports,reports/competitor,knowledge-base,logs}
echo "  ✓ created $SKILL_DATA_DIR/"

# 2. Seed config.json (idempotent — keeps existing user edits)
if [[ ! -f "$CONFIG" ]]; then
  sed "s|{{AGENT_HOME}}|$AGENT_HOME|g" "$SKILL_DIR/templates/config.template.json" > "$CONFIG"
  echo "  ✓ seeded $CONFIG (you must fill in composio keys)"
else
  echo "  ✓ $CONFIG already exists — left untouched"
fi

# 3. SOUL.md → Hermes persona for this agent.
cp "$SKILL_DIR/templates/SOUL.md" "$HERMES_HOME/SOUL.md"
echo "  ✓ installed SOUL.md → $HERMES_HOME/SOUL.md"

# 4. Skill folders → $HERMES_HOME/skills/<skill>/.
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

# 5. On-boot hook. Runs inside the Hermes container; provisions MCP
#    servers when the per-userId map in config is still empty.
mkdir -p "$HERMES_HOME/hooks/on-boot"
cat > "$HERMES_HOME/hooks/on-boot/restaurant-social-marketing-skill.sh" <<'HOOK'
#!/bin/bash
# Auto-installed by restaurant-social-marketing-skill/install.sh.
# Runs inside the Hermes container on every boot. Idempotent.
set -euo pipefail
AGENT_HOME="${HOST_AGENT_HOME:-/host-agent-home}"
CONFIG="$AGENT_HOME/social-marketing/config.json"
SKILL_REPO="$AGENT_HOME/restaurant-social-marketing-skill"

[[ -f "$CONFIG" ]] || { echo "[restaurant-marketing] no $CONFIG yet — skipping"; exit 0; }

# If mcpServerUrls is empty (no userIds provisioned yet), run setup.
URLS_COUNT="$(jq -r '.composio.mcpServerUrls | length' "$CONFIG" 2>/dev/null || echo 0)"
if [[ "$URLS_COUNT" == "0" ]]; then
  if [[ ! -d "$SKILL_REPO" ]]; then
    echo "[restaurant-marketing] skill repo not found at $SKILL_REPO — host-side install incomplete"
    exit 0
  fi
  echo "[restaurant-marketing] provisioning Composio MCP servers"
  node "$SKILL_REPO/scripts/setup.js" --config "$CONFIG" || \
    echo "[restaurant-marketing] setup.js failed — fix config.json (composio.apiKey, defaultUserId, userIdOverrides) then restart"
fi
HOOK
chmod +x "$HERMES_HOME/hooks/on-boot/restaurant-social-marketing-skill.sh"
echo "  ✓ installed on-boot hook"

# 6. npm deps
if command -v npm >/dev/null 2>&1; then
  echo "→ Installing npm deps (this can take a minute)"
  (cd "$SKILL_DIR" && npm install --silent --omit=dev)
  echo "  ✓ deps installed"
else
  echo "  ⚠ npm not found — install Node.js 18+ first"
fi

# 7. Symlink the skill repo into ~/agents/<agent>/ so the in-container
#    on-boot hook can find it via $HOST_AGENT_HOME/restaurant-social-marketing-skill.
if [[ ! -e "$AGENT_HOME/restaurant-social-marketing-skill" ]]; then
  ln -s "$SKILL_DIR" "$AGENT_HOME/restaurant-social-marketing-skill"
  echo "  ✓ symlinked skill repo into $AGENT_HOME/"
fi

# 8. Register cron jobs (substitute AGENT_HOME + SKILL_DIR placeholders)
uninstall_cron_and_hook >/dev/null 2>&1 || true
TMP_CRON="$(mktemp)"
trap "rm -f $TMP_CRON" EXIT
crontab -l 2>/dev/null > "$TMP_CRON" || true
{
  echo "$CRON_TAG"
  sed "s|{{AGENT_HOME}}|$AGENT_HOME|g; s|{{SKILL_DIR}}|$SKILL_DIR|g" "$SKILL_DIR/templates/crontab.template"
  echo "$CRON_TAG END"
} >> "$TMP_CRON"
crontab "$TMP_CRON"
echo "  ✓ cron jobs registered for agent '$AGENT' (crontab -l to see them)"

cat <<EOF

✅ Skill installed for agent '$AGENT'.

Next steps:
  1. Edit $CONFIG and fill in:
     - composio.apiKey         (your Composio project API key)
     - composio.defaultUserId  (e.g. "$AGENT-marketing")
     - composio.userIdOverrides (only if Composio splits a toolkit onto its
       own userId, e.g. "openai": "$AGENT-openai")
     - platforms.{instagram,facebook,tiktok}.enabled
     - platforms.facebook.pageId  (numeric Facebook Page ID, if FB enabled)
     - platforms.tiktok.verifiedDomain  (HTTPS, if TikTok enabled)
     - googleDrive.enabled + folderName  (if syncing photos from Drive)

  2. In the Composio dashboard, connect the OAuth toolkits for each userId
     (e.g. for defaultUserId connect Instagram/Facebook/Drive/Telegram;
     if you have an "openai" override, connect OpenAI under that userId).

  3. Restart this agent's Hermes container so it picks up SOUL.md + skills:
       docker restart hermes-$AGENT

     The on-boot hook will auto-run setup.js to provision per-userId MCP
     servers. Tail logs to verify:
       docker logs -f hermes-$AGENT

  4. Message this agent's Telegram bot (token configured inside Hermes via
     'docker exec -it hermes-$AGENT hermes setup'). Hermes will run Phase 1
     onboarding (7 questions).

To uninstall the cron jobs + on-boot hook (data kept):
  AGENT=$AGENT bash $SKILL_DIR/install.sh --uninstall
EOF
