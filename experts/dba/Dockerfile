# DBA expert image (Stage 1b).
# FROM the pinned base image; database clients and linters at pinned
# versions, plus the (disabled until a DSN exists) database MCP servers.
# Every version pinned; see versions.env. Atlas is not installed: its
# releases carry no downloadable assets to verify (see docs/build-notes.md).
ARG OPENCODE_VERSION=2.0.26
FROM agency-base:${OPENCODE_VERSION}
LABEL org.agency.expert="dba"
USER root
# Database clients (apt, pinned).
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
       postgresql-client=16+257build1.1 \
       sqlite3=3.45.1-1ubuntu2.8 \
       mysql-client=8.0.46-0ubuntu0.24.04.4 \
  && rm -rf /var/lib/apt/lists/* \
  && psql --version \
  && sqlite3 --version \
  && mysql --version
# sqlfluff and the postgres MCP server entry point (PyPI, pinned).
RUN uv pip install --system --break-system-packages sqlfluff==4.4.0 postgres-mcp==0.3.0 \
  && sqlfluff --version \
  && postgres-mcp --help >/dev/null
# dbhub MCP server (npm, pinned; ships disabled until a DSN exists).
RUN npm install -g @bytebase/dbhub@1.5.0 \
  && dbhub --help >/dev/null 2>&1
USER agent
