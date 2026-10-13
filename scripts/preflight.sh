#!/usr/bin/env bash
# Preflight for The Agency (Stage 1a, Step 0).
# Checks the host and prints one table. Exits 1 on any failed requirement.
# Never prints a secret: the provider key is reported present/absent only.
set -u

URL="https://opencode.ai/v2/install"
PORT_START=8080
PORT_MAX=8200

pass_n=0
fail_n=0
rows=""

row() {
  # row <name> <PASS|FAIL|INFO> <detail>
  rows+=$(printf '%-16s %-6s %s' "$1" "$2" "$3")
  rows+=$'\n'
  case "$2" in
    PASS) pass_n=$((pass_n + 1)) ;;
    FAIL) fail_n=$((fail_n + 1)) ;;
  esac
}

# --- container runtime (Docker preferred; both are installed on the dev host) ---
runtime=""
runtime_version=""
if command -v docker >/dev/null 2>&1; then
  runtime="docker"
  runtime_version=$(docker --version 2>/dev/null | head -1)
elif command -v podman >/dev/null 2>&1; then
  runtime="podman"
  runtime_version=$(podman --version 2>/dev/null | head -1)
fi
if [ -z "$runtime" ]; then
  row "runtime" "FAIL" "neither docker nor podman is installed"
else
  row "runtime" "PASS" "$runtime_version"
fi

# --- compose >= 2.24 ---
compose_version=""
if [ -n "$runtime" ]; then
  compose_version=$($runtime compose version --short 2>/dev/null || true)
fi
if [ -z "$compose_version" ]; then
  row "compose" "FAIL" "no compose plugin for $runtime"
else
  major=$(echo "$compose_version" | sed -E 's/^v?([0-9]+).*/\1/')
  minor=$(echo "$compose_version" | sed -E 's/^v?[0-9]+\.([0-9]+).*/\1/')
  if [ "$major" -gt 2 ] 2>/dev/null || { [ "$major" -eq 2 ] 2>/dev/null && [ "$minor" -ge 24 ] 2>/dev/null; }; then
    row "compose" "PASS" "$runtime compose $compose_version"
  else
    row "compose" "FAIL" "$runtime compose $compose_version is older than 2.24"
  fi
fi

# --- SELinux mode (informational: enforced where present) ---
selinux="absent"
if command -v getenforce >/dev/null 2>&1; then
  selinux=$(getenforce 2>/dev/null || echo "unknown")
elif [ -r /sys/fs/selinux/enforce ]; then
  case "$(cat /sys/fs/selinux/enforce 2>/dev/null)" in
    1) selinux="Enforcing" ;;
    0) selinux="Permissive" ;;
  esac
fi
row "selinux" "INFO" "$selinux"

# --- provider file: exists, mode 0600, non-empty OPENCODE_API_KEY ---
root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
provider_file="$root/.env.provider"
if [ ! -f "$provider_file" ]; then
  row "provider-file" "FAIL" ".env.provider absent (place OPENCODE_API_KEY there, mode 0600)"
else
  mode=$(stat -c %a "$provider_file" 2>/dev/null || echo "?")
  key_present="absent"
  if grep -qE '^OPENCODE_API_KEY=[^[:space:]#]+' "$provider_file" 2>/dev/null; then
    # A value followed only by whitespace/comment still counts; a bare
    # `OPENCODE_API_KEY=` does not. Strip comments before measuring.
    val=$(sed -n 's/^OPENCODE_API_KEY=//p' "$provider_file" | head -1 | sed 's/[[:space:]]*#.*//;s/^[[:space:]]*//;s/[[:space:]]*$//')
    if [ -n "$val" ]; then
      key_present="present"
    else
      key_present="empty"
    fi
  fi
  if [ "$mode" = "600" ] && [ "$key_present" = "present" ]; then
    row "provider-file" "PASS" ".env.provider present, mode 0600, OPENCODE_API_KEY present"
  else
    row "provider-file" "FAIL" ".env.provider present but mode=$mode key=$key_present (need 0600 + non-empty key)"
  fi
fi

# --- install script URL reachable ---
if curl -fsSI --max-time 20 "$URL" >/dev/null 2>&1; then
  row "install-url" "PASS" "$URL reachable"
else
  row "install-url" "FAIL" "$URL unreachable"
fi

# --- free loopback port from 8080 up (8080 is taken on the dev host) ---
free_port=""
port="$PORT_START"
while [ "$port" -le "$PORT_MAX" ]; do
  if command -v python3 >/dev/null 2>&1; then
    if python3 -c "import socket,sys; s=socket.socket(); s.bind(('127.0.0.1', $port)); s.close()" 2>/dev/null; then
      free_port="$port"
      break
    fi
  else
    if ! (exec 3<>"/dev/tcp/127.0.0.1/$port") 2>/dev/null; then
      free_port="$port"
      break
    fi
  fi
  port=$((port + 1))
done
if [ -z "$free_port" ]; then
  row "http-port" "FAIL" "no free loopback port in $PORT_START-$PORT_MAX"
else
  row "http-port" "PASS" "AGENCY_HTTP_PORT=$free_port"
fi

# --- Stage 2b information only: user namespaces and kernel ---
userns="unknown"
if [ -r /proc/sys/user/max_user_namespaces ]; then
  userns="max_user_namespaces=$(cat /proc/sys/user/max_user_namespaces)"
fi
row "userns" "INFO" "$userns (stage 2b info only)"
row "kernel" "INFO" "$(uname -srm) (stage 2b info only)"

printf 'PREFLIGHT\n%s' "$rows"
if [ "$fail_n" -gt 0 ]; then
  printf 'preflight: %d pass, %d fail\n' "$pass_n" "$fail_n"
  exit 1
fi
printf 'preflight: %d pass, 0 fail\n' "$pass_n"
exit 0
