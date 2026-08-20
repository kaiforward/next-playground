import type { TickProcessorResult } from "../types";
import type { ShipArrivalsWorld } from "@/lib/tick/world/ship-arrivals-world";

/**
 * Pure processor body. Docks ships whose arrival tick has come due (ships are ownerless in
 * Phase 2 — see `WorldShip`'s doc comment). Used to also emit a global arrival event; that
 * broadcast had zero subscribers (client-runtime measure, 2026-08-19) and was retired at Task 14
 * — this processor's only effect is the dock write below, unchanged.
 */
export async function runShipArrivalsProcessor(
  world: ShipArrivalsWorld,
  ctx: { tick: number },
): Promise<TickProcessorResult> {
  const arrivingShips = await world.getArrivingShips(ctx.tick);

  for (const ship of arrivingShips) {
    if (!ship.destinationSystemId) continue;

    await world.dockShip({
      shipId: ship.id,
      destinationSystemId: ship.destinationSystemId,
    });
  }

  return {};
}
