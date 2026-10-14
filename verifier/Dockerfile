# The Agency verifier image (Stage 1c). FROM the pinned base image, plus
# the common toolchains the checks need (Bun and Node ship in the base;
# pnpm is pinned here). Runs as `agent`, serves only on the `fleet`
# network. It never sees the provider key: no `.env.provider` is mounted
# and no model credentials are baked in.
ARG OPENCODE_VERSION=2.0.26
ARG AGENT_UID=1000
ARG AGENT_GID=1000
FROM agency-base:${OPENCODE_VERSION}
LABEL org.agency.service="verifier"
ARG AGENT_UID
ARG AGENT_GID
ARG PNPM_VERSION=12.11.2
USER root
# pnpm (pinned; see PNPM_VERSION in versions.env).
RUN npm install -g "pnpm@${PNPM_VERSION}" \
  && pnpm --version | grep -q "${PNPM_VERSION}"
RUN mkdir -p /app /work /artifacts /home/agent/.cache \
  && chown -R agent:agent /app /work /artifacts /home/agent/.cache
# Dispatcher + verifier sources (the server imports dispatcher/src/config
# and verifier/src/run-checks) with workspace deps installed.
COPY package.json bun.lock /app/
COPY dispatcher /app/dispatcher
COPY verifier /app/verifier
RUN cd /app && bun install --frozen-lockfile \
  && chown -R agent:agent /app
USER agent
WORKDIR /app
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=10 \
  CMD curl -fsS --noproxy '*' http://127.0.0.1:8080/healthz > /dev/null
CMD ["bun", "verifier/src/server.ts"]
