/**
 * ShipArrivalsWorld — data interface for the ship-arrivals processor.
 *
 * The simulator has its own ship-arrival path
 * (`processSimShipArrivals` in `lib/engine/simulator/economy.ts`) and is
 * *not* migrated to this interface. The live orchestration follows the same
 * World pattern as the rest. See
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
