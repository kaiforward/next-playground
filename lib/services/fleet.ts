import { prisma } from "@/lib/prisma";
import { serializeShip } from "@/lib/auth/serialize";
import { ServiceError } from "./errors";
import { toOpMissionStatus, toMissionType } from "@/lib/types/guards";
import type { FleetState } from "@/lib/types/game";

/** Standard ship include for all fleet/ship queries. */
export const SHIP_INCLUDE = {
  cargo: { include: { good: true } },
  system: true,
  destination: true,
  upgradeSlots: true,
  convoyMember: true,
} as const;

/**
 * Get the full fleet state for a player (credits + ships with cargo/system).
 * Throws ServiceError(404) if player not found.
 */
export async function getFleet(playerId: string): Promise<FleetState> {
  const player = await prisma.player.findUnique({
    where: { id: playerId },
    include: {
      ships: {
        include: SHIP_INCLUDE,
      },
    },
  });

  if (!player) {
    throw new ServiceError("Player not found.", 404);
  }

  const shipIds = player.ships.map((s) => s.id);

  // Query active missions for player's ships (only in_progress has shipId set)
  const activeMissions = shipIds.length > 0
    ? await prisma.mission.findMany({
        where: {
          shipId: { in: shipIds },
          status: "in_progress",
        },
        select: {
          id: true,
          type: true,
          status: true,
          shipId: true,
        },
      })
    : [];

  const missionByShip = new Map(
    activeMissions
      .filter((m) => m.shipId !== null)
      .map((m) => [m.shipId!, { id: m.id, type: toMissionType(m.type), status: toOpMissionStatus(m.status) }]),
  );

  return {
    id: player.id,
    userId: player.userId,
    credits: player.credits,
    ships: player.ships.map((ship) =>
      serializeShip(ship, missionByShip.get(ship.id) ?? null),
    ),
  };
}
