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
import type { ModifierRow, ModifierCaps } from "@/lib/engine/events";
import type { GovernmentType } from "@/lib/types/game";
import type { EconomySimParams } from "@/lib/engine/tick";

/**
 * Region row needed for round-robin selection. Government does not live on the
 * region (factions own it per-system); see `MarketView.governmentType`.
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
  stock: number;
  /** Government of the system's owning faction — read per-market. */
  governmentType: GovernmentType;
  /** Base production rate for this good, if any. */
  baseProductionRate?: number;
  /** Base consumption rate for this good, if any. */
  baseConsumptionRate?: number;
  /** System traits (already validated). */
  traits: GeneratedTrait[];
}

/** Result of one market simulation step — written back via applyMarketUpdates. */
export interface MarketUpdate {
  id: string;
  stock: number;
  /** Active pricing-anchor multiplier from event modifiers (1 = none). */
  anchorMult: number;
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

  /** Bulk-write market stock. */
  applyMarketUpdates(updates: MarketUpdate[]): Promise<void>;
}

/** Per-tick params passed alongside the world. Sim and live differ here. */
export interface EconomyProcessorParams {
  /** RNG for market noise. Live: Math.random. Sim: seeded. */
  rng: () => number;
  /** Economy simulation params (reversion, noise, clamps, equilibrium). */
  simParams: EconomySimParams;
  /** Caps applied when aggregating event modifiers per market. */
  modifierCaps: ModifierCaps;
}
