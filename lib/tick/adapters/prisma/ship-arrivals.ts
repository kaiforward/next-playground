import type { TxClient } from "@/lib/tick/types";
import type {
  ArrivingShipView,
  DockShipUpdate,
  ShipArrivalsWorld,
} from "@/lib/tick/world/ship-arrivals-world";

/** Live-game adapter for the ship-arrivals processor. */
export class PrismaShipArrivalsWorld implements ShipArrivalsWorld {
  constructor(private tx: TxClient) {}

  async getArrivingShips(currentTick: number): Promise<ArrivingShipView[]> {
    const rows = await this.tx.ship.findMany({
      relationLoadStrategy: "join",
      where: { status: "in_transit", arrivalTick: { lte: currentTick } },
      select: {
        id: true,
        name: true,
        destinationSystemId: true,
        playerId: true,
        destination: { select: { name: true } },
      },
    });

    return rows.map((s) => ({
      id: s.id,
      name: s.name,
      destinationSystemId: s.destinationSystemId,
      playerId: s.playerId,
      destination: s.destination ? { name: s.destination.name } : null,
    }));
  }

  async dockShip(update: DockShipUpdate): Promise<void> {
    await this.tx.ship.update({
      where: { id: update.shipId },
      data: {
        systemId: update.destinationSystemId,
        status: "docked",
        destinationSystemId: null,
        departureTick: null,
        arrivalTick: null,
      },
    });
  }
}
