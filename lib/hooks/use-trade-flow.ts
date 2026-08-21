"use client";

import { useGameSlice } from "@/lib/store/use-game-store";
import { EMPTY_TRADE_FLOW } from "./empty-slices";
import type { TradeFlowEdgeInfo } from "@/lib/types/api";

/**
 * The directed-logistics overlay edge set, read from the store's `tradeFlow` slice. The array is
 * zeroed when the overlay toggle is off (`logisticsActive`) so the Pixi layer tears its particles
 * down immediately, even though the slice itself keeps riding every state frame regardless of the
 * toggle — the same "gate the reduction, not the read" posture `useSystemValueMap` documents.
 */
export function useTradeFlow(
  logisticsActive: boolean,
): { logisticsEdges: TradeFlowEdgeInfo[] } {
  const data = useGameSlice((state) => state.slices.tradeFlow ?? EMPTY_TRADE_FLOW);

  return {
    logisticsEdges: logisticsActive ? data.logisticsEdges : EMPTY_TRADE_FLOW.logisticsEdges,
  };
}
