# QA expert image (Stage 1b).
# FROM the pinned base image; test toolchain and the Playwright MCP server
# at pinned versions, with a Chromium from the matching playwright-core.
# Every version pinned; see versions.env.
ARG OPENCODE_VERSION=2.0.26
FROM agency-base:${OPENCODE_VERSION}
LABEL org.agency.expert="qa"
USER root
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
# pnpm (npm, pinned) and pytest (PyPI, pinned).
RUN npm install -g pnpm@12.11.2 \
  && pnpm --version \
  && uv pip install --system --break-system-packages pytest==9.1.1 \
  && pytest --version
# Playwright MCP 0.0.83 plus the exact playwright-core it depends on; the
# browsers install once into /ms-playwright with system dependencies.
RUN npm install -g @playwright/mcp@0.0.83 playwright-core@1.64.0-alpha-1790635538000 \
  && node /usr/local/lib/node_modules/playwright-core/cli.js install --with-deps chromium \
  && rm -rf /root/.cache/ms-playwright /tmp/* \
  && playwright-mcp --help >/dev/null
USER agent
