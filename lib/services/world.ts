import { prisma } from "@/lib/prisma";
import { ServiceError } from "./errors";
import type { GameWorldState } from "@/lib/types/game";

/**
 * Get the current game world state (tick info).
 * Throws ServiceError(500) if world not initialized.
 */
export async function getGameWorld(): Promise<GameWorldState> {
  const world = await prisma.gameWorld.findUnique({
    where: { id: "world" },
  });

  if (!world) {
    throw new ServiceError("Game world not initialized.", 500);
  }

  return {
    currentTick: world.currentTick,
    tickRate: world.tickRate,
  };
}
