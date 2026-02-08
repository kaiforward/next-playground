"use client";

import { useState, useEffect, useCallback } from "react";
import type { PlayerState } from "@/lib/types/game";

export function usePlayer() {
  const [player, setPlayer] = useState<PlayerState | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    fetch("/api/game/player")
      .then((res) => res.json())
      .then((json) => {
        if (json.data) setPlayer(json.data);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { player, loading, refresh };
}
