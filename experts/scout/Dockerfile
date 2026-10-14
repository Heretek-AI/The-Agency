# Scout expert image (Stage 1b).
# FROM the pinned base image; reconnaissance tools at pinned versions.
# Every version pinned; see versions.env.
ARG OPENCODE_VERSION=2.0.26
FROM agency-base:${OPENCODE_VERSION}
LABEL org.agency.expert="scout"
USER root
# tree (apt, pinned).
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
       tree=2.1.1-2ubuntu3.24.04.2 \
  && rm -rf /var/lib/apt/lists/* \
  && tree --version
# scc v4.1.0 (GitHub release, sha256 checked).
RUN curl -fsSL -o /tmp/scc.tar.gz \
      "https://github.com/boyter/scc/releases/download/v4.1.0/scc_Linux_x86_64.tar.gz" \
  && echo "c7328436d3027f4357d3d7853f7dc3ac2bbcb4ca08f1adad91a27c593884079b  /tmp/scc.tar.gz" | sha256sum -c - \
  && tar -xzf /tmp/scc.tar.gz -C /tmp \
  && install -m755 /tmp/scc /usr/local/bin/scc \
  && rm -rf /tmp/scc.tar.gz /tmp/scc \
  && scc --version
# ast-grep 0.50.0 (GitHub release, sha256 checked). The zip carries the
# `ast-grep` binary (`sg` is a deprecated shim for it).
RUN curl -fsSL -o /tmp/ast-grep.zip \
      "https://github.com/ast-grep/ast-grep/releases/download/0.50.0/app-x86_64-unknown-linux-gnu.zip" \
  && echo "0fd3f489639abb8465a914b74b8779171577582318d8a940d00399f59dba81c5  /tmp/ast-grep.zip" | sha256sum -c - \
  && unzip -o -q /tmp/ast-grep.zip -d /tmp/ast-grep \
  && install -m755 /tmp/ast-grep/ast-grep /usr/local/bin/ast-grep \
  && rm -rf /tmp/ast-grep.zip /tmp/ast-grep \
  && ast-grep --version
USER agent
