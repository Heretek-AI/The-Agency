# Director expert image (Stage 1b).
# FROM the pinned base image. The Director needs no extra toolchain: it
# reads plans, results, and diffs, and its shell is limited to read-only
# git commands. Every version pinned; see versions.env.
ARG OPENCODE_VERSION=2.0.26
FROM agency-base:${OPENCODE_VERSION}
LABEL org.agency.expert="director"
USER agent
