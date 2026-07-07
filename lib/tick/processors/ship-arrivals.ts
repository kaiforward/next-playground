import type { TickProcessorResult, ShipArrivedPayload } from "../types";
import type { ShipArrivalsWorld } from "@/lib/tick/world/ship-arrivals-world";

/**
 * Pure processor body. Docks ships whose arrival tick has come due and
 * emits global `shipArrived` events (ships are ownerless in Phase 2 — see
 * `WorldShip`'s doc comment).
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
    });
  }

  return arrived.length > 0 ? { globalEvents: { shipArrived: arrived } } : {};
}
