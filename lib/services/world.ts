import { getWorld } from "@/lib/world/store";
import { tickLoop } from "@/lib/world/tick-loop";
import type { GameWorldState } from "@/lib/types/game";

/**
 * Current world meta plus tick-loop pacing state.
 * Throws ServiceError(409) via the store when no world is loaded.
 */
export function getGameWorld(): GameWorldState {
  return {
    meta: getWorld().meta,
    speed: tickLoop.getSpeed(),
    achievedTps: tickLoop.getAchievedTps(),
  };
}
