#!/bin/bash
# Install the daily-report cron entry on the VM.
#
# Usage:
#   ./scripts/install-cron.sh                    # 10:00 local time (default)
#   ./scripts/install-cron.sh "0 9 * * *"        # custom cron schedule
#
# Idempotent — replaces any existing entry tagged with the same comment.

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG="${HOME}/social-marketing/config.json"
LOG_DIR="${HOME}/social-marketing/reports"
LOG="${LOG_DIR}/cron.log"
NODE_BIN="$(command -v node)"
SCHEDULE="${1:-0 10 * * *}"
TAG="# RESTAURANT-DAILY-REPORT"

if [[ ! -f "$CONFIG" ]]; then
  echo "❌ Config not found at $CONFIG. Run install.sh first." >&2
  exit 1
fi
if [[ -z "$NODE_BIN" ]]; then
  echo "❌ node not found in PATH. Install Node.js v18+ first." >&2
  exit 1
fi

mkdir -p "$LOG_DIR"

CRON_LINE="${SCHEDULE} cd ${REPO_DIR} && ${NODE_BIN} scripts/daily-report.js --config ${CONFIG} >> ${LOG} 2>&1 ${TAG}"

TMP=$(mktemp)
crontab -l 2>/dev/null | grep -v "${TAG}" > "$TMP" || true
echo "$CRON_LINE" >> "$TMP"
crontab "$TMP"
rm "$TMP"

echo "✅ Installed cron entry:"
echo "   $CRON_LINE"
echo ""
echo "Logs → $LOG"
echo "View installed crontab: crontab -l"
echo "Remove this entry:      crontab -l | grep -v '${TAG}' | crontab -"
