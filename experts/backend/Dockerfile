# Backend expert image (Stage 1b).
# FROM the pinned base image; service toolchain and local MCP servers at
# pinned versions. Every version pinned; see versions.env.
ARG OPENCODE_VERSION=2.0.26
FROM agency-base:${OPENCODE_VERSION}
LABEL org.agency.expert="backend"
USER root
# make and hurl's runtime library (apt, pinned).
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
       make=4.3-4.1build2 \
       libxml2=2.9.14+dfsg-1.3ubuntu3.10 \
  && rm -rf /var/lib/apt/lists/* \
  && make --version | head -1
# pnpm (npm, pinned).
RUN npm install -g pnpm@12.11.2 \
  && pnpm --version
# hurl 8.0.1 (GitHub release, sha256 checked).
RUN curl -fsSL -o /tmp/hurl.tar.gz \
      "https://github.com/Orange-OpenSource/hurl/releases/download/8.0.1/hurl-8.0.1-x86_64-unknown-linux-gnu.tar.gz" \
  && echo "cac7c4670d69444db120edb21fe06c97ba8c80dcc52279957c8dd18f05fb0c06  /tmp/hurl.tar.gz" | sha256sum -c - \
  && tar -xzf /tmp/hurl.tar.gz -C /tmp \
  && install -m755 /tmp/hurl-8.0.1-x86_64-unknown-linux-gnu/bin/hurl /usr/local/bin/hurl \
  && rm -rf /tmp/hurl.tar.gz /tmp/hurl-8.0.1-x86_64-unknown-linux-gnu \
  && hurl --version
# httpie (PyPI, pinned) and the dbhub MCP server (npm, pinned; the server
# ships disabled until a DSN exists, but its binary is baked in now).
# dbhub's native dependencies need their install scripts named explicitly
# (npm's default blocks them); the names below belong to this pinned
# version's own dependency tree.
RUN uv pip install --system --break-system-packages httpie==3.2.4 \
  && http --version \
  && npm install -g --allow-scripts=oracledb,ssh2 @bytebase/dbhub@1.5.0 \
  && dbhub --help 2>&1 | grep -q "Database connection configuration is required"
# Serena (pinned git commit, installed as the agent user, linked on PATH).
USER agent
RUN uv tool install git+https://github.com/oraios/serena@f9972a32c67359dd4c4a5ab597688bb10d21d1f3
USER root
RUN ln -sf /home/agent/.local/bin/serena /usr/local/bin/serena \
  && serena --help >/dev/null
USER agent
