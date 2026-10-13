# syntax=docker/dockerfile:1
# The Agency expert base image (Stage 1a).
# Salvaged from opencode-distro/Dockerfile at 14f297a, adapted per
# docs/prompts/stage-1a-spike-and-base-image.md Step 1:
# entrypoint with fail-closed credential check, digest-pinned Ubuntu,
# pinned toolchain (yq, Node LTS, uv), AGENT_UID/AGENT_GID build arguments,
# /work + /artifacts + /etc/agency + XDG directories owned by `agent`,
# OpenCode at OPENCODE_VERSION promoted to /usr/local/bin.
#
# Single-arch (linux/amd64) in this stage: the Node/yq/uv asset hashes below
# were verified for x86_64 only. Extending to arm64 is Stage 1b work.
ARG AGENT_UID=1000
ARG AGENT_GID=1000
ARG OPENCODE_VERSION=2.0.26
ARG NODE_VERSION=24.21.0
ARG YQ_VERSION=4.48.2
ARG UV_VERSION=0.9.12

FROM ubuntu:24.04@sha256:534baea6a22c03a63003dbc8dbe78fe34bc0d7e595d9a9dc9834884ff530eb55 AS base
ARG AGENT_UID
ARG AGENT_GID
ARG OPENCODE_VERSION
ARG NODE_VERSION
ARG YQ_VERSION
ARG UV_VERSION
ENV DEBIAN_FRONTEND=noninteractive \
    OPENCODE_PORT=4096 \
    PATH=/usr/local/bin:$PATH
LABEL org.agency.image="base" \
      org.agency.opencode-version="${OPENCODE_VERSION}"

# Base packages, every one pinned to the version recorded in versions.env.
# fd-find ships the binary as `fdfind`; symlinked to `fd` below.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
       ca-certificates=20260601~24.04.1 \
       curl=8.5.0-2ubuntu10.15 \
       git=1:2.43.0-1ubuntu7.3 \
       jq=1.7.1-3ubuntu0.24.04.2 \
       ripgrep=14.1.0-1 \
       fd-find=9.0.0-1 \
       tini=0.19.0-1 \
       unzip=6.0-28ubuntu4.1 \
       xz-utils=5.6.1+really5.4.5-1ubuntu0.3 \
       openssh-client=1:9.6p1-3ubuntu13.19 \
       python3=3.12.3-0ubuntu2.1 \
       tar=1.35+dfsg-3ubuntu0.4 \
  && rm -rf /var/lib/apt/lists/* \
  && ln -s /usr/bin/fdfind /usr/local/bin/fd

# yq (pinned binary, sha256 checked against the hash in versions.env).
RUN curl -fsSL -o /tmp/yq \
      "https://github.com/mikefarah/yq/releases/download/v${YQ_VERSION}/yq_linux_amd64" \
  && echo "0ffc35320180d4911bc3a772934da508715e08af444cb33d4d43660065e25bcc  /tmp/yq" | sha256sum -c - \
  && install -m755 /tmp/yq /usr/local/bin/yq \
  && rm -f /tmp/yq \
  && yq --version | grep -q "${YQ_VERSION}"

# Node LTS (pinned tarball, sha256 checked against the hash in versions.env).
RUN curl -fsSL -o /tmp/node.tar.xz \
      "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz" \
  && echo "fd8e59d5a511510f6a298afb548f18c7d2b1be404d8b4a27d94fbe49f56cb2d6  /tmp/node.tar.xz" | sha256sum -c - \
  && tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1 \
  && rm -f /tmp/node.tar.xz \
  && node --version | grep -q "v${NODE_VERSION}" \
  && npm --version

# uv (pinned tarball, sha256 checked against the hash in versions.env).
RUN curl -fsSL -o /tmp/uv.tar.gz \
      "https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/uv-x86_64-unknown-linux-gnu.tar.gz" \
  && echo "4e43dac0c82b12b66564d91d5649350377b771d1df84374d9be1b9e6c8dd8152  /tmp/uv.tar.gz" | sha256sum -c - \
  && tar -xzf /tmp/uv.tar.gz -C /tmp \
  && install -m755 /tmp/uv-x86_64-unknown-linux-gnu/uv /usr/local/bin/uv \
  && install -m755 /tmp/uv-x86_64-unknown-linux-gnu/uvx /usr/local/bin/uvx \
  && rm -rf /tmp/uv.tar.gz /tmp/uv-x86_64-unknown-linux-gnu \
  && uv --version | grep -q "${UV_VERSION}"

# OpenCode v2 (pinned) via the official v2 install script, then promoted to
# /usr/local/bin so the unprivileged runtime user can execute it.
RUN curl -fsSL https://opencode.ai/v2/install | bash -s -- --version "${OPENCODE_VERSION}" \
  && install -m755 /root/.opencode/bin/opencode /usr/local/bin/opencode \
  && rm -rf /root/.opencode \
  && opencode --version | grep -q "${OPENCODE_VERSION}" \
  && opencode --version

# Unprivileged runtime user `agent` from AGENT_UID/AGENT_GID. The base ships a
# UID-1000 `ubuntu` user, so rename it in place when the ids collide instead
# of colliding with useradd (as the salvaged file does).
RUN set -eu; \
  if getent group "${AGENT_GID}" >/dev/null; then \
    oldg=$(getent group "${AGENT_GID}" | cut -d: -f1); \
    if [ "$oldg" != "agent" ]; then groupmod -n agent "$oldg"; fi; \
  else \
    groupadd -g "${AGENT_GID}" agent; \
  fi; \
  if getent passwd "${AGENT_UID}" >/dev/null; then \
    oldu=$(getent passwd "${AGENT_UID}" | cut -d: -f1); \
    if [ "$oldu" != "agent" ]; then usermod -l agent -d /home/agent -m "$oldu"; fi; \
    usermod -g agent agent; \
  else \
    useradd -m -u "${AGENT_UID}" -g agent agent; \
  fi; \
  mkdir -p /work /artifacts /etc/agency \
    /home/agent/.local/share/opencode \
    /home/agent/.local/state/opencode \
    /home/agent/.cache/opencode; \
  chown -R agent:agent /home/agent /work /artifacts /etc/agency; \
  chmod 755 /etc/agency; \
  id agent

RUN git config --system --add safe.directory '*'

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod 755 /usr/local/bin/entrypoint.sh

USER agent
WORKDIR /work
EXPOSE 4096
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -fsS --noproxy '*' -u "opencode:${OPENCODE_PASSWORD}" "http://127.0.0.1:4096/api/info" > /dev/null
ENTRYPOINT ["tini", "--", "/usr/local/bin/entrypoint.sh"]
