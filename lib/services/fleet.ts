import { prisma } from "@/lib/prisma";
import { serializeShip } from "@/lib/auth/serialize";
import { ServiceError } from "./errors";
import type { FleetState } from "@/lib/types/game";

/**
 * Get the full fleet state for a player (credits + ships with cargo/system).
 * Throws ServiceError(404) if player not found.
 */
export async function getFleet(playerId: string): Promise<FleetState> {
  const player = await prisma.player.findUnique({
    where: { id: playerId },
    include: {
      ships: {
        include: {
          cargo: { include: { good: true } },
          system: true,
          destination: true,
        },
      },
    },
  });

  if (!player) {
    throw new ServiceError("Player not found.", 404);
  }

  return {
    id: player.id,
    userId: player.userId,
    credits: player.credits,
    ships: player.ships.map(serializeShip),
  };
}
