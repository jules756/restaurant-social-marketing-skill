#!/bin/bash
# wire-hermes-mcp.sh — write the Composio MCP server entry into Hermes's
# config.yaml so Hermes itself can call Composio tools during a Telegram
# conversation. Without this, only the cron scripts can talk to Composio
# and Hermes falls back to its in-process image gen for any "generate post"
# request — bypassing our pipeline entirely.
#
# This script runs INSIDE the Hermes container. It's invoked automatically
# by scripts/setup.js after MCP server provisioning. It can also be run
# manually for diagnostics.
#
# Idempotent: replaces an existing `composio_restaurant` entry; appends if
# missing. Strips `include_composio_helper_actions=true` from URLs (that
# query param adds ~100 helper tools and trips Hermes's tool-array limit).
#
# Usage (inside container):
#   bash /host-agent-home/scripts/wire-hermes-mcp.sh /host-agent-home/social-marketing/config.json
#
# Run from host:
#   docker exec hermes-<agent> bash /host-agent-home/scripts/wire-hermes-mcp.sh \
#       /host-agent-home/social-marketing/config.json

set -euo pipefail

CONFIG_JSON="${1:-/host-agent-home/social-marketing/config.json}"
HERMES_CONFIG_YAML="/opt/data/config.yaml"

if [[ ! -f "$CONFIG_JSON" ]]; then
  echo "✗ $CONFIG_JSON not found"
  exit 1
fi
if [[ ! -f "$HERMES_CONFIG_YAML" ]]; then
  echo "✗ $HERMES_CONFIG_YAML not found — is this running inside the Hermes container?"
  exit 1
fi

# Read first MCP server URL from config.json. Today there's only one
# (defaultUserId); strip the helper-actions param.
URL=$(jq -r '.composio.mcpServerUrls | to_entries | .[0].value // ""' "$CONFIG_JSON")
if [[ -z "$URL" || "$URL" == "null" ]]; then
  echo "✗ no MCP server URL in $CONFIG_JSON. Run setup.js first."
  exit 1
fi
URL_CLEAN=$(echo "$URL" | sed 's/[?&]include_composio_helper_actions=true//')

# Remove any existing composio_restaurant block (8-line range starting at the marker).
# The block format is:
#   mcp_servers:
#     composio_restaurant:
#       url: "..."
#       transport: streamable_http
#
# We strip from `mcp_servers:` (or just the `composio_restaurant:` if other
# servers are listed alongside) through the next non-indented line.
TMP=$(mktemp)
awk '
  /^mcp_servers:/ { in_block = 1; next }
  in_block && /^[a-zA-Z]/ { in_block = 0 }
  !in_block { print }
' "$HERMES_CONFIG_YAML" > "$TMP"

# Append our entry. Tool Router URLs require auth — read the API key from
# config.json so Hermes can authenticate. Without this header Hermes gets
# a 401 on every connect and the server shows as "failed" at boot.
API_KEY=$(jq -r '.composio.apiKey // ""' "$CONFIG_JSON")
if [[ -z "$API_KEY" || "$API_KEY" == "null" ]]; then
  echo "✗ no composio.apiKey in $CONFIG_JSON. Hermes won't be able to auth."
  exit 1
fi
cat >> "$TMP" <<EOF

mcp_servers:
  composio_restaurant:
    url: "$URL_CLEAN"
    transport: streamable_http
    headers:
      x-api-key: "$API_KEY"
EOF

# Atomic replace.
mv "$TMP" "$HERMES_CONFIG_YAML"
echo "✓ wired Composio MCP into Hermes config.yaml"
echo "  url: ${URL_CLEAN:0:60}…"
echo "  helper_actions stripped: $([[ "$URL" != "$URL_CLEAN" ]] && echo yes || echo no)"
echo "  next: docker restart this container so Hermes picks it up"
