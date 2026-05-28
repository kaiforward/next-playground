"use client";

import { useSuspenseQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/keys";
import type { GoodInfo } from "@/lib/types/game";
import type { GoodsResponse } from "@/lib/types/api";

/**
 * Loads the universal goods catalog. Cached for the session — goods are
 * static. `staleTime: Infinity` means the in-memory cache never refetches
 * after the initial load (the HTTP layer still has a 24h `max-age`).
 */
export function useGoods(): GoodInfo[] {
  const { data } = useSuspenseQuery({
    queryKey: queryKeys.goods,
    staleTime: Infinity,
    queryFn: async () => {
      const res = await fetch("/api/game/goods");
      if (!res.ok) throw new Error(`Failed to load goods (${res.status})`);
      const json: GoodsResponse = await res.json();
      if (json.error || !json.data) throw new Error(json.error ?? "Empty response");
      return json.data.goods;
    },
  });
  return data;
}
