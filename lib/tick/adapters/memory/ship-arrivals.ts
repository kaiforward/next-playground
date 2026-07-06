import type {
  ArrivingShipView,
  DockShipUpdate,
  ShipArrivalsWorld,
} from "@/lib/tick/world/ship-arrivals-world";
import type { WorldShip } from "@/lib/world/types";

/**
 * In-memory adapter for the ship-arrivals processor, over `World.ships`.
 *
 * Owns a mutable copy of the world's ships for one processor run; the caller
 * reads `ships` back via the public field once the processor returns.
 *
 * Phase 2 ships are ownerless (no `Player` entity exists yet — see
 * `WorldShip`'s doc comment), but the shared `ShipArrivalsWorld` interface
 * still requires a `playerId` per arriving ship (it drives the live game's
 * per-player `shipArrived` SSE event). There is no real value to supply until
 * fleets/players exist (Phase 3), so this adapter reports an empty string.
 */
export class InMemoryShipArrivalsWorld implements ShipArrivalsWorld {
  ships: WorldShip[];

  constructor(
    initial: { ships: WorldShip[] },
    private readonly systems: { id: string; name: string }[],
  ) {
    this.ships = initial.ships.map((s) => ({ ...s }));
  }

  getArrivingShips(currentTick: number): Promise<ArrivingShipView[]> {
    const nameById = new Map(this.systems.map((s) => [s.id, s.name]));
    const arriving = this.ships.filter(
      (s) =>
        s.status === "in_transit" &&
        s.arrivalTick !== null &&
        s.arrivalTick <= currentTick,
    );
    return Promise.resolve(
      arriving.map((s) => ({
        id: s.id,
        name: s.name,
        destinationSystemId: s.destinationSystemId,
        playerId: "",
        destination: s.destinationSystemId
          ? { name: nameById.get(s.destinationSystemId) ?? "Unknown" }
          : null,
      })),
    );
  }

  dockShip(update: DockShipUpdate): Promise<void> {
    this.ships = this.ships.map((s) =>
      s.id === update.shipId
        ? {
            ...s,
            status: "docked" as const,
            systemId: update.destinationSystemId,
            destinationSystemId: null,
            departureTick: null,
            arrivalTick: null,
          }
        : s,
    );
    return Promise.resolve();
  }
}
