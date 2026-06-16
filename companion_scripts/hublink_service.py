#!/usr/bin/env python3
"""
Caribou HubLink — drone-side tailnet stream service (Tailscale Phase B).

This is the drone-side counterpart of the Hub's outbound "pull" subscriber
(server/droneSubscriber.ts). Instead of the companion POSTing telemetry *to* the
Hub (push mode, telemetry_forwarder.py), the drone runs this small WebSocket
service on its tailnet (MagicDNS) address and the Hub(s) connect *in* and pull.
Any number of authorised Hubs may subscribe to the same drone simultaneously —
that is what makes multi-operator monitoring fall out for free.

Wire protocol (see docs/architecture/Caribou_Drone_Stream_Protocol.md):
  - Transport: WebSocket, JSON text frames, one connection per subscribing Hub.
  - Auth: the Hub presents its per-drone API key in the WebSocket subprotocol as
    "bearer.<key>"; the negotiated app subprotocol is "caribou.stream.v1".
  - Drone → Hub: {"type":"hello",...}, {"type":"telemetry",...},
    {"type":"camera_status",...}, {"type":"pointcloud",...}, {"type":"pong"},
    and control replies {"type":"lease_granted|lease_denied|lease_revoked|
    lease_released|command_result",...}.
  - Hub → Drone: {"type":"ping",...} (heartbeat), and control requests
    {"type":"lease_acquire|lease_heartbeat|lease_release|command",...}.
  - drone_id is NOT carried per-frame; the Hub injects it from the connection.
  - Control (Phase B2): the drone is the single lease arbiter — at most one Hub
    holds the control lease at a time; commands are accepted only from the holder.

Status: REFERENCE. The Caribou System Unit is early development — wire the
`telemetry_source` to the real MAVSDK/UAVCAN assembly (as telemetry_forwarder.py
does) when System Unit V1 lands. `--demo` emits synthetic telemetry so the pull
path can be exercised on the benchtop today.

Usage:
    python3 hublink_service.py --demo
    python3 hublink_service.py --host 0.0.0.0 --port 8765

Environment Variables:
    DRONE_ID    - Drone identifier (default: caribou_001), informational only.
    API_KEY     - Expected per-drone API key Hubs must present. If unset, any
                  bearer token is accepted (benchtop only — NOT for deployment).
    STREAM_HOST - Bind address (default: 0.0.0.0; reachable over the tailnet).
    STREAM_PORT - Listen port (default: 8765).
    UPDATE_RATE_HZ - Telemetry emit rate (default: 10).
    LEASE_TTL_MS - Control-lease lifetime without a heartbeat (default: 30000).

Requires: websockets>=12  (pip install websockets)

Author: Pan Robotics
"""

import os
import sys
import json
import math
import time
import uuid
import asyncio
import logging
import argparse
from datetime import datetime, timezone

try:
    import websockets
except ImportError:
    sys.stderr.write("ERROR: this service requires the 'websockets' package (pip install websockets)\n")
    sys.exit(1)

PROTOCOL_VERSION = 1
APP_SUBPROTOCOL = f"caribou.stream.v{PROTOCOL_VERSION}"

DRONE_ID = os.getenv("DRONE_ID", "caribou_001")
API_KEY = os.getenv("API_KEY", "")
STREAM_HOST = os.getenv("STREAM_HOST", "0.0.0.0")
STREAM_PORT = int(os.getenv("STREAM_PORT", "8765"))
UPDATE_RATE_HZ = float(os.getenv("UPDATE_RATE_HZ", "10"))
LEASE_TTL_MS = int(os.getenv("LEASE_TTL_MS", "30000"))


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _now_ms() -> int:
    return int(time.time() * 1000)


def _offered_subprotocols(websocket) -> list[str]:
    """Return the Sec-WebSocket-Protocol values the client offered, across
    websockets library versions."""
    headers = None
    req = getattr(websocket, "request", None)
    if req is not None and getattr(req, "headers", None) is not None:
        headers = req.headers
    else:
        headers = getattr(websocket, "request_headers", None)
    if headers is None:
        return []
    raw = headers.get("Sec-WebSocket-Protocol", "")
    return [p.strip() for p in raw.split(",") if p.strip()]


# ── Telemetry sources ────────────────────────────────────────────────────────

class DemoTelemetrySource:
    """Synthetic telemetry for benchtop testing of the pull path. Produces the
    same telemetry dict shape the REST ingest / push forwarder use, so the Hub
    treats pulled demo data identically to real data."""

    def __init__(self):
        self._t0 = time.monotonic()
        self._batt = 100.0

    def sample(self) -> dict:
        t = time.monotonic() - self._t0
        self._batt = max(0.0, self._batt - 0.01)
        return {
            "attitude": {
                "roll_deg": 5.0 * math.sin(t * 0.5),
                "pitch_deg": 3.0 * math.cos(t * 0.4),
                "yaw_deg": (t * 10.0) % 360.0,
                "timestamp": _now_iso(),
            },
            "position": {
                "latitude_deg": 51.5074 + 0.0001 * math.sin(t * 0.1),
                "longitude_deg": -0.1278 + 0.0001 * math.cos(t * 0.1),
                "absolute_altitude_m": 100.0 + 5.0 * math.sin(t * 0.2),
                "relative_altitude_m": 50.0 + 5.0 * math.sin(t * 0.2),
                "timestamp": _now_iso(),
            },
            "gps": {"num_satellites": 14, "fix_type": 3, "timestamp": _now_iso()},
            "battery_fc": {
                "voltage_v": 22.2 * (0.6 + 0.4 * self._batt / 100.0),
                "remaining_percent": self._batt,
                "timestamp": _now_iso(),
            },
            "in_air": True,
        }


# ── HubLink server ───────────────────────────────────────────────────────────

class HubLinkService:
    def __init__(self, telemetry_source, expected_key: str, rate_hz: float, logger, lease_ttl_ms: int = 30000):
        self.telemetry_source = telemetry_source
        self.expected_key = expected_key
        self.interval = 1.0 / rate_hz if rate_hz > 0 else 0.1
        self.logger = logger
        self.clients: set = set()
        # Single-writer control lease (drone is the authority). At most one Hub
        # holds it at a time. lease = {id, hub_id, websocket, expires_at_ms}.
        self.lease_ttl_ms = lease_ttl_ms
        self.lease = None

    # ── Control lease (drone-authoritative) ──

    def _lease_active(self) -> bool:
        return self.lease is not None and self.lease["expires_at_ms"] > _now_ms()

    def _grant_lease(self, hub_id: str, websocket) -> dict:
        self.lease = {
            "id": uuid.uuid4().hex,
            "hub_id": hub_id,
            "websocket": websocket,
            "expires_at_ms": _now_ms() + self.lease_ttl_ms,
        }
        self.logger.info(f"Control lease GRANTED to {hub_id} (lease {self.lease['id']})")
        return self.lease

    def _clear_lease(self, why: str):
        if self.lease:
            self.logger.info(f"Control lease cleared for {self.lease['hub_id']} ({why})")
        self.lease = None

    async def _handle_control(self, websocket, msg: dict) -> bool:
        """Handle a control/lease/command frame. Returns True if handled."""
        mtype = msg.get("type")

        if mtype == "lease_acquire":
            hub_id = msg.get("hub_id") or "unknown"
            req = msg.get("request_id")
            if not self._lease_active() or self.lease["hub_id"] == hub_id:
                lease = self._grant_lease(hub_id, websocket)
                await websocket.send(json.dumps({
                    "type": "lease_granted", "lease_id": lease["id"],
                    "ttl_ms": self.lease_ttl_ms, "request_id": req,
                }))
            else:
                await websocket.send(json.dumps({
                    "type": "lease_denied", "held_by": self.lease["hub_id"],
                    "reason": "held", "request_id": req,
                }))
            return True

        if mtype == "lease_heartbeat":
            if self._lease_active() and self.lease["id"] == msg.get("lease_id"):
                self.lease["expires_at_ms"] = _now_ms() + self.lease_ttl_ms
            return True

        if mtype == "lease_release":
            req = msg.get("request_id")
            if self.lease and self.lease["id"] == msg.get("lease_id"):
                lease_id = self.lease["id"]
                self._clear_lease("released by holder")
                await websocket.send(json.dumps({
                    "type": "lease_released", "lease_id": lease_id, "request_id": req,
                }))
            return True

        if mtype == "command":
            req = msg.get("request_id")
            lease_id = msg.get("lease_id")
            if self._lease_active() and self.lease["id"] == lease_id and self.lease["websocket"] is websocket:
                action = msg.get("action")
                params = msg.get("params") or {}
                self.logger.info(f"Executing command '{action}' params={params} (lease {lease_id})")
                # Reference: echo/ack. Production dispatches to payload handlers.
                await websocket.send(json.dumps({
                    "type": "command_result", "request_id": req, "ok": True,
                    "result": {"action": action, "accepted": True},
                }))
            else:
                await websocket.send(json.dumps({
                    "type": "command_result", "request_id": req, "ok": False,
                    "error": "no_control",
                }))
            return True

        return False

    async def _expiry_loop(self):
        """Revoke a lease whose holder stopped heart-beating."""
        while True:
            await asyncio.sleep(1.0)
            if self.lease and self.lease["expires_at_ms"] <= _now_ms():
                holder, ws, lease_id = self.lease["hub_id"], self.lease["websocket"], self.lease["id"]
                self._clear_lease("expired (no heartbeat)")
                try:
                    await ws.send(json.dumps({"type": "lease_revoked", "lease_id": lease_id, "reason": "expired"}))
                except Exception:
                    pass

    def _authorized(self, offered: list[str]) -> bool:
        token = None
        for p in offered:
            if p.startswith("bearer."):
                token = p[len("bearer."):]
                break
        if not self.expected_key:
            # Benchtop: no key configured — accept anything but warn loudly.
            self.logger.warning("No API_KEY set: accepting Hub without authentication (benchtop only)")
            return True
        return token is not None and token == self.expected_key

    async def handler(self, websocket):
        peer = getattr(websocket, "remote_address", None)
        offered = _offered_subprotocols(websocket)
        if not self._authorized(offered):
            self.logger.warning(f"Rejected unauthenticated Hub from {peer}")
            await websocket.close(1008, "unauthorized")
            return

        self.clients.add(websocket)
        self.logger.info(f"Hub subscribed from {peer} ({len(self.clients)} active)")
        try:
            await websocket.send(json.dumps({
                "type": "hello",
                "protocol": PROTOCOL_VERSION,
                "services": ["telemetry"],
            }))
            sender = asyncio.create_task(self._send_loop(websocket))
            receiver = asyncio.create_task(self._recv_loop(websocket))
            done, pending = await asyncio.wait(
                {sender, receiver}, return_when=asyncio.FIRST_COMPLETED
            )
            for task in pending:
                task.cancel()
        except websockets.ConnectionClosed:
            pass
        finally:
            self.clients.discard(websocket)
            # If this Hub held the lease, free it so others can take control.
            if self.lease and self.lease["websocket"] is websocket:
                self._clear_lease("holder disconnected")
            self.logger.info(f"Hub unsubscribed from {peer} ({len(self.clients)} active)")

    async def _send_loop(self, websocket):
        while True:
            sample = self.telemetry_source.sample()
            frame = {"type": "telemetry", "timestamp": _now_iso(), "telemetry": sample}
            await websocket.send(json.dumps(frame))
            await asyncio.sleep(self.interval)

    async def _recv_loop(self, websocket):
        async for raw in websocket:
            try:
                msg = json.loads(raw)
            except (ValueError, TypeError):
                continue
            if not isinstance(msg, dict):
                continue
            if msg.get("type") == "ping":
                await websocket.send(json.dumps({"type": "pong", "ts": msg.get("ts")}))
                continue
            await self._handle_control(websocket, msg)

    async def serve(self, host: str, port: int):
        self.logger.info(
            f"HubLink for drone '{DRONE_ID}' listening on ws://{host}:{port}/  "
            f"(subprotocol {APP_SUBPROTOCOL}, auth {'on' if self.expected_key else 'OFF'})"
        )
        expiry = asyncio.create_task(self._expiry_loop())
        try:
            async with websockets.serve(self.handler, host, port, subprotocols=[APP_SUBPROTOCOL]):
                await asyncio.Future()  # run forever
        finally:
            expiry.cancel()


def main():
    parser = argparse.ArgumentParser(description="Caribou HubLink drone-side tailnet stream service")
    parser.add_argument("--host", default=STREAM_HOST, help="Bind address (default: 0.0.0.0)")
    parser.add_argument("--port", type=int, default=STREAM_PORT, help="Listen port (default: 8765)")
    parser.add_argument("--rate", type=float, default=UPDATE_RATE_HZ, help="Telemetry rate Hz (default: 10)")
    parser.add_argument("--demo", action="store_true", help="Emit synthetic telemetry (benchtop testing)")
    parser.add_argument("--debug", action="store_true", help="Verbose logging")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.debug else logging.INFO,
        format="%(asctime)s [HubLink] %(levelname)s %(message)s",
    )
    logger = logging.getLogger("hublink")

    if args.demo:
        source = DemoTelemetrySource()
    else:
        # Production: replace with the real telemetry assembly (MAVSDK + UAVCAN),
        # mirroring telemetry_forwarder.py. Until the System Unit wires that in,
        # require --demo so the service never silently emits nothing.
        logger.error("No real telemetry source wired yet. Run with --demo for benchtop testing.")
        sys.exit(2)

    service = HubLinkService(source, API_KEY, args.rate, logger, lease_ttl_ms=LEASE_TTL_MS)
    try:
        asyncio.run(service.serve(args.host, args.port))
    except KeyboardInterrupt:
        logger.info("Shutting down")


if __name__ == "__main__":
    main()
