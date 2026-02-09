"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { GameWorldState } from "@/lib/types/game";

export function useGameWorld() {
  const [world, setWorld] = useState<GameWorldState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const refresh = useCallback(() => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    fetch("/api/game/world", { signal: controller.signal })
      .then((res) => res.json())
      .then((json) => {
        if (json.data) {
          setWorld(json.data);
          setError(null);
        } else if (json.error) {
          setError(json.error);
        }
      })
      .catch((err) => {
        if (err.name !== "AbortError") {
          console.error(err);
          setError("Failed to load game world.");
        }
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refresh();
    return () => abortRef.current?.abort();
  }, [refresh]);

  return { world, loading, error, refresh };
}
