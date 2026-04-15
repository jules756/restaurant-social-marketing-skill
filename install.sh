#!/bin/bash
# One-command Installer setup for a new restaurant client.
#
# Usage:
#   ./install.sh
#
# What it does:
#   1. Copies custom skills + adapted skills into ~/.hermes/skills/
#   2. Prompts for OpenRouter + Composio keys, writes to ~/.hermes/.env
#      (appends if the file exists — never overwrites existing keys)
#   3. Creates social-marketing/ working directory with the config template
#   4. Runs the Phase 0 validator (scripts/setup.js)
#
# Do NOT hand the bot to the restaurant owner until setup.js reports all ✅.

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HERMES_DIR="${HERMES_HOME:-$HOME/.hermes}"
ENV_FILE="$HERMES_DIR/.env"
# Hermes organizes skills by category. Restaurant marketing lives under
# social-media/. Override via SKILLS_CATEGORY=<other> if your Hermes uses a
# different layout, or set it to "" to install at the top level.
SKILLS_CATEGORY="${SKILLS_CATEGORY:-social-media}"
SKILLS_DIR="$HERMES_DIR/skills${SKILLS_CATEGORY:+/$SKILLS_CATEGORY}"
CLIENT_DIR="${CLIENT_DIR:-social-marketing}"

echo "=== Restaurant Social Marketing Installer ==="
echo "Repo:    $REPO_DIR"
echo "Hermes:  $HERMES_DIR"
echo "Client:  $CLIENT_DIR"
echo

# 1. Copy skills — remove any prior v2 install in the same category first
mkdir -p "$SKILLS_DIR"
for stale in restaurant-social-marketing restaurant-social-marketing-setup-verification; do
  if [[ -d "$SKILLS_DIR/$stale" ]]; then
    echo "Removing stale v2 skill: $SKILLS_DIR/$stale"
    rm -rf "$SKILLS_DIR/$stale"
  fi
done
echo "Copying v3 skills to $SKILLS_DIR …"
cp -r "$REPO_DIR/skills/"* "$SKILLS_DIR/"
cp -r "$REPO_DIR/adapted-skills/"* "$SKILLS_DIR/"
echo "  ✅ skills copied"

# 2. API keys
mkdir -p "$HERMES_DIR"
touch "$ENV_FILE"
chmod 600 "$ENV_FILE"

ensure_key() {
  local var="$1"
  local prompt="$2"
  if grep -qE "^${var}=" "$ENV_FILE"; then
    echo "  ✅ $var already set in $ENV_FILE"
    return
  fi
  read -r -s -p "$prompt: " value
  echo
  if [[ -z "$value" ]]; then
    echo "  ❌ $var not provided — aborting." >&2
    exit 1
  fi
  echo "${var}=${value}" >> "$ENV_FILE"
  echo "  ✅ $var written to $ENV_FILE"
}

ensure_key OPENROUTER_API_KEY "OpenRouter API key (sk-or-...)"
ensure_key COMPOSIO_API_KEY   "Composio API key"

# 3. Client working dir
FRESH_CONFIG=0
if [[ -d "$CLIENT_DIR" ]]; then
  echo "  ℹ  $CLIENT_DIR already exists."
  # Prior-client-data hygiene: a restaurant-profile.json from a previous client
  # must never leak into a new install. Prompt before wiping.
  if [[ -f "$CLIENT_DIR/restaurant-profile.json" ]]; then
    echo
    read -r -p "  Prior restaurant-profile.json found. This is a new client install — wipe client data (profile + knowledge-base)? [y/N] " wipe
    if [[ "$wipe" == "y" || "$wipe" == "Y" ]]; then
      rm -f "$CLIENT_DIR/restaurant-profile.json"
      rm -rf "$CLIENT_DIR/knowledge-base"
      mkdir -p "$CLIENT_DIR/knowledge-base"
      echo "  ✅ Prior client data wiped."
    else
      echo "  ℹ  Keeping prior client data. (If you're installing for a new restaurant, re-run and choose y.)"
    fi
  fi
else
  echo "Creating $CLIENT_DIR …"
  mkdir -p "$CLIENT_DIR"/{photos/{dishes,ambiance,kitchen,exterior,unsorted},posts,reports/trend-reports,reports/competitor,knowledge-base}
  cp "$REPO_DIR/templates/config.template.json" "$CLIENT_DIR/config.json"
  echo "  ✅ $CLIENT_DIR/ created"
  echo "  ✅ $CLIENT_DIR/config.json copied from template"
  FRESH_CONFIG=1
fi

# 4. Validator
echo
if [[ "$FRESH_CONFIG" == "1" ]]; then
  echo "Next step — fill in $CLIENT_DIR/config.json:"
  echo "  • restaurant.{name, cuisine, location, bookingUrl}"
  echo "  • platforms.{instagram|tiktok|facebook}.enabled + composioAccountId"
  echo "  • googleDrive.{enabled, folderId, composioAccountId}"
  echo
  echo "Then re-run this script to validate:  ./install.sh"
  exit 0
fi

echo "Running Phase 0 validator …"
echo
set -a
source "$ENV_FILE"
set +a
if ! node "$REPO_DIR/scripts/setup.js" --config "$CLIENT_DIR/config.json"; then
  echo
  echo "❌ Phase 0 checks failed. Fix the flagged items in $CLIENT_DIR/config.json and re-run this script."
  exit 1
fi

echo
echo "✅ Installer complete. Start Hermes to hand the bot to the restaurant owner:"
echo "   hermes"
