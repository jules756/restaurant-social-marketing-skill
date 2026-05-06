#!/bin/bash
# Marketing-skill pre-start. Runs before the upstream Hermes entrypoint.
#
# Order of operations (each step idempotent — safe to re-run on every boot):
#   1. Scaffold /opt/data/social-marketing/ if it's missing.
#   2. Copy skills into /opt/data/skills/social-media/ so Hermes loads them.
#   3. If config.composio.mcpServerUrl is empty, run setup.js to provision
#      the MCP server (composio.mcp.create + persist URL).
#   4. exec the upstream Hermes entrypoint with the original CMD args so
#      Hermes itself starts normally.
#
# When the operator hasn't filled config.json yet, we sleep so they can
# `docker exec` in and edit, instead of crash-looping.

set -euo pipefail

DATA_ROOT=/opt/data
CONFIG="$DATA_ROOT/social-marketing/config.json"
SKILL_SRC=/opt/hermes/social-marketing-skill
HERMES_SKILLS="$DATA_ROOT/skills/social-media"
HERMES_ENTRYPOINT=/opt/hermes/docker/entrypoint.sh

echo "[marketing-pre-start] $(date -Is) — beginning"

# 1. Scaffold the data dir and seed config from the template if missing.
mkdir -p \
  "$DATA_ROOT/social-marketing/photos/dishes" \
  "$DATA_ROOT/social-marketing/photos/ambiance" \
  "$DATA_ROOT/social-marketing/photos/kitchen" \
  "$DATA_ROOT/social-marketing/photos/exterior" \
  "$DATA_ROOT/social-marketing/photos/unsorted" \
  "$DATA_ROOT/social-marketing/posts" \
  "$DATA_ROOT/social-marketing/knowledge-base" \
  "$DATA_ROOT/social-marketing/reports/trend-reports" \
  "$DATA_ROOT/social-marketing/reports/competitor"

if [ ! -f "$CONFIG" ]; then
  echo "[marketing-pre-start] no config — copying template to $CONFIG"
  cp "$SKILL_SRC/templates/config.template.json" "$CONFIG"
  cat <<EOF
[marketing-pre-start] First boot. Edit $CONFIG to set:
  - telegram.botToken + chatId
  - composio.apiKey + composio.userId
  - which platforms.* are enabled
Then restart the container so setup.js runs.
Sleeping (this container will not crash-loop).
EOF
  exec sleep infinity
fi

# 2. Copy skill packs into HERMES_HOME so Hermes loads them at boot.
# rsync would be ideal but the base image has cp; -a preserves perms.
mkdir -p "$HERMES_SKILLS"
cp -a "$SKILL_SRC/skills/." "$HERMES_SKILLS/" 2>/dev/null || true
if [ -d "$SKILL_SRC/adapted-skills" ]; then
  cp -a "$SKILL_SRC/adapted-skills/." "$HERMES_SKILLS/" 2>/dev/null || true
fi
echo "[marketing-pre-start] skills copied to $HERMES_SKILLS"

# 3. If we don't have an MCP server URL yet, run setup to provision one.
if [ -z "$(jq -r '.composio.mcpServerUrl // empty' "$CONFIG")" ]; then
  echo "[marketing-pre-start] no mcpServerUrl in config — running setup.js"
  if ! node "$SKILL_SRC/scripts/setup.js" --config "$CONFIG"; then
    echo "[marketing-pre-start] setup.js failed. Fix config + auth configs in the Composio dashboard, then restart."
    echo "[marketing-pre-start] Sleeping so the container stays up for inspection."
    exec sleep infinity
  fi
fi

# 4. Install cron jobs (best-effort — never fail boot on this).
if [ -x "$SKILL_SRC/scripts/install-cron.sh" ]; then
  bash "$SKILL_SRC/scripts/install-cron.sh" "$CONFIG" || true
fi

# 5. Hand off to Hermes. Note: tini already wrapped us, so the upstream
# entrypoint runs as a child rather than re-PID-1 — that's fine; their
# script invokes hermes_cli at the end.
echo "[marketing-pre-start] handing off to Hermes entrypoint"
exec "$HERMES_ENTRYPOINT" "$@"
