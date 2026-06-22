/**
 * EconomyWorld — data interface for the economy processor.
 *
 * Adapters in `lib/tick/adapters/{prisma,memory}/economy.ts` implement this
 * interface. The fixed-interval system shard (which systems update this tick)
 * and the simulate→write loop live in the shared processor body
 * (`runEconomyProcessor`).
 *
 * See `docs/design/active/processor-architecture.md` for the broader pattern.
 */

import type { GeneratedTrait } from "@/lib/engine/trait-gen";
import type { ModifierRow, ModifierCaps } from "@/lib/engine/events";
import type { GovernmentType } from "@/lib/types/game";
import type { EconomySimParams } from "@/lib/engine/tick";
import type { StrikeParams } from "@/lib/engine/population";

/**
 * Flat market row + the system context the processor needs. Adapters
 * resolve `goodId` to its canonical key (live: maps via good.name; sim:
 * already canonical) so the processor body never thinks about that.
 */
export interface MarketView {
  /** Adapter-owned identifier — round-trips into `MarketUpdate.id`. */
  id: string;
  systemId: string;
  /** Owning region — the shard spans regions, so the body maps each system's
   *  region-targeted modifiers via this. */
  regionId: string;
  goodId: string;
  basePrice: number;
  stock: number;
  /** Government of the system's owning faction — read per-market. */
  governmentType: GovernmentType;
  /** Base production rate for this good, if any. */
  baseProductionRate?: number;
  /** Base consumption rate for this good, if any. */
  baseConsumptionRate?: number;
  /** Stored local demand rate (perCapitaNeed × population, floored at seed). */
  demandRate: number;
  /** Built infrastructure storage capacity from the station market row. */
  storageCapacity: number;
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
  /** All system ids, stable-sorted by id — the shard schedule's item list. */
  getSystemIds(): Promise<string[]>;

  /** Markets for the given systems (this tick's shard), with system + trait info inlined. */
  getMarketsForSystems(systemIds: string[]): Promise<MarketView[]>;

  /**
   * Active economy modifiers targeting the given systems OR any of the regions
   * those systems belong to. Returned as a flat list; the processor body
   * indexes by `targetType`/`targetId`.
   */
  getModifiers(systemIds: string[]): Promise<ModifierRow[]>;

  /** Bulk-write market stock. */
  applyMarketUpdates(updates: MarketUpdate[]): Promise<void>;

  /** Current unrest (0…1) for the given systems — drives strike suppression. */
  getUnrest(systemIds: string[]): Promise<Map<string, number>>;
}

/** Per-tick params passed alongside the world. Sim and live differ here. */
export interface EconomyProcessorParams {
  /** RNG for market noise. Live: Math.random. Sim: seeded. */
  rng: () => number;
  /** Ticks for the shard to refresh every system once (fixed gameplay cadence). */
  interval: number;
  /** Economy simulation params (noise fraction for relative-band noise). */
  simParams: EconomySimParams;
  /** Caps applied when aggregating event modifiers per market. */
  modifierCaps: ModifierCaps;
  /** Strike production-suppression regime derived from unrest. */
  strikeParams: StrikeParams;
}
