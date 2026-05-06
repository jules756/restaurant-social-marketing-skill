#!/bin/bash
# Per-agent container entrypoint.
#
# Order of operations:
#   1. If /data/social-marketing/config.json is missing, scaffold the
#      directory layout from the template and stop (operator must edit).
#   2. If config.composio.mcpServerUrl is empty, run setup.js to call
#      composio.mcp.create() and persist the URL.
#   3. Install cron jobs based on config.posting.schedule (best-effort).
#   4. Hand off to Hermes.
#
# Failure mode: when the operator hasn't filled config.json yet, sleep
# instead of crash-looping so they can `docker exec` in and edit.

set -euo pipefail

CONFIG=/data/social-marketing/config.json
DATA_ROOT=/data/social-marketing

if [ ! -f "$CONFIG" ]; then
  echo "First boot: scaffolding $DATA_ROOT and copying config template."
  mkdir -p \
    "$DATA_ROOT/photos/dishes" \
    "$DATA_ROOT/photos/ambiance" \
    "$DATA_ROOT/photos/kitchen" \
    "$DATA_ROOT/photos/exterior" \
    "$DATA_ROOT/photos/unsorted" \
    "$DATA_ROOT/posts" \
    "$DATA_ROOT/knowledge-base" \
    "$DATA_ROOT/reports/trend-reports" \
    "$DATA_ROOT/reports/competitor"
  cp /app/templates/config.template.json "$CONFIG"
  echo "Edit $CONFIG to set Telegram + Composio credentials, then restart the container."
  exec sleep infinity
fi

# Provision the MCP server if it hasn't been done yet.
if [ -z "$(jq -r '.composio.mcpServerUrl // empty' "$CONFIG")" ]; then
  echo "No mcpServerUrl in config; running setup.js."
  node /app/scripts/setup.js --config "$CONFIG"
fi

# Install cron jobs (best-effort — script may not exist or may already
# have run; never fail the container boot on this).
if [ -x /app/scripts/install-cron.sh ]; then
  bash /app/scripts/install-cron.sh "$CONFIG" || true
fi

# Hand off to Hermes. The base image doesn't ship Hermes; operators
# either bake it into a derived image or install it before this point.
# If `hermes` isn't on PATH, sleep so a human can investigate via exec.
if command -v hermes >/dev/null 2>&1; then
  exec hermes
fi
echo "WARNING: 'hermes' is not on PATH inside the container."
echo "         Install it via the host (docker exec or a layered image),"
echo "         then restart. Sleeping to keep the container alive."
exec sleep infinity
