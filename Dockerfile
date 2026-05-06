# Per-agent Hermes marketing container (v4).
#
# Layers this skill on top of the official Hermes image:
#   - Hermes CLI, Python, Node 20, Playwright are already in the base.
#   - HERMES_HOME=/opt/data (mounted from the host).
#   - Hermes's own entrypoint at /opt/hermes/docker/entrypoint.sh.
#
# We add: this skill's scripts, npm deps, node-canvas system libs, and a
# pre-start script that scaffolds the data dir + provisions the MCP
# server before delegating to Hermes's entrypoint.

FROM nousresearch/hermes-agent:latest

# node-canvas (text-overlay) + jq (entrypoint config inspection).
# Hermes base is Ubuntu 24.04. apt is available; install the deb deps.
RUN apt-get update && apt-get install -y --no-install-recommends \
      libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev \
      build-essential python3 \
      jq \
    && rm -rf /var/lib/apt/lists/*

# Skill scripts + node modules live alongside Hermes's tree, not under
# /opt/data (which is the host-mounted volume — gets overwritten at run).
WORKDIR /opt/hermes/social-marketing-skill

# Install npm deps first for layer caching.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Repo body. .dockerignore prunes node_modules, .git, docs, tests.
COPY . .

# Pre-start script: scaffolds /opt/data/social-marketing on first boot,
# runs setup.js when mcpServerUrl is empty, copies skills into HERMES_HOME,
# then exec's the upstream Hermes entrypoint with the original CMD.
RUN cp scripts/docker-entrypoint.sh /usr/local/bin/marketing-pre-start.sh \
 && chmod +x /usr/local/bin/marketing-pre-start.sh

# Override Hermes's entrypoint with our pre-start; it tail-calls Hermes's
# own entrypoint at the end so the rest of the boot is identical.
ENTRYPOINT ["/usr/bin/tini", "-g", "--", "/usr/local/bin/marketing-pre-start.sh"]
