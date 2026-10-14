# Product expert image (Stage 1b).
# FROM the pinned base image; issue-tracker CLI at a pinned version.
# Every version pinned; see versions.env.
ARG OPENCODE_VERSION=2.0.26
FROM agency-base:${OPENCODE_VERSION}
LABEL org.agency.expert="product"
USER root
# gh (apt, pinned). Used read-only: the token that can write is held only
# by the Dispatcher.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
       gh=2.45.0-1ubuntu0.3 \
  && rm -rf /var/lib/apt/lists/* \
  && gh --version
USER agent
