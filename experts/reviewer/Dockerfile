# Reviewer expert image (Stage 1b).
# FROM the pinned base image; diff-reading tools at pinned versions. The
# reviewer has no MCP servers by default (leanest context in the fleet).
# Every version pinned; see versions.env.
ARG OPENCODE_VERSION=2.0.26
FROM agency-base:${OPENCODE_VERSION}
LABEL org.agency.expert="reviewer"
USER root
# delta 0.20.1 (GitHub release, sha256 checked).
RUN curl -fsSL -o /tmp/delta.tar.gz \
      "https://github.com/dandavison/delta/releases/download/0.20.1/delta-0.20.1-x86_64-unknown-linux-gnu.tar.gz" \
  && echo "50f08c879f84c81ceb220e476491a7f492d2c9c671e79918cc44badf961a6240  /tmp/delta.tar.gz" | sha256sum -c - \
  && tar -xzf /tmp/delta.tar.gz -C /tmp \
  && install -m755 /tmp/delta-0.20.1-x86_64-unknown-linux-gnu/delta /usr/local/bin/delta \
  && rm -rf /tmp/delta.tar.gz /tmp/delta-0.20.1-x86_64-unknown-linux-gnu \
  && delta --version
# difftastic 0.71.0 (GitHub release, sha256 checked).
RUN curl -fsSL -o /tmp/difftastic.tar.gz \
      "https://github.com/Wilfred/difftastic/releases/download/0.71.0/difft-0.71.0-x86_64-unknown-linux-gnu.tar.gz" \
  && echo "61aea5394a53c56f144637cf39b3a0c0dafa27769731745e5851ff276e6478da  /tmp/difftastic.tar.gz" | sha256sum -c - \
  && tar -xzf /tmp/difftastic.tar.gz -C /tmp \
  && install -m755 /tmp/difft /usr/local/bin/difft \
  && rm -rf /tmp/difftastic.tar.gz /tmp/difft \
  && difft --version
# scc v4.1.0 (GitHub release, sha256 checked).
RUN curl -fsSL -o /tmp/scc.tar.gz \
      "https://github.com/boyter/scc/releases/download/v4.1.0/scc_Linux_x86_64.tar.gz" \
  && echo "c7328436d3027f4357d3d7853f7dc3ac2bbcb4ca08f1adad91a27c593884079b  /tmp/scc.tar.gz" | sha256sum -c - \
  && tar -xzf /tmp/scc.tar.gz -C /tmp \
  && install -m755 /tmp/scc /usr/local/bin/scc \
  && rm -rf /tmp/scc.tar.gz /tmp/scc \
  && scc --version
USER agent
