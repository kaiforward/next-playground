import type {
  TickProcessor,
  TickProcessorResult,
  ShipArrivedPayload,
  PlayerEventMap,
} from "../types";
import { PrismaShipArrivalsWorld } from "@/lib/tick/adapters/prisma/ship-arrivals";
import type { ShipArrivalsWorld } from "@/lib/tick/world/ship-arrivals-world";

/**
 * Pure processor body. Docks ships whose arrival tick has come due and
 * emits per-player `shipArrived` events. Live game owns the orchestration;
 * the simulator keeps its own ship arrival path (see ShipArrivalsWorld
 * doc-comment).
 */
export async function runShipArrivalsProcessor(
  world: ShipArrivalsWorld,
  ctx: { tick: number },
): Promise<TickProcessorResult> {
  const arrivingShips = await world.getArrivingShips(ctx.tick);
  if (arrivingShips.length === 0) return {};

  const arrived: ShipArrivedPayload[] = [];

  for (const ship of arrivingShips) {
    if (!ship.destinationSystemId) continue;

    await world.dockShip({
      shipId: ship.id,
      destinationSystemId: ship.destinationSystemId,
    });

    arrived.push({
      shipId: ship.id,
      shipName: ship.name,
      systemId: ship.destinationSystemId,
      destName: ship.destination?.name ?? "Unknown",
      playerId: ship.playerId,
    });
  }

  // Build per-player event payloads.
  const playerEvents = new Map<string, Partial<PlayerEventMap>>();
  for (const a of arrived) {
    const existing = playerEvents.get(a.playerId) ?? {};
    existing.shipArrived = existing.shipArrived
      ? [...existing.shipArrived, a]
      : [a];
    playerEvents.set(a.playerId, existing);
  }

  return { playerEvents };
}

// ── Live-game wiring ──────────────────────────────────────────────

export const shipArrivalsProcessor: TickProcessor = {
  name: "ship-arrivals",
  frequency: 1,

  async process(ctx): Promise<TickProcessorResult> {
    const world = new PrismaShipArrivalsWorld(ctx.tx);
    return runShipArrivalsProcessor(world, ctx);
  },
};
