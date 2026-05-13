# Caribou Camera Feed — Multi-Stream Architecture

**Version:** May 2026
**Author:** Pan Robotics
**Status:** Fully implemented

---

## Overview

The Camera Feed application is a generic, multi-stream video viewer that allows users to add as many camera sources as they want. It is entirely camera-agnostic — any device that exposes an RTSP stream can be connected. Video is delivered to the browser via WebRTC (WHEP protocol) with sub-second latency. The Hub acts exclusively as a signaling relay; media flows peer-to-peer between the go2rtc instance on the companion computer and the user's browser.

This document describes the end-to-end architecture: companion-side streaming infrastructure, Hub REST and WebSocket endpoints, the WHEP SDP proxy, and the frontend multi-stream UI.

---

## System Context

### Streaming Pipeline

```
Any RTSP Camera ──RTSP──▶ go2rtc ──WebRTC──▶ Browser
                          (port 1984)    (peer-to-peer UDP)
                              │
                     Tailscale Funnel
                     (HTTPS signaling only)
                              │
                     Caribou Hub (WHEP SDP proxy)
```

The pipeline has three stages. First, the RTSP camera pushes its stream to go2rtc running on the companion computer. Second, go2rtc transcodes the stream for WebRTC delivery and exposes a WHEP signaling endpoint on its local API (port 1984). Third, Tailscale Funnel makes the go2rtc API reachable over the public internet via HTTPS. The Caribou Hub proxies WHEP SDP offers/answers between the browser and go2rtc so that the browser never needs to know the Tailscale hostname directly.

Video data (RTP/UDP) flows directly between go2rtc and the browser via ICE/STUN negotiation. No video bytes pass through the Hub server or the Tailscale tunnel.

### Communication Channels

| Channel | Protocol | Port | Purpose |
|---------|----------|------|---------|
| RTSP Ingest | RTSP (TCP) | Camera-dependent | Camera → go2rtc video feed |
| go2rtc API | HTTP | 1984 (local) | Health checks, stream status, WHEP signaling |
| go2rtc WebRTC | UDP | 8555 | ICE candidates and media transport |
| Tailscale Funnel | HTTPS | 443 | Public access to go2rtc API (signaling only) |
| Hub REST | HTTPS | — | Stream registration, WHEP SDP proxy |
| Hub WebSocket | WSS | — | Stream URL broadcasts to browser clients |

---

## Architecture Components

### 1. Companion Computer: Camera Stream Service

A single Python service (`camera_stream_service.py`) running on the Raspberry Pi manages the entire streaming pipeline for one RTSP source. The service is generic — it accepts any RTSP URL as its only required camera-related argument.

**Responsibilities:**

- Write go2rtc YAML configuration for the provided RTSP URL
- Start and manage the go2rtc process lifecycle (auto-restart on crash, up to 10 reconnects)
- Monitor stream health by polling the go2rtc `/api/streams` endpoint for active producers
- Auto-detect the Tailscale funnel URL via `tailscale status --json`
- Register the WHEP URL with the Caribou Hub via `POST /api/rest/camera/stream-register`
- Send heartbeat re-registrations every 5 minutes to keep the stream active
- Deregister the stream on graceful shutdown via `POST /api/rest/camera/stream-unregister`

**CLI Arguments:**

```
--rtsp-url         RTSP source URL (required, e.g., rtsp://192.168.1.100:8554/stream)
--hub-url          Caribou Hub server URL (from env: WEB_SERVER_URL)
--drone-id         Drone identifier (from env: DRONE_ID)
--api-key          API key for authentication (from env: API_KEY)
--api-port         go2rtc API port (default: 1984)
--webrtc-port      go2rtc WebRTC port (default: 8555)
--funnel-port      Tailscale funnel port (default: 443)
--public-url       Override auto-detected Tailscale URL
--skip-funnel      Skip Tailscale funnel setup
--debug            Enable debug logging
```

**Class: `WebRTCStreamingService`**

The main service class encapsulates all state and logic. It runs an async main loop that starts go2rtc, detects the Tailscale URL, registers with the Hub, and then enters a health-monitoring loop. If go2rtc crashes, the service restarts it automatically. If the stream becomes unhealthy (no producers), it waits for recovery before re-registering. The heartbeat timer ensures the Hub always has a fresh registration even if the initial registration was lost.

### 2. Companion Computer: go2rtc

[go2rtc](https://github.com/AlexxIT/go2rtc) is a lightweight, zero-dependency streaming server that handles RTSP ingest and WebRTC delivery. The camera stream service writes a YAML configuration file and starts go2rtc as a subprocess.

**Generated Configuration:**

```yaml
streams:
  camera: rtsp://<camera-ip>:<port>/<path>

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
```

The stream is always named `camera`. The RTSP listener is disabled (empty string) since go2rtc only needs to consume RTSP, not re-serve it.

### 3. Companion Computer: Tailscale Funnel

Tailscale Funnel exposes the go2rtc API port to the public internet over HTTPS. This is required because the companion computer sits behind NAT on the drone's local network. Only the WHEP signaling (SDP offer/answer exchange) passes through the funnel — actual video media uses direct UDP via ICE/STUN.

The camera stream service configures the funnel automatically:

```bash
tailscale serve --bg --https=443 http://localhost:1984
tailscale funnel 443 on
```

### 4. Caribou Hub: REST Endpoints

The Hub provides five camera-related REST endpoints, all authenticated via per-drone API keys.

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/rest/camera/stream-register` | POST | Companion registers its WHEP URL; Hub stores it in memory and broadcasts via WebSocket |
| `/api/rest/camera/stream-unregister` | POST | Companion deregisters on shutdown; Hub clears the URL and broadcasts |
| `/api/rest/camera/stream-status/:droneId` | GET | Frontend polls for the current WHEP URL of a drone |
| `/api/rest/camera/whep-proxy/:droneId` | POST | SDP relay — browser sends an SDP offer, Hub forwards it to the drone's registered WHEP URL, returns the SDP answer |
| `/api/rest/camera/whep-proxy-url` | POST | SDP relay for manual URL streams — browser provides a WHEP URL directly |

**Stream Registration Flow:**

1. Companion starts and detects its Tailscale funnel URL (e.g., `https://caribou-pi.tail12345.ts.net`)
2. Companion POSTs to `/api/rest/camera/stream-register` with `{ api_key, drone_id, whep_url: "https://caribou-pi.tail12345.ts.net/api/webrtc?src=camera" }`
3. Hub stores the WHEP URL in an in-memory map keyed by `droneId`
4. Hub broadcasts a `camera_stream` WebSocket event to all clients in the drone's camera room
5. Companion re-registers every 5 minutes (heartbeat) to keep the URL fresh

**WHEP SDP Proxy Flow:**

1. Browser creates an RTCPeerConnection and generates an SDP offer
2. Browser POSTs the offer to `/api/rest/camera/whep-proxy/:droneId`
3. Hub looks up the drone's registered WHEP URL
4. Hub forwards the SDP offer to the go2rtc WHEP endpoint on the companion (via Tailscale funnel)
5. go2rtc returns an SDP answer
6. Hub relays the SDP answer back to the browser
7. Browser and go2rtc complete ICE negotiation directly (peer-to-peer UDP)
8. Video flows directly between go2rtc and the browser — no further Hub involvement

### 5. Caribou Hub: WebSocket Events

| Event | Direction | Description |
|-------|-----------|-------------|
| `subscribe_camera` | Client → Server | Join a drone's camera room to receive stream URL updates |
| `unsubscribe_camera` | Client → Server | Leave a drone's camera room |
| `camera_stream` | Server → Client | Broadcast when a drone's WHEP URL is registered, updated, or removed |

### 6. Frontend: CameraFeedApp

The Camera Feed application is a multi-stream viewer built with React. Users can add, remove, and rearrange camera streams in a responsive grid.

**Key Features:**

| Feature | Description |
|---------|-------------|
| Multi-stream grid | Responsive layout: 1 column on mobile, 2 on tablet, 3 on desktop |
| Add Stream dialog | Two tabs: "From Drone" (select a registered drone with an active stream) and "Manual URL" (enter any WHEP URL) |
| Stream widget | Per-stream tile with video element, connection status, quality bars, label, and controls |
| Drag-and-drop reorder | Reorder stream tiles by dragging |
| Fullscreen toggle | Expand any stream to fill the viewport |
| Per-stream settings | Popover to change label or switch source |
| Connection quality | Real-time stats (bitrate, framerate, packet loss) displayed as quality bars |
| localStorage persistence | Stream configurations (source, label, order) persist across page reloads |

**WebRTC Connection (`connectWebRTC` helper):**

1. Create `RTCPeerConnection` with STUN server configuration
2. Add a `transceiver` for video (recvonly)
3. Create SDP offer
4. POST offer to Hub's WHEP proxy endpoint
5. Set remote description from SDP answer
6. Wait for ICE connection to establish
7. Poll `getStats()` every 2 seconds for quality metrics
8. On disconnect, attempt reconnection with exponential backoff

---

## Deployment

### Systemd Services

Three systemd services run on the companion computer for the camera pipeline:

| Service | Unit File | Description | Dependencies |
|---------|-----------|-------------|--------------|
| go2rtc | `go2rtc.service` | RTSP → WebRTC streaming server | network-online |
| Tailscale Funnel | `tailscale-funnel.service` | Exposes go2rtc API to internet | tailscaled, go2rtc |
| Camera Stream | `camera-stream.service` | go2rtc lifecycle manager + Hub registration | go2rtc, tailscale-funnel |

**Startup order:** `go2rtc` → `tailscale-funnel` → `camera-stream`

### Installation

The `install_camera_services.sh` script handles the full setup in 11 interactive steps:

1. Detect system architecture (ARM64, ARMv7, AMD64)
2. Download and install the go2rtc binary
3. Verify or install Tailscale
4. Authenticate Tailscale and enable HTTPS certificates
5. Configure Tailscale serve and funnel
6. Prompt for RTSP camera URL
7. Prompt for Hub URL, drone ID, and API key (or read from existing `forwarder.env`)
8. Write environment file with restricted permissions (`chmod 600`)
9. Install `camera_stream_service.py` to the service directory
10. Install all three systemd unit files
11. Enable and start all services

```bash
chmod +x install_camera_services.sh
sudo ./install_camera_services.sh
```

### Network Ports

| Service | Port | Protocol | Scope |
|---------|------|----------|-------|
| go2rtc API | 1984 | HTTP | localhost only |
| go2rtc WebRTC | 8555 | UDP | 0.0.0.0 (for ICE) |
| Tailscale Funnel | 443 | HTTPS | Public internet (signaling only) |

---

## Adding a New Camera

To add a new camera stream to the system:

1. **On the companion computer:** Run `install_camera_services.sh` with the RTSP URL of the new camera. Each companion computer runs one camera stream service instance.

2. **Automatic discovery:** Once the companion registers with the Hub, the drone appears in the "From Drone" tab of the Add Stream dialog in the Camera Feed app.

3. **Manual URL:** If the camera has a publicly accessible WHEP endpoint (e.g., another go2rtc instance with its own Tailscale funnel), users can add it directly via the "Manual URL" tab without any companion registration.

---

## Troubleshooting

### No Video in Browser

```bash
# Check go2rtc is running and has active producers
sudo systemctl status go2rtc
curl http://localhost:1984/api/streams

# Check Tailscale funnel is active
tailscale funnel status

# Check stream registration with Hub
sudo journalctl -u camera-stream -f
```

### Stream Registered but WebRTC Fails

```bash
# Verify the WHEP URL is reachable from outside
curl -X POST https://<tailscale-hostname>/api/webrtc?src=camera \
  -H "Content-Type: application/sdp" -d "..."

# Check firewall allows UDP on port 8555
sudo ufw status
```

### go2rtc Keeps Restarting

```bash
# Check if the RTSP URL is reachable
ffprobe rtsp://<camera-ip>:<port>/<path>

# Check go2rtc logs
sudo journalctl -u go2rtc -f

# Verify camera is powered and on the correct network
ping <camera-ip>
```

---

## References

1. [go2rtc](https://github.com/AlexxIT/go2rtc) — Universal camera streaming server
2. [WHEP Protocol](https://datatracker.ietf.org/doc/draft-murillo-whep/) — WebRTC-HTTP Egress Protocol
3. [Tailscale Funnel](https://tailscale.com/kb/1223/funnel) — Expose local services to the internet
4. Caribou Hub companion services reference (`companion_scripts/COMPANION_SERVICES.md`)
