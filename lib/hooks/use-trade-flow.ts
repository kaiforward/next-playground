"use client";

import { useGameSlice } from "@/lib/store/use-game-store";
import { EMPTY_TRADE_FLOW } from "./empty-slices";
import type { TradeFlowEdgeInfo } from "@/lib/types/api";

/**
 * The directed-logistics edge set, read from the store's `tradeFlow` slice. The array is zeroed
 * when the Lanes map mode isn't active (`active`) so the Pixi layer tears its particles down
 * immediately, even though the slice itself keeps riding every state frame regardless of mode — the
 * same "gate the reduction, not the read" posture `useSystemValueMap` documents.
 */
export function useTradeFlow(
  active: boolean,
): { logisticsEdges: TradeFlowEdgeInfo[] } {
  const data = useGameSlice((state) => state.slices.tradeFlow ?? EMPTY_TRADE_FLOW);

  return {
    logisticsEdges: active ? data.logisticsEdges : EMPTY_TRADE_FLOW.logisticsEdges,
  };
}
