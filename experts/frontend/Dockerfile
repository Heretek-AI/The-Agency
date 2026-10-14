# Frontend expert image (Stage 1b).
# FROM the pinned base image; UI toolchain and the Playwright MCP server at
# pinned versions, with a Chromium from the matching playwright-core.
# Every version pinned; see versions.env.
ARG OPENCODE_VERSION=2.0.26
FROM agency-base:${OPENCODE_VERSION}
LABEL org.agency.expert="frontend"
USER root
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
# pnpm and the axe CLI (npm, pinned).
RUN npm install -g pnpm@12.11.2 @axe-core/cli@4.13.0 \
  && pnpm --version \
  && axe --version
# Bun 1.4.2 (GitHub release, sha256 checked).
RUN curl -fsSL -o /tmp/bun.zip \
      "https://github.com/oven-sh/bun/releases/download/bun-v1.4.2/bun-linux-x64.zip" \
  && echo "36368faef7527875d5ffa52e53cd48021741f2a83eb6208a8dd64068d422a913  /tmp/bun.zip" | sha256sum -c - \
  && unzip -o -q /tmp/bun.zip -d /tmp/bun \
  && install -m755 /tmp/bun/bun-linux-x64/bun /usr/local/bin/bun \
  && rm -rf /tmp/bun.zip /tmp/bun \
  && bun --version
# Playwright MCP 0.0.83 plus the exact playwright-core it depends on; the
# browsers install once into /ms-playwright with system dependencies.
RUN npm install -g @playwright/mcp@0.0.83 playwright-core@1.64.0-alpha-1790635538000 \
  && node /usr/local/lib/node_modules/playwright-core/cli.js install --with-deps chromium \
  && rm -rf /root/.cache/ms-playwright /tmp/* \
  && playwright-mcp --help >/dev/null
USER agent
