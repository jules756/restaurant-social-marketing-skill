#!/bin/bash
# diagnose-mcp.sh — find the source of MCP tools loaded by Hermes.
#
# Symptom: "Invalid 'tools': array too long. Expected ... 128, but got 280".
# That means 280 tools are being injected into the model context. Our skill's
# setup.js may have produced 0 MCP servers — so they're coming from elsewhere.
#
# This script inspects the running container to find:
#   - Hermes's own config.yaml MCP entries
#   - Bundled skills that register tools
#   - Any other JSON/YAML files in /opt/data referencing MCP server URLs
#
# Usage:
#   AGENT=social-media bash scripts/diagnose-mcp.sh
#   bash scripts/diagnose-mcp.sh   (defaults to AGENT=social-media)

set +e
AGENT="${AGENT:-social-media}"
CONTAINER="hermes-$AGENT"

echo "============ MCP-SOURCE DIAGNOSTIC ($(date -Is)) ============"
echo "container: $CONTAINER"
echo

if ! docker ps --format '{{.Names}}' | grep -q "^$CONTAINER$"; then
  echo "✗ container '$CONTAINER' not running."
  exit 1
fi

echo "─── Hermes config.yaml ─────────────────────────"
docker exec "$CONTAINER" cat /opt/data/config.yaml 2>&1 | grep -E "mcp|composio|tool|server" | head -50 || echo "(no matches or file unreadable)"
echo

echo "─── Files in /opt/data referencing MCP / Composio ─────────"
docker exec "$CONTAINER" sh -c 'cd /opt/data && grep -rlE "mcp_server|mcpServerUrl|composio.dev|/v1/mcp" 2>/dev/null | head -20'
echo

echo "─── Bundled skills (top-level skill folders, count of .yaml/.json each) ─────────"
docker exec "$CONTAINER" sh -c 'cd /opt/data/skills && for d in */; do
  count=$(find "$d" -maxdepth 3 \( -name "*.yaml" -o -name "*.json" \) 2>/dev/null | wc -l)
  echo "  $d  ($count config files)"
done | head -30'
echo

echo "─── native-mcp skill content ───────────────────"
docker exec "$CONTAINER" sh -c 'find /opt/data/skills/mcp -maxdepth 4 -type f 2>/dev/null | head -20'
docker exec "$CONTAINER" sh -c 'ls /opt/data/skills/mcp/native-mcp/ 2>&1 | head -20'
echo

echo "─── Possible MCP servers list files ────────────"
docker exec "$CONTAINER" find /opt/data -maxdepth 6 \( -name "mcp_servers*" -o -name "servers*.json" -o -name "*mcp*config*" \) -type f 2>&1 | head
echo

echo "─── Process-level scan: what .yaml / .json does Hermes process actually open? ─────────"
docker exec "$CONTAINER" sh -c 'pid=$(pgrep -f "hermes gateway" | head -1); if [ -n "$pid" ]; then ls -la /proc/$pid/cwd 2>&1 | head -3; lsof -p $pid 2>/dev/null | grep -E "\.yaml|\.json|composio" | head -20; fi' 2>&1 | head -25
echo

echo "─── Last 30 lines of container logs ────────────"
docker logs "$CONTAINER" --tail 30 2>&1
echo

echo "============ END ============"
echo
echo "If the output above shows:"
echo "  - MCP server URLs in /opt/data/config.yaml → strip them, restart, retry."
echo "  - native-mcp skill registering tools → likely the source. We disable/restrict it."
echo "  - 80+ bundled skills each adding tools → Hermes auto-loads everything; need to"
echo "    set a session-tool allowlist in config.yaml or via env var."
