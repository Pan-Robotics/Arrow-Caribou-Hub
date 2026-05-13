#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# Caribou Camera Stream Services — Installer
# ═══════════════════════════════════════════════════════════════════════════════
#
# Installs and configures:
#   1. go2rtc binary (RTSP → WebRTC transcoding)
#   2. Tailscale (public HTTPS tunnel for signaling)
#   3. camera_stream_service.py (health monitor + Hub registration)
#   4. Systemd services for all three components
#
# Works with ANY RTSP camera source — no camera-specific code.
#
# Run as root:
#   sudo ./install_camera_services.sh
#
# ═══════════════════════════════════════════════════════════════════════════════

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo -e "${CYAN}"
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║       Caribou Camera Stream Services — Installer            ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo -e "${NC}"

# ─── Check root ────────────────────────────────────────────────────────────────
if [ "$EUID" -ne 0 ]; then
    echo -e "${RED}ERROR: This script must be run as root (sudo).${NC}"
    exit 1
fi

# ─── Detect architecture ──────────────────────────────────────────────────────
ARCH=$(uname -m)
case "$ARCH" in
    aarch64)
        GO2RTC_ARCH="arm64"
        echo -e "${GREEN}Architecture: ARM64 (aarch64) — recommended${NC}"
        ;;
    armv7l)
        GO2RTC_ARCH="arm"
        echo -e "${YELLOW}Architecture: ARMv7 (32-bit)${NC}"
        ;;
    x86_64)
        GO2RTC_ARCH="amd64"
        echo -e "${GREEN}Architecture: x86_64 (amd64)${NC}"
        ;;
    *)
        echo -e "${RED}ERROR: Unsupported architecture: $ARCH${NC}"
        echo "Supported: aarch64 (arm64), armv7l (arm), x86_64 (amd64)"
        exit 1
        ;;
esac

# ─── Interactive prompts ───────────────────────────────────────────────────────
echo ""
echo -e "${CYAN}─── Configuration ───${NC}"
echo ""

# RTSP URL (required)
read -p "RTSP URL (e.g. rtsp://192.168.1.100:8554/stream): " RTSP_URL
if [ -z "$RTSP_URL" ]; then
    echo -e "${RED}ERROR: RTSP URL is required.${NC}"
    exit 1
fi

# Hub URL
read -p "Caribou Hub URL [https://arrowhub-5j6w8bkt.manus.space]: " HUB_URL
HUB_URL=${HUB_URL:-"https://arrowhub-5j6w8bkt.manus.space"}

# Drone ID
read -p "Drone ID [caribou_001]: " DRONE_ID
DRONE_ID=${DRONE_ID:-"caribou_001"}

# API Key
read -p "API Key for Hub authentication: " API_KEY
if [ -z "$API_KEY" ]; then
    echo -e "${YELLOW}WARNING: No API key provided. Hub registration will be disabled.${NC}"
fi

# Install directory
DEFAULT_INSTALL_DIR="/home/caribou/caribou-hub"
read -p "Install directory [$DEFAULT_INSTALL_DIR]: " INSTALL_DIR
INSTALL_DIR=${INSTALL_DIR:-"$DEFAULT_INSTALL_DIR"}

# Determine the user who will run the services
INSTALL_USER=$(stat -c '%U' "$(dirname "$INSTALL_DIR")" 2>/dev/null || echo "root")
if [ "$INSTALL_USER" = "root" ]; then
    INSTALL_USER=$(logname 2>/dev/null || echo "pi")
fi
read -p "Service user [$INSTALL_USER]: " SERVICE_USER
SERVICE_USER=${SERVICE_USER:-"$INSTALL_USER"}

echo ""
echo -e "${CYAN}─── Configuration Summary ───${NC}"
echo "  RTSP URL:      $RTSP_URL"
echo "  Hub URL:       $HUB_URL"
echo "  Drone ID:      $DRONE_ID"
echo "  API Key:       ${API_KEY:+***set***}${API_KEY:-<not set>}"
echo "  Install dir:   $INSTALL_DIR"
echo "  Service user:  $SERVICE_USER"
echo "  go2rtc arch:   $GO2RTC_ARCH"
echo ""
read -p "Proceed with installation? [Y/n]: " CONFIRM
CONFIRM=${CONFIRM:-Y}
if [[ ! "$CONFIRM" =~ ^[Yy] ]]; then
    echo "Installation cancelled."
    exit 0
fi

echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# Step 1: Install system dependencies
# ═══════════════════════════════════════════════════════════════════════════════
echo -e "${GREEN}[1/11] Installing system dependencies...${NC}"
apt-get update -qq
apt-get install -y -qq python3 python3-pip curl jq > /dev/null 2>&1
echo "  ✓ python3, python3-pip, curl, jq installed"

# ═══════════════════════════════════════════════════════════════════════════════
# Step 2: Install Python dependencies
# ═══════════════════════════════════════════════════════════════════════════════
echo -e "${GREEN}[2/11] Installing Python dependencies...${NC}"
pip3 install --break-system-packages requests > /dev/null 2>&1
echo "  ✓ requests installed"

# ═══════════════════════════════════════════════════════════════════════════════
# Step 3: Download go2rtc binary
# ═══════════════════════════════════════════════════════════════════════════════
echo -e "${GREEN}[3/11] Downloading go2rtc binary (${GO2RTC_ARCH})...${NC}"

# Get latest release URL from GitHub
GO2RTC_RELEASE_URL=$(curl -s https://api.github.com/repos/AlexxIT/go2rtc/releases/latest \
    | jq -r ".assets[] | select(.name == \"go2rtc_linux_${GO2RTC_ARCH}\") | .browser_download_url")

if [ -z "$GO2RTC_RELEASE_URL" ] || [ "$GO2RTC_RELEASE_URL" = "null" ]; then
    echo -e "${RED}ERROR: Could not find go2rtc release for architecture: ${GO2RTC_ARCH}${NC}"
    exit 1
fi

curl -sL "$GO2RTC_RELEASE_URL" -o /usr/local/bin/go2rtc
chmod +x /usr/local/bin/go2rtc
echo "  ✓ go2rtc installed at /usr/local/bin/go2rtc"
echo "    Version: $(/usr/local/bin/go2rtc --version 2>/dev/null || echo 'unknown')"

# ═══════════════════════════════════════════════════════════════════════════════
# Step 4: Install Tailscale
# ═══════════════════════════════════════════════════════════════════════════════
echo -e "${GREEN}[4/11] Installing Tailscale...${NC}"

if command -v tailscale &> /dev/null; then
    echo "  ✓ Tailscale already installed"
else
    curl -fsSL https://tailscale.com/install.sh | sh > /dev/null 2>&1
    echo "  ✓ Tailscale installed"
fi

# Check if Tailscale is connected
TS_STATUS=$(tailscale status --json 2>/dev/null | jq -r '.BackendState' 2>/dev/null || echo "unknown")
if [ "$TS_STATUS" != "Running" ]; then
    echo -e "${YELLOW}  Tailscale is not connected. Running 'tailscale up'...${NC}"
    echo -e "${YELLOW}  Please authenticate in your browser when prompted.${NC}"
    tailscale up
fi

echo "  ✓ Tailscale connected"

# ═══════════════════════════════════════════════════════════════════════════════
# Step 5: Configure Tailscale Funnel
# ═══════════════════════════════════════════════════════════════════════════════
echo -e "${GREEN}[5/11] Configuring Tailscale Funnel...${NC}"

tailscale serve --bg --https=443 http://localhost:1984 2>/dev/null || true
tailscale funnel 443 on 2>/dev/null || true

# Detect the funnel URL
TS_DNS_NAME=$(tailscale status --json | jq -r '.Self.DNSName' | sed 's/\.$//')
TS_FUNNEL_URL="https://${TS_DNS_NAME}"
echo "  ✓ Tailscale Funnel URL: ${TS_FUNNEL_URL}"

# ═══════════════════════════════════════════════════════════════════════════════
# Step 6: Create install directory
# ═══════════════════════════════════════════════════════════════════════════════
echo -e "${GREEN}[6/11] Creating install directory...${NC}"

mkdir -p "$INSTALL_DIR"
chown "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR"
echo "  ✓ $INSTALL_DIR (owned by $SERVICE_USER)"

# ═══════════════════════════════════════════════════════════════════════════════
# Step 7: Copy camera_stream_service.py
# ═══════════════════════════════════════════════════════════════════════════════
echo -e "${GREEN}[7/11] Installing camera_stream_service.py...${NC}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$SCRIPT_DIR/camera_stream_service.py" ]; then
    cp "$SCRIPT_DIR/camera_stream_service.py" "$INSTALL_DIR/camera_stream_service.py"
else
    echo -e "${RED}ERROR: camera_stream_service.py not found in $SCRIPT_DIR${NC}"
    exit 1
fi
chmod +x "$INSTALL_DIR/camera_stream_service.py"
chown "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR/camera_stream_service.py"
echo "  ✓ camera_stream_service.py installed"

# ═══════════════════════════════════════════════════════════════════════════════
# Step 8: Write go2rtc.yaml
# ═══════════════════════════════════════════════════════════════════════════════
echo -e "${GREEN}[8/11] Writing go2rtc.yaml...${NC}"

cat > "$INSTALL_DIR/go2rtc.yaml" << EOF
streams:
  camera: ${RTSP_URL}

api:
  listen: ":1984"

webrtc:
  listen: ":8555"
  candidates:
    - stun:8555

rtsp:
  listen: ""

log:
  level: info
EOF

chown "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR/go2rtc.yaml"
echo "  ✓ go2rtc.yaml written"

# ═══════════════════════════════════════════════════════════════════════════════
# Step 9: Write .env file
# ═══════════════════════════════════════════════════════════════════════════════
echo -e "${GREEN}[9/11] Writing .env file...${NC}"

cat > "$INSTALL_DIR/.env" << EOF
HUB_URL=${HUB_URL}
DRONE_ID=${DRONE_ID}
API_KEY=${API_KEY}
RTSP_URL=${RTSP_URL}
GO2RTC_API_PORT=1984
GO2RTC_WEBRTC_PORT=8555
TAILSCALE_FUNNEL_URL=${TS_FUNNEL_URL}
TAILSCALE_HOSTNAME=${TS_DNS_NAME}
EOF

chmod 600 "$INSTALL_DIR/.env"
chown "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR/.env"
echo "  ✓ .env written (mode 600)"

# ═══════════════════════════════════════════════════════════════════════════════
# Step 10: Write systemd unit files
# ═══════════════════════════════════════════════════════════════════════════════
echo -e "${GREEN}[10/11] Writing systemd unit files...${NC}"

# go2rtc.service
cat > /etc/systemd/system/go2rtc.service << EOF
[Unit]
Description=go2rtc — RTSP to WebRTC streaming
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${SERVICE_USER}
ExecStart=/usr/local/bin/go2rtc -config ${INSTALL_DIR}/go2rtc.yaml
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
echo "  ✓ go2rtc.service"

# tailscale-funnel.service
cat > /etc/systemd/system/tailscale-funnel.service << EOF
[Unit]
Description=Tailscale Funnel — expose go2rtc API publicly
After=tailscaled.service go2rtc.service
Wants=tailscaled.service

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/bin/tailscale funnel --bg --https=443 http://localhost:1984
ExecStop=/usr/bin/tailscale funnel --https=443 off

[Install]
WantedBy=multi-user.target
EOF
echo "  ✓ tailscale-funnel.service"

# camera-stream.service
cat > /etc/systemd/system/camera-stream.service << EOF
[Unit]
Description=Caribou Camera Stream Service — health monitor + Hub registration
After=go2rtc.service tailscale-funnel.service
Requires=go2rtc.service

[Service]
Type=simple
User=${SERVICE_USER}
EnvironmentFile=${INSTALL_DIR}/.env
ExecStart=/usr/bin/python3 ${INSTALL_DIR}/camera_stream_service.py \\
    --rtsp-url \${RTSP_URL} \\
    --hub-url \${HUB_URL} \\
    --drone-id \${DRONE_ID} \\
    --api-key \${API_KEY} \\
    --api-port \${GO2RTC_API_PORT} \\
    --webrtc-port \${GO2RTC_WEBRTC_PORT}
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF
echo "  ✓ camera-stream.service"

# ═══════════════════════════════════════════════════════════════════════════════
# Step 11: Enable and start services
# ═══════════════════════════════════════════════════════════════════════════════
echo -e "${GREEN}[11/11] Enabling and starting services...${NC}"

systemctl daemon-reload
systemctl enable go2rtc.service tailscale-funnel.service camera-stream.service
systemctl start go2rtc.service
sleep 2
systemctl start tailscale-funnel.service
sleep 1
systemctl start camera-stream.service

echo "  ✓ All services enabled and started"

# ═══════════════════════════════════════════════════════════════════════════════
# Done
# ═══════════════════════════════════════════════════════════════════════════════
echo ""
echo -e "${CYAN}╔══════════════════════════════════════════════════════════════╗"
echo -e "║              Installation Complete!                           ║"
echo -e "╚══════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo "Services:"
echo "  • go2rtc.service          — RTSP → WebRTC transcoding"
echo "  • tailscale-funnel.service — Public HTTPS tunnel"
echo "  • camera-stream.service   — Health monitor + Hub registration"
echo ""
echo "WHEP URL: ${TS_FUNNEL_URL}/api/webrtc?src=camera"
echo ""
echo "Useful commands:"
echo "  systemctl status go2rtc camera-stream"
echo "  journalctl -u camera-stream -f"
echo "  curl http://localhost:1984/api/streams"
echo ""
echo "Files:"
echo "  ${INSTALL_DIR}/camera_stream_service.py"
echo "  ${INSTALL_DIR}/go2rtc.yaml"
echo "  ${INSTALL_DIR}/.env"
echo ""
