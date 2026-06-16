#!/usr/bin/env bash
#
# setup-hub-tailscale.sh — join a Caribou Hub host to the tailnet and expose the
# Hub UI/API over HTTPS on the tailnet (no public exposure).
#
# Prereqs in the Tailscale admin console (one-time per tailnet):
#   • MagicDNS enabled
#   • HTTPS certificates enabled
#   • The tags below defined in the ACL policy (see infra/tailscale/acl.hujson)
#
# Usage:
#   sudo ./setup-hub-tailscale.sh --operator op1 [--hostname caribou-hub-op1] \
#        [--authkey tskey-xxxx] [--port 3000]
#
set -euo pipefail

OPERATOR=""
HOSTNAME_OVERRIDE=""
AUTHKEY="${TS_AUTHKEY:-}"
HUB_PORT="3000"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --operator) OPERATOR="$2"; shift 2 ;;
    --hostname) HOSTNAME_OVERRIDE="$2"; shift 2 ;;
    --authkey)  AUTHKEY="$2"; shift 2 ;;
    --port)     HUB_PORT="$2"; shift 2 ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

if [[ -z "$OPERATOR" ]]; then
  echo "ERROR: --operator <name> is required (used for tag:hub-<name>)." >&2
  exit 1
fi

TAGS="tag:hub,tag:hub-${OPERATOR}"
HOSTNAME_ARG=()
[[ -n "$HOSTNAME_OVERRIDE" ]] && HOSTNAME_ARG=(--hostname "$HOSTNAME_OVERRIDE")

# 1. Install Tailscale if missing
if ! command -v tailscale >/dev/null 2>&1; then
  echo "[setup] Installing Tailscale..."
  curl -fsSL https://tailscale.com/install.sh | sh
fi

# 2. Join the tailnet with the hub tags
echo "[setup] Bringing Tailscale up with tags: ${TAGS}"
UP_ARGS=(--advertise-tags="${TAGS}" "${HOSTNAME_ARG[@]}")
[[ -n "$AUTHKEY" ]] && UP_ARGS+=(--authkey "$AUTHKEY")
tailscale up "${UP_ARGS[@]}"

# 3. Expose the Hub on the tailnet over HTTPS (proxy 443 -> local Hub port)
echo "[setup] Configuring tailscale serve -> http://127.0.0.1:${HUB_PORT}"
tailscale serve --bg --https=443 "http://127.0.0.1:${HUB_PORT}"

# 4. Report the resulting URL + the PUBLIC_BASE_URL to set in the Hub's .env
DNSNAME="$(tailscale status --json | sed -n 's/.*"DNSName": *"\([^"]*\)".*/\1/p' | head -1 | sed 's/\.$//')"
URL="https://${DNSNAME}"
echo
echo "[setup] Hub is reachable on the tailnet at:"
echo "          ${URL}"
echo
echo "[setup] Set this in the Hub's .env so drone-facing file URLs are tailnet-routable:"
echo "          PUBLIC_BASE_URL=${URL}"
echo
echo "[setup] To run serve on every boot, install the systemd unit:"
echo "          sudo cp infra/tailscale/caribou-hub-serve.service /etc/systemd/system/"
echo "          sudo systemctl enable --now caribou-hub-serve.service"
