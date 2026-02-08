"use client";

import { useState, useEffect } from "react";
import type { UniverseData } from "@/lib/types/game";

export function useUniverse() {
  const [data, setData] = useState<UniverseData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/game/systems")
      .then((res) => res.json())
      .then((json) => {
        if (json.data) setData(json.data);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  return { data, loading };
}
