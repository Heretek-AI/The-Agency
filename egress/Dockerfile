# Egress forward proxy (Stage 1b). Squid with an allowlist, per-expert
# basic-auth identities, per-request logging with the expert name, CONNECT
# limited to port 443, and private/loopback/link-local/metadata
# destinations denied. Chosen over the salvaged Smokescreen Dockerfile
# because Squid provides per-user credentials, ACLs, and logged usernames
# directly; Smokescreen as salvaged has no ACL and no role mapping (see
# docs/build-notes.md). Every version pinned; see versions.env.
FROM ubuntu:24.04@sha256:534baea6a22c03a63003dbc8dbe78fe34bc0d7e595d9a9dc9834884ff530eb55
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
       squid=6.14-0ubuntu0.24.04.4 \
       apache2-utils=2.4.58-1ubuntu8.16 \
       curl=8.5.0-2ubuntu10.15 \
  && rm -rf /var/lib/apt/lists/* \
  && squid -v 2>&1 | head -1 \
  && htpasswd --help >/dev/null 2>&1 \
  && ln -sf /dev/stdout /var/log/squid/access.log
EXPOSE 3128
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod 755 /usr/local/bin/entrypoint.sh
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
