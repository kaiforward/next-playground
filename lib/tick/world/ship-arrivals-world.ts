/**
 * ShipArrivalsWorld — data interface for the ship-arrivals processor.
 *
 * Implemented by `InMemoryShipArrivalsWorld` (`lib/tick/adapters/memory/
 * ship-arrivals.ts`), which `runWorldTick` wires into the shared pipeline. See
 * `docs/design/active/processor-architecture.md` for the broader pattern.
 */

/** Snapshot of a ship that has arrived at its destination this tick. */
export interface ArrivingShipView {
  id: string;
  name: string;
  destinationSystemId: string | null;
  playerId: string;
  destination: { name: string } | null;
}

/** Dock write: status → "docked", clear destination/arrival columns. */
export interface DockShipUpdate {
  shipId: string;
  destinationSystemId: string;
}

export interface ShipArrivalsWorld {
  /** Ships marked `in_transit` whose `arrivalTick` has come due. */
  getArrivingShips(currentTick: number): Promise<ArrivingShipView[]>;

  /** Dock the ship: status → "docked", clear destination/arrival columns. */
  dockShip(update: DockShipUpdate): Promise<void>;
}
