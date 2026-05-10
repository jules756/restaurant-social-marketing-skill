#!/usr/bin/env bash
# install.sh — install the Restaurant Social Marketing skill into a
# specific Hermes agent on this VM.
#
# Prereq: hermes-install repo's new-agent.sh has already spawned the
# target agent (creates ~/.hermes-<agent>/ and ~/agents/<agent>/).
#
# What this does (idempotent — safe to re-run):
#   1. Validate target agent exists.
#   2. Create ~/agents/<agent>/social-marketing/ tree (skill data dir).
#   3. Seed config.json from templates/ (only if it doesn't exist).
#   4. Install SOUL.md + skill folders into ~/.hermes-<agent>/.
#   5. Register an on-boot hook so the agent provisions the Composio MCP
#      servers on next restart.
#   6. Install npm deps.
#   7. Register the cron jobs.
#
# Usage:
#   AGENT=<agent-name> bash install.sh           # install / refresh
#   AGENT=<agent-name> bash install.sh --uninstall  # remove cron + on-boot hook (data kept)

set -euo pipefail

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ─── Validate AGENT ────────────────────────────────────────────────────
AGENT="${AGENT:-}"
if [[ -z "$AGENT" ]]; then
  echo "✗ AGENT env var is required."
  echo "  Example: AGENT=rodolfino bash install.sh"
  echo "  Spawn an agent first with: bash ~/hermes-install/new-agent.sh <agent-name>"
  exit 1
fi
if ! [[ "$AGENT" =~ ^[a-z0-9][a-z0-9_-]*$ ]]; then
  echo "✗ Invalid AGENT name '$AGENT' (lowercase letters, digits, dashes, underscores; must start with letter/digit)."
  exit 1
fi

HERMES_HOME="$HOME/.hermes-$AGENT"
AGENT_HOME="$HOME/agents/$AGENT"
SKILL_DATA_DIR="$AGENT_HOME/social-marketing"
CONFIG="$SKILL_DATA_DIR/config.json"
CRON_TAG="# restaurant-social-marketing-skill@$AGENT"

# Remove just the cron block for this agent. Used both during --uninstall
# and during install (idempotent cron — clears the old block before
# re-writing). MUST NOT touch the on-boot hook.
remove_cron_block() {
  echo "→ Removing cron jobs tagged '$CRON_TAG'"
  if crontab -l 2>/dev/null | grep -q "$CRON_TAG"; then
    crontab -l 2>/dev/null | sed "/$CRON_TAG\$/,/$CRON_TAG END\$/d" | crontab -
    echo "  removed."
  else
    echo "  none found."
  fi
}

# Remove the on-boot hook. ONLY called during --uninstall, NEVER during
# fresh install (we just wrote the hook in step 5; deleting it here would
# break MCP provisioning on next container restart).
remove_on_boot_hook() {
  echo "→ Removing on-boot hook"
  rm -f "$HERMES_HOME/hooks/on-boot/restaurant-social-marketing-skill.sh"
}

if [[ "${1:-}" == "--uninstall" ]]; then
  remove_cron_block
  remove_on_boot_hook
  echo "Done. $SKILL_DATA_DIR is kept; delete manually for full wipe."
  exit 0
fi

# ─── --diagnose: print install state, no changes ──────────────────────
if [[ "${1:-}" == "--diagnose" ]]; then
  HOOK_PATH="$HERMES_HOME/hooks/on-boot/restaurant-social-marketing-skill.sh"
  echo "============ DIAGNOSTIC ($(date -Is)) ============"
  echo "agent:           $AGENT"
  echo "skill repo:      $SKILL_DIR"
  echo "Hermes home:     $HERMES_HOME"
  echo "Agent home:      $AGENT_HOME"
  echo "Config:          $CONFIG"
  echo
  echo "─── Skill repo ─────────────────────────────────"
  ( cd "$SKILL_DIR" && git log --oneline -1 ) 2>&1
  echo
  echo "─── Hermes home permissions ────────────────────"
  if [[ -d "$HERMES_HOME" ]]; then
    stat -c '%U:%G %a %n' "$HERMES_HOME" 2>/dev/null || echo "(stat not available — try ls -la)"
    if [[ -r "$HERMES_HOME" ]]; then
      echo "  contents:"; ls -1 "$HERMES_HOME" 2>&1 | head -20
    else
      echo "  ✗ NOT readable by $(id -un) — needs: sudo chown -R \"\$(id -u):\$(id -g)\" $HERMES_HOME"
    fi
  else
    echo "✗ $HERMES_HOME does not exist"
  fi
  echo
  echo "─── On-boot hook ───────────────────────────────"
  if [[ -f "$HOOK_PATH" ]]; then
    echo "✓ present: $HOOK_PATH ($(wc -c < "$HOOK_PATH" 2>/dev/null || echo "?") bytes)"
    head -5 "$HOOK_PATH" 2>/dev/null | sed 's/^/    /'
  elif [[ -e "$HOOK_PATH" ]]; then
    echo "✗ exists but not a regular file: $HOOK_PATH"
  else
    echo "✗ MISSING: $HOOK_PATH"
  fi
  echo
  echo "─── Skill folders in Hermes home ───────────────"
  if [[ -r "$HERMES_HOME/skills" ]]; then
    for s in restaurant-marketing content-preparation marketing-intelligence \
             food-photography-hermes social-media-seo-hermes social-trend-monitor-hermes xurl; do
      [[ -d "$HERMES_HOME/skills/$s" ]] && echo "  ✓ $s" || echo "  ✗ $s MISSING"
    done
  else
    echo "  ✗ $HERMES_HOME/skills not readable"
  fi
  echo
  echo "─── SOUL.md ────────────────────────────────────"
  [[ -f "$HERMES_HOME/SOUL.md" ]] && echo "✓ present ($(wc -c < "$HERMES_HOME/SOUL.md") bytes)" || echo "✗ MISSING"
  echo
  echo "─── Agent home (data dir + scripts) ────────────"
  if [[ -d "$AGENT_HOME" ]]; then
    [[ -d "$AGENT_HOME/scripts" ]] && echo "✓ scripts/ present ($(ls "$AGENT_HOME/scripts" 2>/dev/null | wc -l) files)" || echo "✗ scripts/ MISSING — install Phase B (Option B copy) didn't run"
    [[ -d "$AGENT_HOME/node_modules" ]] && echo "✓ node_modules/ present ($(ls "$AGENT_HOME/node_modules" 2>/dev/null | wc -l) packages)" || echo "✗ node_modules/ MISSING — npm install didn't run"
    [[ -f "$AGENT_HOME/package.json" ]] && echo "✓ package.json present" || echo "✗ package.json MISSING"
  else
    echo "✗ $AGENT_HOME does not exist"
  fi
  echo
  echo "─── Config.json ────────────────────────────────"
  if [[ -f "$CONFIG" ]]; then
    echo "✓ present"
    if command -v jq >/dev/null 2>&1; then
      jq '.composio | { apiKey: (.apiKey | if . == "" then "EMPTY" else "SET (\(. | length) chars)" end), defaultUserId, userIdOverrides, mcpServerUrls: (.mcpServerUrls | length), mcpServerIds: (.mcpServerIds | length) }' "$CONFIG"
      echo "  platforms enabled:"
      jq -r '.platforms | to_entries[] | select(.value.enabled) | "    ✓ \(.key)"' "$CONFIG"
    else
      echo "  (install jq for full diagnosis: sudo apt-get install -y jq)"
    fi
  else
    echo "✗ MISSING: $CONFIG"
  fi
  echo
  echo "─── Cron block ─────────────────────────────────"
  if crontab -l 2>/dev/null | grep -q "$CRON_TAG"; then
    echo "✓ cron block present:"
    crontab -l 2>/dev/null | grep -A 100 "$CRON_TAG\$" | grep -B 100 "$CRON_TAG END\$" | head -10 | sed 's/^/    /'
  else
    echo "✗ cron block MISSING"
  fi
  echo
  echo "─── Container ──────────────────────────────────"
  CONTAINER="hermes-$AGENT"
  if docker ps --format '{{.Names}}' 2>/dev/null | grep -q "^$CONTAINER$"; then
    echo "✓ container '$CONTAINER' running"
    echo "  last 5 on-boot-hook log lines:"
    docker logs "$CONTAINER" 2>&1 | grep -E "on-boot|restaurant-marketing|setup\.js" | tail -5 | sed 's/^/    /' || echo "    (none)"
  else
    echo "✗ container '$CONTAINER' not running (or docker not accessible)"
  fi
  echo
  echo "============ END DIAGNOSTIC ============"
  exit 0
fi

# ─── --repair: auto-fix common install issues ─────────────────────────
if [[ "${1:-}" == "--repair" ]]; then
  echo "→ Repair mode for agent '$AGENT'"
  if [[ ! -d "$HERMES_HOME" ]]; then
    echo "✗ $HERMES_HOME does not exist — spawn the agent first: bash ~/hermes-install/new-agent.sh $AGENT"
    exit 1
  fi
  CURRENT_OWNER="$(stat -c '%U' "$HERMES_HOME" 2>/dev/null)"
  ME="$(id -un)"
  if [[ "$CURRENT_OWNER" != "$ME" ]]; then
    echo "→ $HERMES_HOME is owned by '$CURRENT_OWNER', not '$ME' — chowning"
    if sudo -n true 2>/dev/null; then
      sudo chown -R "$(id -u):$(id -g)" "$HERMES_HOME"
      echo "  ✓ ownership reclaimed"
    else
      echo "  ⚠ sudo requires password. Run this manually then re-run --repair:"
      echo "    sudo chown -R \"\$(id -u):\$(id -g)\" $HERMES_HOME"
      exit 1
    fi
  fi
  if [[ ! -d "$AGENT_HOME" ]]; then
    mkdir -p "$AGENT_HOME"
    echo "  ✓ created $AGENT_HOME"
  fi
  echo "→ Running full install (idempotent — keeps existing config.json)"
  exec bash "$0"   # fall through to main install with same env
fi

if [[ ! -d "$HERMES_HOME" ]]; then
  echo "✗ $HERMES_HOME not found."
  echo "  Spawn this agent first: bash ~/hermes-install/new-agent.sh $AGENT"
  exit 1
fi

# ─── Auto-chown if container has reclaimed ownership ───────────────────
# When new-agent.sh launches the Hermes container, it chowns the data dir
# to its in-container UID (usually 10000). The host user can't write into
# it after that. This block detects ownership mismatch and chowns back
# automatically. Sudo prompts once if needed; declines fall through to a
# clear error.
HOST_UID="$(id -u)"
HOST_GID="$(id -g)"
DIR_UID="$(stat -c '%u' "$HERMES_HOME" 2>/dev/null || echo "$HOST_UID")"
if [[ "$DIR_UID" != "$HOST_UID" ]]; then
  echo "→ $HERMES_HOME is owned by uid $DIR_UID, not $HOST_UID — fixing"
  if sudo -n true 2>/dev/null; then
    sudo chown -R "$HOST_UID:$HOST_GID" "$HERMES_HOME"
    echo "  ✓ ownership fixed"
  else
    echo "  (sudo password prompt — needed to chown back from container UID)"
    if sudo chown -R "$HOST_UID:$HOST_GID" "$HERMES_HOME"; then
      echo "  ✓ ownership fixed"
    else
      echo "✗ chown declined or failed. Run manually then re-run install.sh:"
      echo "    sudo chown -R \"\$(id -u):\$(id -g)\" $HERMES_HOME"
      exit 1
    fi
  fi
fi

echo "→ Installing Restaurant Social Marketing skill"
echo "  agent:        $AGENT"
echo "  Hermes home:  $HERMES_HOME"
echo "  skill data:   $SKILL_DATA_DIR"

# 1. Skill data dir tree
mkdir -p "$SKILL_DATA_DIR"/{posts,photos,reports,reports/trend-reports,reports/competitor,knowledge-base,logs}
echo "  ✓ created $SKILL_DATA_DIR/"

# 2. Seed config.json (idempotent — keeps existing user edits)
if [[ ! -f "$CONFIG" ]]; then
  sed "s|{{AGENT_HOME}}|$AGENT_HOME|g" "$SKILL_DIR/templates/config.template.json" > "$CONFIG"
  echo "  ✓ seeded $CONFIG (you must fill in composio keys)"
else
  echo "  ✓ $CONFIG already exists — left untouched"
fi

# 3. SOUL.md → Hermes persona for this agent.
if ! cp "$SKILL_DIR/templates/SOUL.md" "$HERMES_HOME/SOUL.md" 2>/dev/null; then
  echo "✗ Failed to write $HERMES_HOME/SOUL.md (permission denied)."
  echo "  Fix: sudo chown -R \"\$(id -u):\$(id -g)\" $HERMES_HOME && retry."
  exit 1
fi
echo "  ✓ installed SOUL.md → $HERMES_HOME/SOUL.md"

# 4. Skill folders → $HERMES_HOME/skills/<skill>/.
#    Then whitelist: delete any other bundled skill that ships with Hermes.
#    They compete with our skills for routing — `social-media`, `media`,
#    `autonomous-ai-agents` are particular offenders for "generate post"
#    type requests. Without this whitelist, Composio logs stay empty
#    because Hermes uses its in-process image gen instead of MCP.
mkdir -p "$HERMES_HOME/skills"
SKILL_NAMES=(restaurant-marketing content-preparation marketing-intelligence \
             food-photography-hermes social-media-seo-hermes social-trend-monitor-hermes xurl)
for skill in "${SKILL_NAMES[@]}"; do
  if [[ -d "$SKILL_DIR/$skill" ]]; then
    rm -rf "$HERMES_HOME/skills/$skill"
    cp -r "$SKILL_DIR/$skill" "$HERMES_HOME/skills/$skill"
  fi
done
# Keep our skills + `mcp` (Hermes's own MCP integration). Delete everything else.
KEEP_SKILLS="restaurant-marketing content-preparation marketing-intelligence food-photography-hermes social-media-seo-hermes social-trend-monitor-hermes xurl mcp"
removed_count=0
for d in "$HERMES_HOME/skills/"*/; do
  [[ -d "$d" ]] || continue
  skill_name="$(basename "$d")"
  if ! echo " $KEEP_SKILLS " | grep -q " $skill_name "; then
    rm -rf "$d"
    removed_count=$((removed_count + 1))
  fi
done
echo "  ✓ installed ${#SKILL_NAMES[@]} skill folders, removed $removed_count competing bundled skills"

# 5. Copy scripts/ + package.json into the agent's data dir so the in-
#    container on-boot hook can find them at $HOST_AGENT_HOME/scripts/
#    (no extra Docker mount needed; piggybacks on the existing mount).
#    Trade-off: skill updates require re-running install.sh, not just git pull.
echo "→ Copying scripts/ into agent data dir"
mkdir -p "$AGENT_HOME/scripts"
rm -rf "$AGENT_HOME/scripts" "$AGENT_HOME/node_modules" "$AGENT_HOME/package.json" "$AGENT_HOME/package-lock.json"
cp -r "$SKILL_DIR/scripts" "$AGENT_HOME/scripts"
cp "$SKILL_DIR/package.json" "$AGENT_HOME/package.json"
[[ -f "$SKILL_DIR/package-lock.json" ]] && cp "$SKILL_DIR/package-lock.json" "$AGENT_HOME/package-lock.json"
echo "  ✓ scripts copied → $AGENT_HOME/scripts/"

# 6. On-boot hook. Runs inside the Hermes container on every boot.
#    VERIFY-ONLY: checks that config exists and reports state. Does NOT
#    provision MCP servers — that happens only when the user explicitly
#    runs setup.js (manually or via --force). The on-boot hook used to
#    auto-run setup.js, which clobbered working config.yaml entries on
#    every restart. Never again.
HOOK_FILE="$HERMES_HOME/hooks/on-boot/restaurant-social-marketing-skill.sh"
mkdir -p "$HERMES_HOME/hooks/on-boot"
cat > "$HOOK_FILE" <<'HOOK'
#!/bin/bash
# Auto-installed by restaurant-social-marketing-skill/install.sh.
# Runs inside the Hermes container on every boot.
# VERIFY-ONLY — never mutates config or provisions servers.
set -euo pipefail
AGENT_HOME="${HOST_AGENT_HOME:-/host-agent-home}"
CONFIG="$AGENT_HOME/social-marketing/config.json"
SCRIPTS_DIR="$AGENT_HOME/scripts"

if [[ ! -f "$CONFIG" ]]; then
  echo "[restaurant-marketing] no $CONFIG yet — owner needs to message Hermes to start onboarding"
  exit 0
fi
if [[ ! -d "$SCRIPTS_DIR" ]]; then
  echo "[restaurant-marketing] scripts not found at $SCRIPTS_DIR — re-run install.sh on host"
  exit 0
fi

URLS_COUNT="$(jq -r '.composio.mcpServerUrls | length' "$CONFIG" 2>/dev/null || echo 0)"
if [[ "$URLS_COUNT" == "0" ]]; then
  echo "[restaurant-marketing] config.composio.mcpServerUrls is empty."
  echo "[restaurant-marketing] If you already have a Composio MCP entry in /opt/data/config.yaml,"
  echo "[restaurant-marketing] Hermes will use that — no action needed."
  echo "[restaurant-marketing] Otherwise run inside this container:"
  echo "[restaurant-marketing]   node /host-agent-home/scripts/setup.js --config $CONFIG --force"
else
  echo "[restaurant-marketing] ✓ $URLS_COUNT MCP server URL(s) configured"
fi
HOOK
chmod +x "$HOOK_FILE"
# Verify the file actually wrote — silent failures here have happened before.
if [[ ! -s "$HOOK_FILE" ]]; then
  echo "✗ on-boot hook write FAILED — $HOOK_FILE is missing or empty after the heredoc."
  echo "  Likely cause: $HERMES_HOME is owned by a UID that doesn't allow this user to write."
  echo "  Fix: sudo chown -R \"\$(id -u):\$(id -g)\" $HERMES_HOME"
  exit 1
fi
echo "  ✓ installed on-boot hook ($HOOK_FILE, $(wc -l < "$HOOK_FILE") lines)"

# 7. npm deps — install INSIDE $AGENT_HOME so the in-container scripts
#    can resolve their require()s. node_modules ships with the agent home,
#    not the skill repo.
if command -v npm >/dev/null 2>&1; then
  echo "→ Installing npm deps in $AGENT_HOME (this can take a minute)"
  (cd "$AGENT_HOME" && npm install --silent --omit=dev)
  echo "  ✓ deps installed → $AGENT_HOME/node_modules/"
else
  echo "  ⚠ npm not found — install Node.js 18+ first"
fi

# 8. Drop any leftover symlink from the previous Option-A install layout.
rm -f "$AGENT_HOME/restaurant-social-marketing-skill"

# 9. Register cron jobs (substitute AGENT_HOME placeholder).
# IMPORTANT: clear ONLY the cron block, NOT the on-boot hook we just wrote
# in step 5. Earlier this called uninstall_cron_and_hook which deleted the
# hook it had just written 100 lines earlier. Took hours to find.
remove_cron_block >/dev/null 2>&1 || true
TMP_CRON="$(mktemp)"
trap "rm -f $TMP_CRON" EXIT
crontab -l 2>/dev/null > "$TMP_CRON" || true
{
  echo "$CRON_TAG"
  sed -e "s|{{AGENT_HOME}}|$AGENT_HOME|g" -e "s|{{AGENT}}|$AGENT|g" "$SKILL_DIR/templates/crontab.template"
  echo "$CRON_TAG END"
} >> "$TMP_CRON"
crontab "$TMP_CRON"
echo "  ✓ cron jobs registered for agent '$AGENT' (crontab -l to see them)"

cat <<EOF

✅ Skill installed for agent '$AGENT'.

What's done:
  - 7 skill folders installed; competing bundled skills removed
  - On-boot hook: verify-only (won't clobber working state)
  - Cron jobs registered

Required config — only two fields:
  $CONFIG
  - composio.apiKey         (Composio project API key)
  - composio.defaultUserId  (Composio userId that owns your connections)

Optional — use your own Azure OpenAI image deployment (ai.azure.com)
to save Composio credits. Default 'composio' works without further config.
Paste these into config.json under imageGen.azure:
  - imageGen.primary = "azure"
  - imageGen.azure.endpoint    (e.g. https://spacelist.openai.azure.com)
  - imageGen.azure.deployment  (e.g. gpt-image-2)
  - imageGen.azure.apiVersion  (default 2024-02-01)
  - imageGen.azure.apiKey      (paste key — or leave empty + export AZURE_API_KEY)
  - imageGen.azure.quality     (low|medium|high — default high)
Setup will preflight the endpoint and report ✅ / ⚠.
Composio remains the fallback if fallbackOnError stays true.

Then:
  docker exec hermes-$AGENT node /host-agent-home/scripts/setup.js \\
      --config /host-agent-home/social-marketing/config.json
  docker restart hermes-$AGENT
  docker logs hermes-$AGENT --tail 50

Setup script will:
  - provision Composio MCP + per-toolkit allowlist
  - wire that MCP server into Hermes's config.yaml
  - print per-toolkit summary (✅ Instagram 5 tools, ✅ Drive 2 tools, …)

Message the agent on Telegram to test.

Uninstall (keeps data):
  AGENT=$AGENT bash $SKILL_DIR/install.sh --uninstall
EOF
