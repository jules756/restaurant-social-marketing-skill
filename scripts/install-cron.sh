#!/bin/bash
# Install marketing cron entries on the VM.
#
# Installs two jobs by default:
#   - daily-report  (10:00 local)    — Instagram analytics + Telegram summary
#   - weekly-research (Mon 09:00)    — Web-search trend report + Telegram
#
# Usage:
#   ./scripts/install-cron.sh                       # install both
#   ./scripts/install-cron.sh daily                 # daily only
#   ./scripts/install-cron.sh weekly                # weekly only
#   ./scripts/install-cron.sh daily "0 9 * * *"     # daily, custom schedule
#   ./scripts/install-cron.sh weekly "0 8 * * 1"    # weekly, custom
#
# Idempotent — each job tagged with its own comment; re-running replaces it.

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG="${HOME}/social-marketing/config.json"
LOG_DIR="${HOME}/social-marketing/reports"
LOG="${LOG_DIR}/cron.log"
NODE_BIN="$(command -v node)"

WHICH="${1:-all}"
CUSTOM_SCHEDULE="${2:-}"

DAILY_DEFAULT="0 10 * * *"
WEEKLY_DEFAULT="0 9 * * 1"

DAILY_TAG="# RESTAURANT-DAILY-REPORT"
WEEKLY_TAG="# RESTAURANT-WEEKLY-RESEARCH"
DAILY_POST_TAG="# RESTAURANT-DAILY-POST"
WEEKLY_REVIEW_TAG="# RESTAURANT-WEEKLY-REVIEW"

if [[ ! -f "$CONFIG" ]]; then
  echo "❌ Config not found at $CONFIG. Run install.sh first." >&2
  exit 1
fi
if [[ -z "$NODE_BIN" ]]; then
  echo "❌ node not found in PATH. Install Node.js v18+ first." >&2
  exit 1
fi

mkdir -p "$LOG_DIR"

install_entry() {
  local schedule="$1"
  local script="$2"
  local tag="$3"

  local line="${schedule} cd ${REPO_DIR} && ${NODE_BIN} ${script} --config ${CONFIG} >> ${LOG} 2>&1 ${tag}"
  local tmp
  tmp=$(mktemp)
  crontab -l 2>/dev/null | grep -v "${tag}" > "$tmp" || true
  echo "$line" >> "$tmp"
  crontab "$tmp"
  rm "$tmp"

  echo "✅ Installed: $line"
}

case "$WHICH" in
  all)
    install_entry "$DAILY_DEFAULT"  "scripts/daily-report.js"     "$DAILY_TAG"
    install_entry "$WEEKLY_DEFAULT" "scripts/weekly-research.js"  "$WEEKLY_TAG"
    install_entry "0 11 * * *" "scripts/daily-post.js" "$DAILY_POST_TAG"
    ;;
  daily)
    install_entry "${CUSTOM_SCHEDULE:-$DAILY_DEFAULT}" "scripts/daily-report.js" "$DAILY_TAG"
    ;;
  weekly)
    install_entry "${CUSTOM_SCHEDULE:-$WEEKLY_DEFAULT}" "scripts/weekly-research.js" "$WEEKLY_TAG"
    ;;
  daily-post)
    install_entry "0 11 * * *" "scripts/daily-post.js" "$DAILY_POST_TAG"
    ;;
  weekly-review)
    install_entry "0 10 * * 1" "scripts/weekly-review.js" "$WEEKLY_REVIEW_TAG"
    ;;
  *)
    echo "Unknown job: $WHICH. Use: all | daily | weekly | daily-post | weekly-review" >&2
    exit 1
    ;;
esac

echo ""
echo "Logs → $LOG"
echo "View installed crontab: crontab -l"
echo "Remove daily:  crontab -l | grep -v '${DAILY_TAG}' | crontab -"
echo "Remove weekly: crontab -l | grep -v '${WEEKLY_TAG}' | crontab -"
