# Architect expert image (Stage 1b).
# FROM the pinned base image; structure-analysis tools at pinned versions.
# Every version pinned; see versions.env.
ARG OPENCODE_VERSION=2.0.26
FROM agency-base:${OPENCODE_VERSION}
LABEL org.agency.expert="architect"
USER root
# scc v4.1.0 (GitHub release, sha256 checked).
RUN curl -fsSL -o /tmp/scc.tar.gz \
      "https://github.com/boyter/scc/releases/download/v4.1.0/scc_Linux_x86_64.tar.gz" \
  && echo "c7328436d3027f4357d3d7853f7dc3ac2bbcb4ca08f1adad91a27c593884079b  /tmp/scc.tar.gz" | sha256sum -c - \
  && tar -xzf /tmp/scc.tar.gz -C /tmp \
  && install -m755 /tmp/scc /usr/local/bin/scc \
  && rm -rf /tmp/scc.tar.gz /tmp/scc \
  && scc --version
# dependency-cruiser and madge (npm, pinned).
RUN npm install -g dependency-cruiser@18.6.0 madge@8.0.0 \
  && depcruise --version \
  && madge --version
USER agent
