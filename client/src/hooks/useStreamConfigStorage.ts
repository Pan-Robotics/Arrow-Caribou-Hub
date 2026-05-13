import { useState, useCallback } from "react";

const STORAGE_KEY = "caribou-camera-streams";

interface StreamSource {
  type: "drone" | "url";
  droneId?: string;
  url?: string;
}

export interface StreamConfig {
  id: string;
  title: string;
  source: StreamSource;
}

/**
 * Hook to persist camera stream configurations to localStorage.
 * Encapsulates all localStorage access so that app components
 * do not reference localStorage directly.
 */
export function useStreamConfigStorage() {
  const [streams, setStreamsState] = useState<StreamConfig[]>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  const updateStreams = useCallback((next: StreamConfig[]) => {
    setStreamsState(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // localStorage may be unavailable
    }
  }, []);

  return { streams, updateStreams };
}
