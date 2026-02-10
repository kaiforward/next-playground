import type { TickProcessor, TickProcessorResult } from "../types";

interface ArrivedShip {
  shipId: string;
  systemId: string;
  playerId: string;
}

export const shipArrivalsProcessor: TickProcessor = {
  name: "ship-arrivals",
  frequency: 1,

  async process(ctx): Promise<TickProcessorResult> {
    const arrivingShips = await ctx.tx.ship.findMany({
      where: {
        status: "in_transit",
        arrivalTick: { lte: ctx.tick },
      },
      select: { id: true, destinationSystemId: true, playerId: true },
    });

    if (arrivingShips.length === 0) {
      return {};
    }

    const arrived: ArrivedShip[] = [];

    for (const ship of arrivingShips) {
      if (ship.destinationSystemId) {
        await ctx.tx.ship.update({
          where: { id: ship.id },
          data: {
            systemId: ship.destinationSystemId,
            status: "docked",
            destinationSystemId: null,
            departureTick: null,
            arrivalTick: null,
          },
        });
        arrived.push({
          shipId: ship.id,
          systemId: ship.destinationSystemId,
          playerId: ship.playerId,
        });
      }
    }

    // Group arrivals by player for scoped events
    const playerEvents = new Map<string, Record<string, unknown[]>>();
    for (const a of arrived) {
      const existing = playerEvents.get(a.playerId) ?? {};
      existing["shipArrived"] = [...(existing["shipArrived"] ?? []), a];
      playerEvents.set(a.playerId, existing);
    }

    return { playerEvents };
  },
};
