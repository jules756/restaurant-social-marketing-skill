#!/bin/bash
# v4 host-side install. Builds the per-agent image and starts a container.
# In-container bootstrap (scaffolding /opt/data, running setup.js, then
# starting Hermes) lives in scripts/docker-entrypoint.sh.
#
# Usage:
#   COMPANY=<short-id> [AGENT_NAME=marketing] bash install.sh
#
# Env vars:
#   COMPANY      Required. Short company identifier (e.g. "rodolfino").
#   AGENT_NAME   Defaults to "marketing". Distinguishes per-company agents.
#   REPO_DIR     Where to clone the repo (default $HOME/restaurant-social-marketing-skill).
#   DATA_DIR     Host volume root mounted to /opt/data.
#                Default $HOME/.hermes-agent-<company>-<agent> to match the
#                existing nousresearch/hermes-agent convention on the VM.
#   COMPOSE_DIR  Where to write the per-agent compose file
#                (default $HOME/agents/<company>-<agent>).
#   IMAGE_TAG    Image tag to build (default restaurant-marketing:v4-alpha).
#   REPO_URL     Override the clone URL (useful for branches: append #branch
#                via the existing GIT_BRANCH env var instead).
#   GIT_BRANCH   Branch to clone (default v4-mcp-rework while v4 is unmerged).

set -euo pipefail

REPO_DIR="${REPO_DIR:-$HOME/restaurant-social-marketing-skill}"
AGENT_NAME="${AGENT_NAME:-marketing}"
COMPANY="${COMPANY:?Set COMPANY=<short-id> (e.g. COMPANY=rodolfino)}"
DATA_DIR="${DATA_DIR:-$HOME/.hermes-agent-$COMPANY-$AGENT_NAME}"
COMPOSE_DIR="${COMPOSE_DIR:-$HOME/agents/$COMPANY-$AGENT_NAME}"
IMAGE_TAG="${IMAGE_TAG:-restaurant-marketing:v4-alpha}"
REPO_URL="${REPO_URL:-https://github.com/Akira-Agent-Agency/restaurant-social-marketing-skill.git}"
GIT_BRANCH="${GIT_BRANCH:-v4-mcp-rework}"
CONTAINER_NAME="marketing-agent-$COMPANY-$AGENT_NAME"

echo "=== v4 host-side install ==="
echo "Repo:       $REPO_DIR (branch $GIT_BRANCH)"
echo "Image tag:  $IMAGE_TAG"
echo "Data dir:   $DATA_DIR"
echo "Compose:    $COMPOSE_DIR"
echo "Container:  $CONTAINER_NAME"
echo

if [ ! -d "$REPO_DIR" ]; then
  echo "Cloning repo into $REPO_DIR …"
  git clone --branch "$GIT_BRANCH" "$REPO_URL" "$REPO_DIR"
else
  echo "Repo already present at $REPO_DIR — pulling latest on $GIT_BRANCH …"
  (cd "$REPO_DIR" && git fetch origin "$GIT_BRANCH" && git checkout "$GIT_BRANCH" && git pull --ff-only origin "$GIT_BRANCH")
fi
cd "$REPO_DIR"

echo "Building image $IMAGE_TAG (first run pulls the Hermes base + apt deps; ~5–10 min) …"
docker build -t "$IMAGE_TAG" .

mkdir -p "$COMPOSE_DIR" "$DATA_DIR"

# Materialize the per-agent compose file from the template, substituting
# placeholders for this agent.
sed \
  -e "s|CHANGE-ME|$COMPANY-$AGENT_NAME|g" \
  -e "s|HOST_DATA_DIR|$DATA_DIR|g" \
  -e "s|restaurant-marketing:v4-alpha|$IMAGE_TAG|g" \
  "$REPO_DIR/templates/docker-compose.yml" > "$COMPOSE_DIR/docker-compose.yml"

cd "$COMPOSE_DIR"
docker compose up -d

cat <<EOF

Container started: $CONTAINER_NAME

First-boot has scaffolded $DATA_DIR/social-marketing/ and copied a
config template. Edit it before the container can do anything useful:

  $DATA_DIR/social-marketing/config.json

Fields to fill:
  - telegram.botToken + chatId
  - composio.apiKey (project-scoped) + userId (e.g. "$COMPANY-$AGENT_NAME")
  - flip the platforms you use to enabled: true

Then in the Composio dashboard (https://app.composio.dev), under your
project: connect OAuth for each enabled platform AND create an Auth
Config for "openai" (gpt-image-2 needs it). Optionally connect
"openrouter" if you want weekly trend research.

Once that's done, restart the container so docker-entrypoint.sh runs
setup.js to provision the MCP server:

  docker compose -f $COMPOSE_DIR/docker-compose.yml restart

Then tail logs until setup.js reports all checks green:

  docker logs -f $CONTAINER_NAME
EOF
