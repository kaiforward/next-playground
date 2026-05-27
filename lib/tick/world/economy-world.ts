/**
 * EconomyWorld — data interface for the economy processor.
 *
 * Adapters in `lib/tick/adapters/{prisma,memory}/economy.ts` implement this
 * interface. Round-robin region selection and the simulate→write loop live in
 * the shared processor body (`runEconomyProcessor`).
 *
 * See `docs/design/active/processor-architecture.md` for the broader pattern.
 */

import type { GeneratedTrait } from "@/lib/engine/trait-gen";
import type { ModifierRow } from "@/lib/engine/events";
import type { EconomyType, GovernmentType } from "@/lib/types/game";
import type {
  EconomySimParams,
  ProsperityParams,
} from "@/lib/engine/tick";

/**
 * Region row needed for round-robin selection. Government no longer lives on
 * the region (factions own it per-system after Layer 2); see `MarketView.governmentType`.
 */
export interface RegionView {
  id: string;
  name: string;
}

/**
 * Flat market row + the system context the processor needs. Adapters
 * resolve `goodId` to its canonical key (live: maps via good.name; sim:
 * already canonical) so the processor body never thinks about that.
 */
export interface MarketView {
  /** Adapter-owned identifier — round-trips into `MarketUpdate.id`. */
  id: string;
  systemId: string;
  goodId: string;
  basePrice: number;
  supply: number;
  demand: number;
  economyType: EconomyType;
  /** Government of the system's owning faction — read per-market post-cutover. */
  governmentType: GovernmentType;
  /** Good IDs this economy type produces. */
  produces: string[];
  /** Good IDs this economy type consumes. */
  consumes: string[];
  /** Base production rate for this good at this economy type, if any. */
  baseProductionRate?: number;
  /** Base consumption rate for this good at this economy type, if any. */
  baseConsumptionRate?: number;
  /** System traits (already validated). */
  traits: GeneratedTrait[];
}

/** Prosperity + accumulated trade volume for one system. */
export interface ProsperityView {
  systemId: string;
  prosperity: number;
  tradeVolumeAccum: number;
}

/** Result of one market simulation step — written back via applyMarketUpdates. */
export interface MarketUpdate {
  id: string;
  supply: number;
  demand: number;
}

/**
 * Result of one prosperity step. `capturedVolume` is the trade volume that
 * fed into the prosperity calculation — adapters subtract it (clamped at 0)
 * from the running accumulator. Subtract-not-reset matters in live: trades
 * committed between `getProsperity` and `applyProsperityUpdates` aren't lost.
 */
export interface ProsperityUpdate {
  systemId: string;
  prosperity: number;
  capturedVolume: number;
}

export interface EconomyWorld {
  /** Regions, ordered alphabetically by name (round-robin source). */
  getRegions(): Promise<RegionView[]>;

  /** Markets in one region, with system + trait info inlined. */
  getMarketsForRegion(regionId: string): Promise<MarketView[]>;

  /**
   * Active economy modifiers targeting the given systems OR the region
   * itself. Returned as a flat list; the processor body indexes by
   * `targetType`/`targetId`.
   */
  getModifiers(
    systemIds: string[],
    regionId: string,
  ): Promise<ModifierRow[]>;

  /** Current prosperity + accumulated trade volume for the given systems. */
  getProsperity(systemIds: string[]): Promise<ProsperityView[]>;

  /** Bulk-write market supply/demand. */
  applyMarketUpdates(updates: MarketUpdate[]): Promise<void>;

  /** Bulk-write prosperity and subtract captured volume from accumulators. */
  applyProsperityUpdates(updates: ProsperityUpdate[]): Promise<void>;
}

/** Per-tick params passed alongside the world. Sim and live differ here. */
export interface EconomyProcessorParams {
  /** RNG for market noise. Live: Math.random. Sim: seeded. */
  rng: () => number;
  /** Economy simulation params (reversion, noise, clamps, equilibrium). */
  simParams: EconomySimParams;
  /** Prosperity decay/gain/range params. */
  prosperityParams: ProsperityParams;
  /** Caps applied when aggregating event modifiers per market. */
  modifierCaps: {
    minTargetMult: number;
    maxTargetMult: number;
    minMultiplier: number;
    maxMultiplier: number;
    minReversionMult: number;
  };
}
