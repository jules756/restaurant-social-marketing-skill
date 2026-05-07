# Skill audit — what's broken, what's fixable, what changes

Goal: a fresh `AGENT=foo bash install.sh` produces a working agent that generates a real post on Telegram with no manual config.yaml editing, no `sudo` surgery, no skill-folder deletions.

## What's broken (by file)

### `install.sh`

| # | Issue | Fix |
|---|---|---|
| 1 | Doesn't write Hermes's MCP server entry into `/opt/data/config.yaml`. Hermes can't call any Composio tools during a Telegram conversation. This is the single biggest hole. | After provisioning the MCP URL, edit `config.yaml` inside the container to add an `mcp_servers:` block pointing at the per-userId URL (with helper-actions stripped). |
| 2 | Doesn't whitelist skills. Hermes ships ~31 bundled skills (`social-media`, `media`, `smart-home`, `autonomous-ai-agents`, `gaming`, etc.) that compete with ours for routing and pollute the prompt. | After installing our skills, delete every other skill in `/opt/data/skills/` except an allowlist (our 7 + `mcp`). |
| 3 | Permission collision: container chowns `~/.hermes-<agent>/` to UID 10000, host user can't write SOUL.md. Every install run hits this; user has to `sudo chown` and re-run. | At top of install.sh, detect ownership; if not us, run `sudo chown -R "$(id -u):$(id -g)"` automatically (with a one-line "[sudo password may be needed]" notice). Also re-chown after the container has booted/restarted, so re-installs work. |
| 4 | "Next steps" message tells owner to fill platform-specific fields (Page ID, verifiedDomain, etc.) — but auto-discovery already handles those. Misleading. | (Done in c002108.) Trim further; only mention `apiKey` + `defaultUserId`. |
| 5 | Final state is silent — user has no way to know whether the install succeeded. No connection check, no tool-listing summary. | After `setup.js`, run a connection-check that lists all reachable tools per toolkit and prints "✅ Instagram (5 tools), ✅ Drive (2 tools), …" or the exact failure. |
| 6 | The on-boot hook is now verify-only (good), but it doesn't verify that Hermes-side MCP is wired. | Hook should also `grep mcp_servers /opt/data/config.yaml` and warn if missing. |

### `scripts/setup.js`

| # | Issue | Fix |
|---|---|---|
| 1 | Hardcoded image-gen path: only knows about Composio's OPENAI_CREATE_IMAGE / OPENAI_CREATE_IMAGE_EDIT. User has a custom Azure OpenAI endpoint they want to use as primary. | Add a backend abstraction; setup.js verifies whichever backend is `imageGen.primary` is reachable. |
| 2 | Failure mode: prints `1/10 failed` and exits non-zero even when the actual MCP server got provisioned successfully. The on-boot hook then prints a misleading "setup.js failed" line. | Track critical-vs-soft failures separately. Soft failures (one toolkit not connected) should still exit 0 if at least one MCP server provisioned. |
| 3 | Owner-config UX bug: setup.js exits with success message even if `composio.apiKey` doesn't actually authenticate. | Test the API key with a `composio.toolkits.list()` call before doing anything else. |

### `scripts/generate-slides.js`

| # | Issue | Fix |
|---|---|---|
| 1 | Single-backend: uses Composio MCP for image generation. User wants dual: custom Azure as primary, Composio as fallback. | Add `imageGenBackend` abstraction (custom + composio). Per-call: try primary → on error, try fallback. |
| 2 | Hardcoded `model = 'gpt-image-2'` even though config has `imageGen.model`. | Read from config; default to `gpt-image-2`. |
| 3 | Image path resolution for img2img references uses `image_url: path.resolve(p)` — a local file path passed as a URL. Composio probably rejects this. | Read each ref into base64 and pass via the API's accepted format. Custom Azure OpenAI takes `image: <buffer>` in multipart; Composio takes `images: [{image_b64: ...}]`. Per-backend serialization. |
| 4 | Reference-load error path: if `last-sync.json` is missing or `venuePhotos` is empty, exits 2 — fine — but no diagnostic about which Drive folder was checked. | Echo the resolved-folder names in the error so the owner knows which folder needs photos. |

### `scripts/mcp-client.js`

| # | Issue | Fix |
|---|---|---|
| 1 | Adequate. No changes needed. | — |

### `scripts/drive-sync.js`

| # | Issue | Fix |
|---|---|---|
| 1 | Folder-name patterns assume English/French. Owner's restaurant could be Italian, German, Spanish, Polish, etc. | Add Italian, German, Spanish, Portuguese variants. Separately, allow `googleDrive.dishesFolderId` and `googleDrive.venueFolderId` overrides for when auto-detect fails. |
| 2 | Persists `resolvedFolders` back to config.json — good. But never invalidates if owner renames a folder. | Add `--refresh-folders` flag (already there) and a 7-day TTL on the cached resolution. |

### `restaurant-marketing/SKILL.md`

| # | Issue | Fix |
|---|---|---|
| 1 | Slash commands (`/start`, `/post`, `/help`, `/promo`, `/analytics`, `/pause`, `/resume`) documented as if they work. They don't — Hermes Gateway has its own command registry we never registered with. | Either register them (research Hermes Gateway's command system) OR strip all slash references and rely on natural language. Pick one before claiming functionality. |
| 2 | Step 8 ("on yes, post to platform") references `/host-agent-home/scripts/post-to-<platform>.js` — fixed in c002108. ✅ | — |
| 3 | "Tool Loading (Read First)" table mentions tools that may not be in the active MCP server. Stale table. | Generate this dynamically from `setup.js`'s output, OR remove the per-tool list (Hermes loads tools by toolkit, not by individual slug). |

### `content-preparation/SKILL.md`

| # | Issue | Fix |
|---|---|---|
| 1 | Tells Hermes to invoke `node /host-agent-home/scripts/generate-slides.js …` via `terminal`. But the HARD RULE we added in `restaurant-marketing/SKILL.md` is the one Hermes sees first. Need to repeat the rule here so a delegated content-prep call can't decide to do its own image gen. | Add the same HARD RULE + quality gate at the top. |

### `food-photography-hermes/SKILL.md`

| # | Issue | Fix |
|---|---|---|
| 1 | This skill describes prompt vocabulary. Currently only loaded if `content-preparation` references it. If Hermes ever bypasses the script and writes its own image prompt, this won't get loaded. | Less of an issue once dual-backend forces all image gen through the script. Keep as-is. |

### `templates/config.template.json`

| # | Issue | Fix |
|---|---|---|
| 1 | Doesn't have an `imageGen` block beyond `toolSlug` (Composio escape hatch). Need primary/fallback structure for Azure + Composio. | Add: `imageGen.primary`, `imageGen.azure.{baseUrl, apiKeyEnv, model, deployment}`, `imageGen.composio.{tool}`, `imageGen.fallbackOnError`. |
| 2 | `paths.baseDir` etc. are absolute host paths (`/home/azureuser/agents/...`). Inside the container these don't resolve. | Use `/host-agent-home/social-marketing/...` for paths the in-container scripts read. |

### `templates/crontab.template`

| # | Issue | Fix |
|---|---|---|
| 1 | All paths use `{{AGENT_HOME}}` (the host path). Cron runs on the host, so this is correct — but the scripts inside need to find their MCP/script peers via in-container paths. | Cron should `docker exec` into the container, not run node on the host. Otherwise `node_modules` resolution differs and `/host-agent-home/...` paths inside scripts won't exist on the host. |

## What's been fixed already (recent commits)

- `c002108` — paths in SKILL.md fixed from `$HOST_AGENT_HOME/restaurant-social-marketing-skill/scripts` to `/host-agent-home/scripts`. HARD RULE + quality gate added.
- `adcfffc` — auto-discover platforms from Composio. Owner only fills `apiKey` + `defaultUserId`.
- `5a0ee65` — on-boot hook is verify-only. setup.js skips if MCP already provisioned.

## Order of fixes

1. **install.sh writes Hermes MCP entry + skill whitelist + sudo chown.** Single biggest unblock.
2. **Dual-backend image gen.** Owner wants this, and it side-steps Composio's MCP-call limit.
3. **Connection check at end of install.** Restores the "everything green" UX.
4. **Drop or properly register slash commands.** Honesty.
5. **Crontab → docker exec.** Otherwise cron jobs won't see MCP / node_modules.

## Out of scope for this audit pass

- Slash command registration with Hermes Gateway (research-required; either register them or document NL-only).
- Permission-denied warnings on `/opt/data/.managed` (cosmetic, Hermes-internal, ignore).
- Temperature-0.3 model errors (Hermes config bug; user can change auxiliary model in `config.yaml`).
