# Caribou Network Architecture — Tailscale Mesh

**Status:** Design (agreed). Phase A (infra + Hub exposure) buildable now; Phase B
(pull data-plane) is a larger refactor specced here and implemented incrementally.

This document defines how Caribou Hubs and drones (Caribou System Units) reach
each other across the public internet, how access is scoped per fleet/operator,
and how the data plane works.

---

## 1. Goals & constraints

1. **No shared network.** Drones and Hubs are never on the same LAN — each is on
   its own internet uplink (drones over **4G/cellular**, Hubs over whatever they
   have). Benchtop testing over shared wifi is the only exception. The transport
   must work through CGNAT and arbitrary NATs.
2. **Fleets.** One Hub instance manages a **fleet of drones**, each drone with a
   **unique payload loadout** and therefore a unique set of endpoints/interactions.
3. **Multi-operator & isolation.** Multiple Hub instances may attach to the **same**
   drones (e.g. two operators monitoring one fleet), or a fleet may be **isolated**
   to a single operator. Access must be policy-driven, not hard-wired.
4. **Flexible & scalable.** Onboarding a drone or hub should be near-zero-touch;
   access rules should be declarative and auditable.

**Decision:** a single **Tailscale tailnet** per organisation, with tenancy
expressed by **ACL tags + grants**; cross-organisation sharing handled by
Tailscale **node sharing**. Everything is private to the tailnet — nothing is
exposed to the public internet (no Funnel for control/telemetry).

---

## 2. Why Tailscale

- **Mesh over any network.** WireGuard-based; direct peer-to-peer with DERP relay
  fallback. Works over 4G/CGNAT with no port-forwarding. Solves constraint #1.
- **Stable identity & addressing.** Every node gets a stable Tailscale IP and a
  **MagicDNS** name (`<node>.<tailnet>.ts.net`) independent of its physical network.
- **Policy as code.** Tags + grants in a single ACL file express which hubs may
  reach which drones, on which ports — covering constraints #2–#3.
- **Zero-touch onboarding.** Tagged, pre-authorised, ephemeral auth keys (or an
  OAuth client) let a freshly-imaged drone/hub join with the right tags on boot.

---

## 3. Topology

```
        Operator browsers                         Operator browsers
        (Tailscale on laptop/tablet)              (Tailscale)
                 │                                       │
                 ▼                                       ▼
        ┌──────────────────┐                    ┌──────────────────┐
        │  Hub  (tag:hub)  │   …more hubs…       │  Hub  (tag:hub)  │
        │  op1.<tnet>.ts.net│                    │  op2.<tnet>.ts.net│
        └────────┬─────────┘                    └────────┬─────────┘
                 │            T A I L S C A L E   M E S H │
                 └───────────────────┬────────────────────┘
                                     │  (encrypted, over 4G / any internet)
        ┌──────────────┬─────────────┼─────────────┬──────────────┐
        ▼              ▼             ▼             ▼              ▼
  caribou-001    caribou-002    caribou-003   caribou-004    caribou-00N
  tag:drone      tag:drone      tag:drone     tag:drone      tag:drone
  tag:fleet-acme tag:fleet-acme tag:fleet-acme tag:fleet-blue tag:fleet-blue
  ── each exposes its own services on its MagicDNS name ──
     • go2rtc WHEP  :1984        • telemetry/data stream  • payload endpoints
```

**Node roles**

| Role | Tag(s) | Notes |
|---|---|---|
| Hub instance | `tag:hub`, `tag:hub-<operator>` | Runs the Caribou Hub server; serves the UI to operators (§7). |
| Drone / System Unit | `tag:drone`, `tag:fleet-<name>` | Onboard Pi CM5; exposes services over the tailnet (§6). |
| Operator device | (user identity, not a tag) | Laptop/tablet running Tailscale + a browser; reaches its hub(s). |

---

## 4. Addressing & discovery

- **MagicDNS** gives every node a stable name: `caribou-001.<tailnet>.ts.net`,
  `op1.<tailnet>.ts.net`. Names survive IP/network changes.
- The Hub's **`drones` table** is the registry. Each drone row records its
  Tailscale name (or IP) alongside `droneId`. When a drone registers (or is added
  in Drone Configuration), the Hub stores how to reach it on the tailnet.
- A drone advertises its concrete service endpoints to its hub(s) at registration
  (camera WHEP, telemetry stream, per-payload endpoints) using its **own MagicDNS
  name** — never a public/Funnel URL.

---

## 5. Access control — two independent layers

Reachability and authorisation are separate concerns. A packet must pass **both**.

### Layer 1 — Tailscale ACL (network reachability)

Tag nodes by **role** and **tenant/fleet**, then write **grants**. Example intent
(full policy in [`infra/tailscale/acl.hujson`](../../infra/tailscale/acl.hujson)):

- `tag:hub-acme` → may reach `tag:fleet-acme` on the service ports.
- Two operators, same fleet: grant both `tag:hub-op1` and `tag:hub-op2` to
  `tag:fleet-shared`.
- Isolated fleet: grant `tag:fleet-blue` to exactly one hub tag.
- Drones cannot reach each other (no drone↔drone grant) — least privilege.

This is where **shared vs isolated fleets** and **multi-operator** are decided,
declaratively, in one auditable file.

### Layer 2 — Hub drone-registry + per-drone API keys (application authz)

Tailscale says *"can these packets flow"*; the Hub's existing **per-drone API
keys** say *"is this hub authorised to use this drone's API."* A hub only manages
drones it has been registered + keyed for. So even inside a shared fleet, the
registration/key model is the fine-grained control over what each hub may do
(read vs command, which payloads, etc.).

> Net effect: Tailscale ACLs scope the *fleet*; API keys scope the *drone/operation*.

---

## 6. Data plane — drone-as-a-tailnet-service, hubs pull

**Decision: the drone is a service on the tailnet; hubs are clients that pull.**
This is what lets *any authorised hub* attach to the *same* drone (multi-operator)
without the drone having to know its hubs in advance, and it matches how the
camera already works (go2rtc is a service the Hub proxies).

### 6.1 What the drone (System Unit) exposes

On its MagicDNS name, the System Unit runs a small set of services:

| Service | Transport | Consumed by | Status |
|---|---|---|---|
| Camera | go2rtc WHEP `:1984` | Hub WHEP proxy → browser WebRTC | **exists** (move off Funnel, §8) |
| Telemetry / data stream | WebSocket or SSE | Hub subscribes, re-broadcasts to its browsers | **new** (`HubLink.py`, planned) |
| Payload endpoints | per-loadout (HTTP/WS) | Hub (app-specific) | **new**, per payload |
| Command / control | authenticated HTTP/WS | the controlling hub only | **new**, see 6.3 |

Each endpoint is gated by Tailscale ACLs (who can connect) and by an API key /
token the drone checks (which hub, what scope).

### 6.2 What the Hub does (becomes a client, not just an ingestor)

For each drone it manages, the Hub **opens an outbound connection to the drone's
tailnet service**, subscribes to its telemetry/data streams, and **re-broadcasts
over Socket.IO to that hub's browser clients** (the existing browser-facing
broadcast layer is unchanged). Multiple hubs each hold their own subscription to
the same drone → built-in multi-operator monitoring.

This **inverts** today's flow (companion `POST`s to Hub REST ingest). The REST
ingest endpoints can remain during transition (benchtop/push mode) and be retired
once the pull model lands; both can coexist behind a per-drone "mode" flag.

### 6.3 Commands (hub → drone)

Monitoring is many-hubs-read. **Control** must be single-writer to be safe. The
drone exposes a command endpoint that accepts commands only from the hub holding
the **active control lease** (a token the drone issues; one at a time). Other
hubs may observe but not command until the lease is released/transferred. (Detail
to finalise in Phase B; the existing job-queue/API-key machinery is the basis.)

---

## 7. Exposing the Hub UI to operators

Operators reach **their** Hub over the tailnet via **`tailscale serve`** (HTTPS
terminated on the tailnet, proxied to the Hub's local `:3000`):

```
https://op1.<tailnet>.ts.net   →   http://127.0.0.1:3000   (the Hub server)
```

- HTTPS + WebSocket (Socket.IO) pass through `tailscale serve` cleanly.
- No login is required because the **tailnet is the security boundary** — only
  the operator's own enrolled devices can reach it. (If a Hub ever needs to be
  Funnel'd to the *public* internet, a login gate must be added first — out of
  scope here.)
- `PUBLIC_BASE_URL` is set to the Hub's `https://<hub>.<tailnet>.ts.net` so the
  absolute URLs the Hub hands to drones (firmware/file jobs) are tailnet-routable.
- The dev server already sets `allowedHosts: true`; production serves static via
  Express (no host check).

See [`infra/tailscale/`](../../infra/tailscale/) for the `tailscale serve` systemd
unit and the Hub setup script.

---

## 8. Camera: tailnet-private instead of public Funnel

Today `camera_stream_service.py` exposes go2rtc via **Tailscale Funnel** (public
HTTPS) because the Hub used to be a public cloud server. Now that Hubs are on the
tailnet, the camera should be **tailnet-private**:

- go2rtc stays on the drone at `:1984`; the service registers
  `http://<drone>.<tailnet>.ts.net:1984/...` (its WHEP URL) with the Hub.
- The Hub's WHEP proxy reaches it over the tailnet; WebRTC media still flows
  peer-to-peer. **No public exposure.**
- Keep Funnel behind a `--public` flag only for the benchtop/no-tailnet case.

---

## 9. Provisioning at scale

- **Tagged, pre-authorised, ephemeral auth keys** (or a Tailscale **OAuth client**
  that mints tagged keys) are baked into the drone/hub image. On first boot the
  unit runs `tailscale up --authkey=… --advertise-tags=tag:drone,tag:fleet-<x>`
  and joins with the correct identity — **no manual device approval**.
- **Ephemeral** nodes are auto-removed when offline, keeping the device list clean
  for a churning fleet.
- ACL **`tagOwners`** authorise which auth keys/owners may claim which tags.
- See [`infra/tailscale/`](../../infra/tailscale/) for the join scripts.

---

## 10. Cross-organisation sharing (escape hatch)

For a hub in a **different** organisation/tailnet to reach a drone, use Tailscale
**node sharing**: share the specific drone node into the other tailnet. This is
explicit and per-node (good isolation) but a more manual flow than in-tailnet ACL
grants. Design single-tailnet-with-tenant-tags now; reach for sharing only when a
genuinely cross-org consumer appears.

---

## 11. Security model

- **Perimeter:** the tailnet. Unenrolled devices can reach nothing. No control or
  telemetry endpoint is on the public internet.
- **Segmentation:** ACL tags/grants enforce least-privilege between hubs, fleets,
  and drones; drones can't talk to each other.
- **Application authz:** per-drone API keys + (Phase B) a single-writer control
  lease.
- **Identity:** WireGuard keys per node; MagicDNS names; ephemeral tagged nodes
  for drones.
- **Auditing:** the ACL file is the single source of truth for access, in version
  control.

---

## 12. Mapping to current code & phased plan

**Phase A — infra + Hub exposure (buildable now, no behaviour change to push mode):**
- `docs/architecture/Tailscale_Network_Architecture.md` (this doc).
- `infra/tailscale/acl.hujson` — example policy (tags, grants, fleets, multi-op).
- `infra/tailscale/caribou-hub-serve.service` + `setup-hub-tailscale.sh` — HTTPS at
  the hub's `.ts.net`; document `PUBLIC_BASE_URL`.
- `infra/tailscale/setup-drone-tailscale.sh` — tagged ephemeral join for a System Unit.
- `camera_stream_service.py` — register the **tailnet** WHEP URL (Funnel behind a flag).

**Phase B — pull data-plane (larger; coexists with push during transition):**
- System Unit `HubLink.py` becomes a **tailnet service** (telemetry/data stream +
  payload + command endpoints) — designed here, built as the System Unit V1 lands.
- Hub gains an **outbound subscriber** that connects to each managed drone's tailnet
  service and re-broadcasts to browsers; REST ingest kept until retired.
- Control lease for single-writer commands.

**Unchanged:** the browser-facing Socket.IO broadcast layer, the `drones`/`apiKeys`
tables, the job queue (re-used for control), the local SQLite/file storage.

---

## 13. Open items to finalise in Phase B

- Telemetry stream transport from the drone: WebSocket vs SSE vs gRPC.
- Control-lease lifecycle (acquire/heartbeat/release/transfer) and UI.
- Per-payload endpoint discovery: static registration vs a capability manifest the
  drone advertises (preferred for heterogeneous loadouts).
- Whether the Hub subscribes directly to each drone, or a per-fleet aggregator
  reduces N×M connections at large scale.
