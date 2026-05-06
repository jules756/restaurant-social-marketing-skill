# Per-agent Hermes container for the restaurant marketing skill (v4).
# One container per Hermes agent (one company can run multiple agents);
# /data is mounted from a host volume named after the agent.

FROM node:18-alpine

# canvas build deps + Hermes runtime utilities. apk pulls latest patch
# levels at build time; pin upstream if you need fully reproducible builds.
RUN apk add --no-cache \
    python3 make g++ \
    cairo-dev pango-dev jpeg-dev giflib-dev librsvg-dev \
    bash curl jq tini

WORKDIR /app

# Dependencies first for layer caching.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Repo body. .dockerignore drops node_modules, .git, docs, tests.
COPY . .

# /data is the per-agent volume mount point (config.json, photos,
# posts, knowledge-base all live here).
VOLUME ["/data"]

# Hermes ships as a CLI installed at runtime by the entrypoint, so the
# image stays generic across agent kinds. The entrypoint also runs
# setup.js on first boot when mcpServerUrl is missing.
COPY scripts/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/docker-entrypoint.sh"]
