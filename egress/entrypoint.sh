#!/usr/bin/env bash
# Egress proxy entrypoint (Stage 1b).
# Runs as the unprivileged `proxy` user (see Dockerfile): the container
# drops ALL capabilities, so nothing here may need privilege. Builds the
# Squid password file from PROXY_PW_<NAME> (one identity per expert) and
# starts Squid in the foreground. Refuses to start when any PROXY_PW_<NAME>
# is empty (fail-closed, exit 64) and validates the Squid configuration
# before serving. Passwords travel on stdin only, never on a command line.
set -u
umask 077

passwd_file="/etc/squid/passwd"
conf="/etc/squid/squid.conf"

count=0
matched=""
while IFS= read -r var; do
  [ -n "$var" ] || continue
  value="${!var}"
  if [ -z "$value" ]; then
    echo "entrypoint: refusing to start: $var is empty" >&2
    exit 64
  fi
  user=$(printf '%s' "${var#PROXY_PW_}" | tr 'A-Z_' 'a-z-')
  if [ "$count" -eq 0 ]; then
    printf '%s' "$value" | htpasswd -i -c "$passwd_file" "$user" >/dev/null 2>&1 || {
      echo "entrypoint: refusing to start: cannot write $passwd_file" >&2
      exit 64
    }
  else
    printf '%s' "$value" | htpasswd -i "$passwd_file" "$user" >/dev/null 2>&1 || {
      echo "entrypoint: refusing to start: cannot write $passwd_file" >&2
      exit 64
    }
  fi
  count=$((count + 1))
  matched="$matched $user"
done < <(compgen -e | grep '^PROXY_PW_' | sort)

if [ "$count" -eq 0 ]; then
  echo "entrypoint: refusing to start: no PROXY_PW_<NAME> variables set" >&2
  exit 64
fi

echo "entrypoint: proxy identities:$matched"

if ! squid -k parse -f "$conf" 2>&1; then
  echo "entrypoint: refusing to start: invalid Squid configuration in $conf" >&2
  exit 64
fi

# A pre-existing pid file at this point is always stale (fresh container
# start, or a restart where the old Squid never cleaned up; Squid writes
# its own pid, which is 1 here, so a stale file even looks live). Remove it
# before starting.
rm -f /var/log/squid/squid.pid
# Mirror the request log to the container's stdout so `docker logs` shows
# one line per proxied request; the file itself stays authoritative for
# audits. The tail dies with the container.
touch /var/log/squid/access.log
tail -n0 -F /var/log/squid/access.log 2>/dev/null &
exec squid -N -f "$conf"
