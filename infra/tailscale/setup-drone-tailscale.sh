#!/usr/bin/env bash
#
# setup-drone-tailscale.sh — join a Caribou System Unit (drone companion) to the
# tailnet as a tagged, ephemeral node. Run once during provisioning / first boot.
#
# The auth key should be an EPHEMERAL, PRE-AUTHORISED, TAGGED key (or minted by a
# Tailscale OAuth client) so the fleet onboards with zero manual approval and
# stale drones drop off the device list automatically.
#
# Usage:
#   sudo ./setup-drone-tailscale.sh --fleet acme --drone-id caribou-001 \
#        --authkey tskey-xxxx
#
set -euo pipefail

FLEET=""
DRONE_ID=""
AUTHKEY="${TS_AUTHKEY:-}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --fleet)    FLEET="$2"; shift 2 ;;
    --drone-id) DRONE_ID="$2"; shift 2 ;;
    --authkey)  AUTHKEY="$2"; shift 2 ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

[[ -z "$FLEET"    ]] && { echo "ERROR: --fleet <name> is required (tag:fleet-<name>)." >&2; exit 1; }
[[ -z "$DRONE_ID" ]] && { echo "ERROR: --drone-id <id> is required (used as hostname)." >&2; exit 1; }
[[ -z "$AUTHKEY"  ]] && { echo "ERROR: --authkey (ephemeral, tagged) is required." >&2; exit 1; }

TAGS="tag:drone,tag:fleet-${FLEET}"

if ! command -v tailscale >/dev/null 2>&1; then
  echo "[setup] Installing Tailscale..."
  curl -fsSL https://tailscale.com/install.sh | sh
fi

echo "[setup] Joining tailnet as ${DRONE_ID} with tags: ${TAGS}"
tailscale up \
  --advertise-tags="${TAGS}" \
  --hostname="${DRONE_ID}" \
  --authkey="${AUTHKEY}"

DNSNAME="$(tailscale status --json | sed -n 's/.*"DNSName": *"\([^"]*\)".*/\1/p' | head -1 | sed 's/\.$//')"
echo
echo "[setup] Drone is on the tailnet as:"
echo "          ${DNSNAME}"
echo
echo "[setup] Register this name with the Hub (Drone Configuration) so the Hub can"
echo "        pull this drone's services over the tailnet, e.g.:"
echo "          camera (go2rtc WHEP):  http://${DNSNAME}:1984"
echo "          telemetry stream:       ws://${DNSNAME}:8765   (HubLink, Phase B)"
