#!/bin/bash
# One-command Installer setup for a new restaurant client.
#
# Usage:
#   ./install.sh
#
# What it does:
#   1. Copies custom skills + adapted skills into ~/.hermes/skills/social-media/
#      (removes stale v2 directories first).
#   2. Ensures @composio/core SDK is installed globally on the VM.
#   3. Creates social-marketing/ working directory with the config template
#      (default: $HOME/social-marketing). Prompts to wipe any prior client
#      profile data.
#   4. Runs the Phase 0 validator (scripts/setup.js).
#
# Do NOT hand the bot to the restaurant owner until setup.js reports all ✅.
#
# This script does NOT prompt for API keys. All external calls go through
# Composio; the provisioning bundle (projectId, userId, projectApiKey, MCP URL,
# MCP server key) goes into social-marketing/config.json. See INSTALLER.md.

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HERMES_DIR="${HERMES_HOME:-$HOME/.hermes}"
# Hermes organizes skills by category. Restaurant marketing lives under
# social-media/. Override via SKILLS_CATEGORY=<other> if your Hermes uses a
# different layout, or set it to "" to install at the top level.
SKILLS_CATEGORY="${SKILLS_CATEGORY:-social-media}"
SKILLS_DIR="$HERMES_DIR/skills${SKILLS_CATEGORY:+/$SKILLS_CATEGORY}"
# Client working dir — default to an absolute path under $HOME so running
# install.sh from inside the repo doesn't create it inside the repo tree.
CLIENT_DIR="${CLIENT_DIR:-$HOME/social-marketing}"
if [[ "$CLIENT_DIR" != /* ]]; then
  CLIENT_DIR="$HOME/$CLIENT_DIR"
fi

echo "=== Restaurant Social Marketing Installer ==="
echo "Repo:    $REPO_DIR"
echo "Hermes:  $HERMES_DIR"
echo "Skills:  $SKILLS_DIR"
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

# 2. Ensure @composio/core is installed globally
if node -e "require.resolve('@composio/core')" 2>/dev/null; then
  echo "  ✅ @composio/core SDK already installed"
else
  echo "Installing @composio/core globally …"
  if ! npm install -g @composio/core; then
    echo "  ❌ npm install -g @composio/core failed. Install Node.js v18+ and re-run." >&2
    exit 1
  fi
  echo "  ✅ @composio/core installed"
fi

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
  cat <<EOF
Next step — fill in $CLIENT_DIR/config.json with the provisioning bundle from
Jules's dashboard:
  • telegram.{botToken, chatId}                — from @BotFather / getUpdates
  • composio.projectId                         — Composio Project ID for this restaurant
  • composio.userId                            — per-restaurant entity identifier
  • composio.projectApiKey                     — ak_... project-scoped key
  • composio.mcp.{url, serverKey}              — per-client MCP URL + ck_ key
  • platforms.{instagram|tiktok|facebook}.enabled — per-platform booleans
  • googleDrive.enabled                         — true if using Drive photos

Also register the MCP server in ~/.hermes/config.yaml (see INSTALLER.md Step 4).

Then re-run this script to validate:
  ./install.sh
EOF
  exit 0
fi

echo "Running Phase 0 validator …"
echo
if ! node "$REPO_DIR/scripts/setup.js" --config "$CLIENT_DIR/config.json"; then
  echo
  echo "❌ Phase 0 checks failed. Fix the flagged items in $CLIENT_DIR/config.json and re-run this script."
  exit 1
fi

echo
echo "✅ Installer complete. Start Hermes to hand the bot to the restaurant owner:"
echo "   hermes"
