"use client";

import { useSuspenseQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/keys";
import type { MarketComparisonEntry } from "@/lib/types/game";
import type { MarketComparisonResponse } from "@/lib/types/api";

export function useMarketComparison(goodId: string): {
  goodId: string;
  entries: MarketComparisonEntry[];
} {
  const { data } = useSuspenseQuery({
    queryKey: queryKeys.marketByGood(goodId),
    queryFn: async () => {
      const res = await fetch(`/api/game/market/by-good/${goodId}`);
      if (!res.ok) throw new Error(`Failed to load market comparison (${res.status})`);
      const json: MarketComparisonResponse = await res.json();
      if (json.error || !json.data) throw new Error(json.error ?? "Empty response");
      return json.data;
    },
  });

  return data;
}
