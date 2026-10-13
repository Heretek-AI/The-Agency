# Docs expert image (Stage 1b).
# FROM the pinned base image; documentation linters at pinned versions.
# Vale is not installed: its repository moved and no trustworthy release
# asset could be verified (see docs/build-notes.md); prose linting beyond
# markdownlint and prettier waits for that. Every version pinned; see
# versions.env.
ARG OPENCODE_VERSION=2.0.26
FROM agency-base:${OPENCODE_VERSION}
LABEL org.agency.expert="docs"
USER root
# markdownlint-cli2 and prettier (npm, pinned).
RUN npm install -g markdownlint-cli2@0.23.3 prettier@3.6.2 \
  && markdownlint-cli2 --version \
  && prettier --version
# lychee 0.24.2 (GitHub release, sha256 checked).
RUN curl -fsSL -o /tmp/lychee.tar.gz \
      "https://github.com/lycheeverse/lychee/releases/download/lychee-v0.24.2/lychee-x86_64-unknown-linux-gnu.tar.gz" \
  && echo "1f4e0ef7f6554a6ed33dd7ac144fb2e1bbed98598e7af973042fc5cd43951c9a  /tmp/lychee.tar.gz" | sha256sum -c - \
  && tar -xzf /tmp/lychee.tar.gz -C /tmp \
  && install -m755 /tmp/lychee-x86_64-unknown-linux-gnu/lychee /usr/local/bin/lychee \
  && rm -rf /tmp/lychee.tar.gz /tmp/lychee-x86_64-unknown-linux-gnu \
  && lychee --version
USER agent
