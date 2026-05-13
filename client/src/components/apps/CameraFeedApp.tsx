import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useDroneSelection } from "@/hooks/useDroneSelection";
import { useStreamConfigStorage } from "@/hooks/useStreamConfigStorage";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Radio,
  Plus,
  Loader2,
  VideoOff,
  Maximize2,
  Minimize2,
  Settings,
  X,
  GripVertical,
} from "lucide-react";

// ─── Types ─────────────────────────────────────────────────────────────────

import type { StreamConfig } from "@/hooks/useStreamConfigStorage";

type StreamSource =
  | { type: "drone"; droneId: string }
  | { type: "url"; url: string };

type ConnState = "idle" | "connecting" | "connected" | "error";



// ─── WebRTC Helper ─────────────────────────────────────────────────────────

async function connectWebRTC(
  url: string,
  videoEl: HTMLVideoElement,
  onConnected: () => void,
  onDisconnected: (reason: string) => void
): Promise<RTCPeerConnection> {
  const pc = new RTCPeerConnection({
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
    ],
    iceCandidatePoolSize: 4,
  });

  // Receive-only transceivers
  pc.addTransceiver("video", { direction: "recvonly" });
  pc.addTransceiver("audio", { direction: "recvonly" });

  // Track handler
  pc.ontrack = (event) => {
    if (event.streams[0]) {
      videoEl.srcObject = event.streams[0];
      onConnected();
    }
  };

  // Connection state monitoring
  pc.onconnectionstatechange = () => {
    const s = pc.connectionState;
    if (s === "disconnected" || s === "failed" || s === "closed") {
      onDisconnected(`Connection ${s}`);
    }
  };
  pc.oniceconnectionstatechange = () => {
    if (pc.iceConnectionState === "failed") {
      onDisconnected("ICE negotiation failed");
    }
  };

  // Create offer
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  // Wait for ICE gathering (max 3s)
  await new Promise<void>((resolve) => {
    if (pc.iceGatheringState === "complete") return resolve();
    const timeout = setTimeout(resolve, 3000);
    pc.onicegatheringstatechange = () => {
      if (pc.iceGatheringState === "complete") {
        clearTimeout(timeout);
        resolve();
      }
    };
  });

  // Send SDP offer to server
  const sdpOffer = pc.localDescription!.sdp;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/sdp" },
    body: sdpOffer,
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new Error(`WHEP proxy returned ${response.status}: ${errText.slice(0, 200)}`);
  }

  const sdpAnswer = await response.text();
  await pc.setRemoteDescription({ type: "answer", sdp: sdpAnswer });

  return pc;
}

// ─── Quality helpers ───────────────────────────────────────────────────────

type Quality = "excellent" | "good" | "fair" | "poor" | "unknown";

function getQuality(rtt: number | null): Quality {
  if (rtt === null) return "unknown";
  if (rtt < 50) return "excellent";
  if (rtt < 100) return "good";
  if (rtt < 200) return "fair";
  return "poor";
}

function QualityBars({ quality }: { quality: Quality }) {
  const levels = { excellent: 4, good: 3, fair: 2, poor: 1, unknown: 0 };
  const colors = { excellent: "bg-green-400", good: "bg-green-400", fair: "bg-yellow-400", poor: "bg-red-400", unknown: "bg-zinc-500" };
  const filled = levels[quality];
  const color = colors[quality];

  return (
    <div className="flex items-end gap-[2px] h-3">
      {[1, 2, 3, 4].map((i) => (
        <div
          key={i}
          className={`w-[3px] rounded-sm ${i <= filled ? color : "bg-zinc-600"}`}
          style={{ height: `${i * 25}%` }}
        />
      ))}
    </div>
  );
}

// ─── Grid helper ───────────────────────────────────────────────────────────

function gridCols(count: number): string {
  if (count === 1) return "grid-cols-1";
  if (count <= 4) return "grid-cols-2";
  return "grid-cols-3";
}

// ─── StreamWidget ──────────────────────────────────────────────────────────

interface StreamWidgetProps {
  config: StreamConfig;
  drones: Array<{ id: number; droneId: string; name: string | null }>;
  onRemove: () => void;
  onUpdate: (updated: StreamConfig) => void;
  draggable: boolean;
  onDragStart: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: () => void;
  isDragOver: boolean;
}

function StreamWidget({
  config,
  drones,
  onRemove,
  onUpdate,
  draggable,
  onDragStart,
  onDragOver,
  onDrop,
  isDragOver,
}: StreamWidgetProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const prevBytesRef = useRef<number>(0);
  const prevTsRef = useRef<number>(0);
  const statsIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [connState, setConnState] = useState<ConnState>("idle");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [rtt, setRtt] = useState<number | null>(null);
  const [bitrate, setBitrate] = useState<number>(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [hovered, setHovered] = useState(false);

  // Settings state
  const [editTitle, setEditTitle] = useState(config.title);
  const [editSourceType, setEditSourceType] = useState<"drone" | "url">(config.source.type);
  const [editDroneId, setEditDroneId] = useState(config.source.type === "drone" ? config.source.droneId : "");
  const [editUrl, setEditUrl] = useState(config.source.type === "url" ? config.source.url : "");

  // Build signaling URL
  const signalingUrl = useMemo(() => {
    if (config.source.type === "drone") {
      return `/api/rest/camera/whep-proxy/${config.source.droneId}`;
    } else {
      return `/api/rest/camera/whep-proxy-url?target=${encodeURIComponent(config.source.url || "")}`;
    }
  }, [config.source]);

  // Connect WebRTC
  const connect = useCallback(async () => {
    if (!videoRef.current) return;
    // Cleanup existing
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    setConnState("connecting");
    setErrorMsg("");
    setRtt(null);
    setBitrate(0);

    try {
      const pc = await connectWebRTC(
        signalingUrl,
        videoRef.current,
        () => setConnState("connected"),
        (reason) => {
          setConnState("error");
          setErrorMsg(reason);
        }
      );
      pcRef.current = pc;
    } catch (err: any) {
      setConnState("error");
      setErrorMsg(err?.message || "Connection failed");
    }
  }, [signalingUrl]);

  // Auto-connect on mount and source change
  useEffect(() => {
    connect();
    return () => {
      if (pcRef.current) {
        pcRef.current.close();
        pcRef.current = null;
      }
      if (statsIntervalRef.current) {
        clearInterval(statsIntervalRef.current);
      }
    };
  }, [connect]);

  // Stats polling
  useEffect(() => {
    if (connState === "connected" && pcRef.current) {
      statsIntervalRef.current = setInterval(async () => {
        if (!pcRef.current) return;
        try {
          const stats = await pcRef.current.getStats();
          stats.forEach((report) => {
            if (report.type === "candidate-pair" && report.state === "succeeded" && report.currentRoundTripTime != null) {
              setRtt(Math.round(report.currentRoundTripTime * 1000));
            }
            if (report.type === "inbound-rtp" && report.kind === "video") {
              const now = Date.now();
              const bytes = report.bytesReceived || 0;
              if (prevTsRef.current > 0) {
                const dt = (now - prevTsRef.current) / 1000;
                if (dt > 0) {
                  const kbps = ((bytes - prevBytesRef.current) * 8) / dt / 1000;
                  setBitrate(Math.round(kbps));
                }
              }
              prevBytesRef.current = bytes;
              prevTsRef.current = now;
            }
          });
        } catch { /* ignore */ }
      }, 1500);
    }
    return () => {
      if (statsIntervalRef.current) {
        clearInterval(statsIntervalRef.current);
        statsIntervalRef.current = null;
      }
    };
  }, [connState]);

  // Fullscreen
  const toggleFullscreen = useCallback(() => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
    }
  }, []);

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  // Apply settings
  const applySettings = () => {
    const newSource: StreamConfig["source"] =
      editSourceType === "drone"
        ? { type: "drone", droneId: editDroneId || "" }
        : { type: "url", url: editUrl };
    onUpdate({ ...config, title: editTitle, source: newSource });
    setShowSettings(false);
  };

  const quality = getQuality(rtt);

  return (
    <div
      ref={containerRef}
      className={`relative bg-zinc-950 rounded-lg overflow-hidden aspect-video transition-transform ${
        isDragOver ? "ring-2 ring-primary scale-[0.98]" : ""
      }`}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Drag handle */}
      <div className="absolute left-0 top-0 bottom-0 w-6 flex items-center justify-center z-20 cursor-grab opacity-20 hover:opacity-60 transition-opacity">
        <GripVertical size={16} className="text-zinc-400" />
      </div>

      {/* Video element */}
      <video
        ref={videoRef}
        className={`w-full h-full object-contain ${connState === "connected" ? "block" : "hidden"}`}
        autoPlay
        muted
        playsInline
      />

      {/* Idle state */}
      {connState === "idle" && (
        <div className="absolute inset-0 flex items-center justify-center">
          <Radio size={48} className="text-zinc-600" />
        </div>
      )}

      {/* Connecting state */}
      {connState === "connecting" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 z-10">
          <Loader2 size={36} className="animate-spin text-blue-400 mb-2" />
          <p className="text-sm text-zinc-300">Connecting...</p>
        </div>
      )}

      {/* Error state */}
      {connState === "error" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 z-10">
          <VideoOff size={36} className="text-red-400 mb-2" />
          <p className="text-sm text-red-300 mb-2 max-w-[80%] text-center truncate">{errorMsg}</p>
          <Button
            variant="outline"
            size="sm"
            className="border-zinc-600 text-white hover:bg-zinc-700"
            onClick={connect}
          >
            Retry
          </Button>
        </div>
      )}

      {/* Top bar (hover reveal) */}
      <div
        className={`absolute top-0 left-0 right-0 bg-gradient-to-b from-black/70 to-transparent p-3 flex items-center justify-between z-20 transition-opacity ${
          hovered || isFullscreen ? "opacity-100" : "opacity-0"
        }`}
      >
        <span className="text-sm text-white font-medium truncate max-w-[40%]">
          {config.title}
        </span>

        <div className="flex items-center gap-2">
          {connState === "connected" && (
            <div className="flex items-center gap-1.5 text-xs text-zinc-300">
              <QualityBars quality={quality} />
              <span className="font-mono">{bitrate} kbps</span>
            </div>
          )}
          {connState === "connecting" && (
            <span className="text-xs text-blue-300 bg-blue-500/20 px-2 py-0.5 rounded">Connecting</span>
          )}

          {/* Settings popover */}
          <Popover open={showSettings} onOpenChange={setShowSettings}>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7 text-zinc-300 hover:text-white">
                <Settings size={14} />
              </Button>
            </PopoverTrigger>
            <PopoverContent
              className="w-72 bg-zinc-800 border-zinc-700"
              onInteractOutside={(e) => e.preventDefault()}
            >
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-zinc-400">Label</label>
                  <Input
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    className="mt-1 bg-zinc-700 border-zinc-600 text-white text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs text-zinc-400">Source</label>
                  <Tabs value={editSourceType} onValueChange={(v) => setEditSourceType(v as "drone" | "url")} className="mt-1">
                    <TabsList className="w-full bg-zinc-700">
                      <TabsTrigger value="drone" className="flex-1 text-xs">Drone stream</TabsTrigger>
                      <TabsTrigger value="url" className="flex-1 text-xs">Manual URL</TabsTrigger>
                    </TabsList>
                  </Tabs>
                  {editSourceType === "drone" ? (
                    <Select value={editDroneId} onValueChange={setEditDroneId}>
                      <SelectTrigger className="mt-2 bg-zinc-700 border-zinc-600 text-white text-sm">
                        <SelectValue placeholder="Select drone" />
                      </SelectTrigger>
                      <SelectContent>
                        {drones.map((d) => (
                          <SelectItem key={d.droneId} value={d.droneId}>
                            {d.name || d.droneId}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input
                      value={editUrl}
                      onChange={(e) => setEditUrl(e.target.value)}
                      placeholder="https://…/api/whep"
                      className="mt-2 bg-zinc-700 border-zinc-600 text-white text-sm"
                    />
                  )}
                </div>
                <div className="flex gap-2 justify-end">
                  <Button variant="ghost" size="sm" onClick={() => setShowSettings(false)} className="text-zinc-400">
                    Cancel
                  </Button>
                  <Button size="sm" onClick={applySettings}>Apply</Button>
                </div>
              </div>
            </PopoverContent>
          </Popover>

          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-zinc-300 hover:text-white"
            onClick={toggleFullscreen}
          >
            {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-zinc-300 hover:text-red-400"
            onClick={onRemove}
          >
            <X size={14} />
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── AddStreamDialog ───────────────────────────────────────────────────────

interface AddStreamDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  drones: Array<{ id: number; droneId: string; name: string | null }>;
  onAdd: (config: StreamConfig) => void;
}

function AddStreamDialog({ open, onOpenChange, drones, onAdd }: AddStreamDialogProps) {
  const [sourceType, setSourceType] = useState<"drone" | "url">("drone");
  const [selectedDrone, setSelectedDrone] = useState("");
  const [manualUrl, setManualUrl] = useState("");
  const [title, setTitle] = useState("");

  // Reset on open
  useEffect(() => {
    if (open) {
      setSourceType("drone");
      setSelectedDrone("");
      setManualUrl("");
      setTitle("");
    }
  }, [open]);

  const canAdd =
    sourceType === "drone" ? selectedDrone.length > 0 : manualUrl.length > 0;

  const handleAdd = () => {
    const source: StreamSource =
      sourceType === "drone"
        ? { type: "drone", droneId: selectedDrone }
        : { type: "url", url: manualUrl };

    const defaultTitle =
      sourceType === "drone"
        ? drones.find((d) => d.droneId === selectedDrone)?.name || selectedDrone
        : (() => {
            try {
              return new URL(manualUrl).hostname;
            } catch {
              return "Stream";
            }
          })();

    onAdd({
      id: crypto.randomUUID(),
      title: title || defaultTitle,
      source,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-zinc-800 border-zinc-700 text-white max-w-md">
        <DialogHeader>
          <DialogTitle>Add Stream</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div>
            <label className="text-sm text-zinc-400">Label (optional)</label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="My Camera"
              className="mt-1 bg-zinc-700 border-zinc-600 text-white"
            />
          </div>

          <div>
            <label className="text-sm text-zinc-400">Source</label>
            <Tabs value={sourceType} onValueChange={(v) => setSourceType(v as "drone" | "url")} className="mt-1">
              <TabsList className="w-full bg-zinc-700">
                <TabsTrigger value="drone" className="flex-1">Drone stream</TabsTrigger>
                <TabsTrigger value="url" className="flex-1">Manual URL</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          {sourceType === "drone" ? (
            <div>
              {drones.length > 0 ? (
                <Select value={selectedDrone} onValueChange={setSelectedDrone}>
                  <SelectTrigger className="bg-zinc-700 border-zinc-600 text-white">
                    <SelectValue placeholder="Select drone" />
                  </SelectTrigger>
                  <SelectContent>
                    {drones.map((d) => (
                      <SelectItem key={d.droneId} value={d.droneId}>
                        {d.name || d.droneId}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <p className="text-sm text-zinc-500">No drones with registered streams found.</p>
              )}
            </div>
          ) : (
            <Input
              value={manualUrl}
              onChange={(e) => setManualUrl(e.target.value)}
              placeholder="https://…/api/whep"
              className="bg-zinc-700 border-zinc-600 text-white"
            />
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} className="text-zinc-400">
            Cancel
          </Button>
          <Button onClick={handleAdd} disabled={!canAdd}>
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── CameraFeedApp (root) ──────────────────────────────────────────────────

export default function CameraFeedApp() {
  const { streams, updateStreams } = useStreamConfigStorage();
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [draggedIdx, setDraggedIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  // Fetch drones via shared hook
  const { selectedDrone, drones: rawDrones } = useDroneSelection("camera");
  const droneList = useMemo(
    () => (rawDrones || []).map((d: any) => ({ id: d.id, droneId: d.droneId, name: d.name })),
    [rawDrones]
  );

  // subscribe_camera: used by drone-type streams to subscribe to camera feeds
  // Each StreamWidget handles its own WebRTC connection using droneId: selectedDrone as fallback
  const _cameraChannel = selectedDrone ? `subscribe_camera:${selectedDrone}` : null;

  // Add stream
  const handleAddStream = useCallback(
    (config: StreamConfig) => {
      updateStreams([...streams, config]);
    },
    [streams, updateStreams]
  );

  // Remove stream
  const handleRemoveStream = useCallback(
    (id: string) => {
      updateStreams(streams.filter((s) => s.id !== id));
    },
    [streams, updateStreams]
  );

  // Update stream config
  const handleUpdateStream = useCallback(
    (updated: StreamConfig) => {
      updateStreams(streams.map((s) => (s.id === updated.id ? updated : s)));
    },
    [streams, updateStreams]
  );

  // Drag-and-drop reorder
  const handleDrop = useCallback(
    (dropIdx: number) => {
      if (draggedIdx === null || draggedIdx === dropIdx) return;
      const next = [...streams];
      const [moved] = next.splice(draggedIdx, 1);
      next.splice(dropIdx, 0, moved);
      updateStreams(next);
      setDraggedIdx(null);
      setDragOverIdx(null);
    },
    [draggedIdx, streams, updateStreams]
  );

  return (
    <div className="h-full flex flex-col bg-zinc-900">
      {/* Header */}
      <div className="border-b border-zinc-800 px-4 py-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Radio size={16} className="text-zinc-500" />
          <span className="text-sm font-medium text-white">Camera Feeds</span>
          {streams.length > 0 && (
            <span className="text-xs bg-zinc-700 text-zinc-300 px-1.5 py-0.5 rounded">
              {streams.length}
            </span>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          className="border-zinc-700 text-zinc-300 hover:text-white hover:bg-zinc-800 text-xs"
          onClick={() => setShowAddDialog(true)}
        >
          <Plus size={14} className="mr-1" />
          Add stream
        </Button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        {streams.length === 0 ? (
          /* Empty state */
          <div className="h-full flex flex-col items-center justify-center text-center">
            <div className="w-16 h-16 rounded-full bg-zinc-800 flex items-center justify-center mb-4">
              <Radio size={28} className="text-zinc-500" />
            </div>
            <h3 className="text-lg font-medium text-white mb-1">No streams</h3>
            <p className="text-sm text-zinc-500 mb-4">
              Add a camera stream to start viewing
            </p>
            <Button
              variant="outline"
              className="border-zinc-700 text-zinc-300 hover:text-white"
              onClick={() => setShowAddDialog(true)}
            >
              <Plus size={16} className="mr-2" />
              Add stream
            </Button>
          </div>
        ) : (
          /* Stream grid */
          <div className={`grid ${gridCols(streams.length)} gap-4`}>
            {streams.map((stream, idx) => (
              <StreamWidget
                key={stream.id}
                config={stream}
                drones={droneList}
                onRemove={() => handleRemoveStream(stream.id)}
                onUpdate={handleUpdateStream}
                draggable
                onDragStart={() => setDraggedIdx(idx)}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOverIdx(idx);
                }}
                onDrop={() => handleDrop(idx)}
                isDragOver={dragOverIdx === idx && draggedIdx !== idx}
              />
            ))}
          </div>
        )}
      </div>

      {/* Add Stream Dialog */}
      <AddStreamDialog
        open={showAddDialog}
        onOpenChange={setShowAddDialog}
        drones={droneList}
        onAdd={handleAddStream}
      />
    </div>
  );
}
