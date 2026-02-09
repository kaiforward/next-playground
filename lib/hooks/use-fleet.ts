"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { FleetState } from "@/lib/types/game";

export function useFleet() {
  const [fleet, setFleet] = useState<FleetState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const refresh = useCallback(() => {
    // Abort any in-flight request to prevent stale data overwrites
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    fetch("/api/game/fleet", { signal: controller.signal })
      .then((res) => res.json())
      .then((json) => {
        if (json.data) {
          setFleet(json.data);
          setError(null);
        } else if (json.error) {
          setError(json.error);
        }
      })
      .catch((err) => {
        if (err.name !== "AbortError") {
          console.error(err);
          setError("Failed to load fleet data.");
        }
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refresh();
    return () => abortRef.current?.abort();
  }, [refresh]);

  return { fleet, loading, error, refresh };
}
