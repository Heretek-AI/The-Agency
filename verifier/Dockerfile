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
ARG BUN_VERSION=1.4.2
ARG PNPM_VERSION=12.11.2
USER root
# Bun (pinned zip, sha256 checked against BUN_LINUX_X64_SHA256 in versions.env).
RUN curl -fsSL -o /tmp/bun.zip \
      "https://github.com/oven-sh/bun/releases/download/bun-v${BUN_VERSION}/bun-linux-x64.zip" \
  && echo "36368faef7527875d5ffa52e53cd48021741f2a83eb6208a8dd64068d422a913  /tmp/bun.zip" | sha256sum -c - \
  && unzip -o -q /tmp/bun.zip -d /tmp/bunrel \
  && install -m755 /tmp/bunrel/bun-linux-x64/bun /usr/local/bin/bun \
  && rm -rf /tmp/bun.zip /tmp/bunrel \
  && bun --version | grep -q "${BUN_VERSION}"
# bunx shim: the release zip ships only the `bun` binary, while repository
# scripts call `bunx`. `bun x` is the same executor; local packages resolve
# without a download.
RUN printf '#!/bin/sh\nexec /usr/local/bin/bun x "$@"\n' > /usr/local/bin/bunx \
  && chmod 755 /usr/local/bin/bunx \
  && test -x /usr/local/bin/bunx
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
# The base image's OpenCode entrypoint does not apply here.
ENTRYPOINT ["tini", "--"]
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=10 \
  CMD curl -fsS --noproxy '*' http://127.0.0.1:8080/healthz > /dev/null
CMD ["bun", "verifier/src/server.ts"]
