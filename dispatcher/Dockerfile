# The Agency dispatcher image (Stage 1d). FROM the pinned base image, plus
# Bun sources for the service. Runs as `agent`, attaches to the `fleet`
# network. Mounts `/work`, `/artifacts`, and `/data` (state, registry,
# audit) at run time. The server is dispatcher/src/main.ts: REST, SSE,
# and the fleet MCP endpoint on port 8080.
ARG OPENCODE_VERSION=2.0.26
ARG AGENT_UID=1000
ARG AGENT_GID=1000
FROM agency-base:${OPENCODE_VERSION}
LABEL org.agency.service="dispatcher"
ARG BUN_VERSION=1.4.2
USER root
# Bun (pinned zip, sha256 checked against BUN_LINUX_X64_SHA256 in versions.env).
RUN curl -fsSL -o /tmp/bun.zip \
      "https://github.com/oven-sh/bun/releases/download/bun-v${BUN_VERSION}/bun-linux-x64.zip" \
  && echo "36368faef7527875d5ffa52e53cd48021741f2a83eb6208a8dd64068d422a913  /tmp/bun.zip" | sha256sum -c - \
  && unzip -o -q /tmp/bun.zip -d /tmp/bunrel \
  && install -m755 /tmp/bunrel/bun-linux-x64/bun /usr/local/bin/bun \
  && rm -rf /tmp/bun.zip /tmp/bunrel \
  && bun --version | grep -q "${BUN_VERSION}"
RUN mkdir -p /app /work /artifacts /data /registry \
  && chown -R agent:agent /app /work /artifacts /data /registry
COPY package.json bun.lock /app/
COPY dispatcher /app/dispatcher
COPY fleet.yaml /app/fleet.yaml
RUN cd /app && bun install --frozen-lockfile \
  && chown -R agent:agent /app
USER agent
WORKDIR /app
# The base image's OpenCode entrypoint does not apply here.
ENTRYPOINT ["tini", "--"]
CMD ["bun", "dispatcher/src/main.ts"]
