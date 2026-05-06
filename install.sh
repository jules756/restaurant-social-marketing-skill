#!/bin/bash
# v4 host-side install. Builds the per-agent image and starts a container.
# In-container bootstrap (scaffolding /data, running setup.js, starting
# Hermes) lives in scripts/docker-entrypoint.sh.
#
# Usage:
#   COMPANY=<short-id> [AGENT_NAME=marketing] bash install.sh
#
# Env vars:
#   COMPANY      Required. Short company identifier (e.g. "rodolfino").
#   AGENT_NAME   Defaults to "marketing". Distinguishes per-company agents.
#   REPO_DIR     Where to clone the repo (default $HOME/restaurant-social-marketing-skill).
#   DATA_DIR     Host volume root (default /var/lib/akira/$COMPANY/$AGENT_NAME).
#   COMPOSE_DIR  Where to write the per-agent compose file
#                (default /opt/agents/$COMPANY-$AGENT_NAME).
#   IMAGE_TAG    Image tag to build (default restaurant-marketing:v4-alpha).

set -euo pipefail

REPO_DIR="${REPO_DIR:-$HOME/restaurant-social-marketing-skill}"
AGENT_NAME="${AGENT_NAME:-marketing}"
COMPANY="${COMPANY:?Set COMPANY=<short-id> (e.g. COMPANY=rodolfino)}"
DATA_DIR="${DATA_DIR:-/var/lib/akira/$COMPANY/$AGENT_NAME}"
COMPOSE_DIR="${COMPOSE_DIR:-/opt/agents/$COMPANY-$AGENT_NAME}"
IMAGE_TAG="${IMAGE_TAG:-restaurant-marketing:v4-alpha}"

echo "=== v4 host-side install ==="
echo "Repo:       $REPO_DIR"
echo "Image tag:  $IMAGE_TAG"
echo "Data dir:   $DATA_DIR"
echo "Compose:    $COMPOSE_DIR"
echo

if [ ! -d "$REPO_DIR" ]; then
  echo "Cloning repo into $REPO_DIR …"
  git clone https://github.com/Akira-Agent-Agency/restaurant-social-marketing-skill.git "$REPO_DIR"
fi
cd "$REPO_DIR"

echo "Building image $IMAGE_TAG (first run is slow — node-canvas deps) …"
docker build -t "$IMAGE_TAG" .

mkdir -p "$COMPOSE_DIR" "$DATA_DIR"

# Materialize the per-agent compose file from the template, substituting
# placeholders for this company + agent.
sed \
  -e "s|CHANGE-ME|$COMPANY-$AGENT_NAME|g" \
  -e "s|/var/lib/akira/CHANGE-ME/marketing|$DATA_DIR|g" \
  -e "s|restaurant-marketing:v4-alpha|$IMAGE_TAG|g" \
  "$REPO_DIR/templates/docker-compose.yml" > "$COMPOSE_DIR/docker-compose.yml"

cd "$COMPOSE_DIR"
docker compose up -d

cat <<EOF

Container started: $COMPANY-$AGENT_NAME

First-boot config template was scaffolded inside the container at
  $DATA_DIR/social-marketing/config.json

Next steps:
  1. Edit $DATA_DIR/social-marketing/config.json
     - telegram.botToken + chatId
     - composio.apiKey (project-scoped) + userId (e.g. "$COMPANY-$AGENT_NAME")
     - flip the platforms you use to enabled: true
  2. In the Composio dashboard, connect OAuth for each enabled platform
     and add the OpenAI credential for image generation.
  3. Restart the container so docker-entrypoint.sh runs setup.js:
       docker compose -f $COMPOSE_DIR/docker-compose.yml restart
  4. Tail logs until setup.js reports green:
       docker logs -f marketing-agent-$COMPANY-$AGENT_NAME
EOF
