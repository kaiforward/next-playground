/**
 * EconomyWorld — data interface for the economy processor.
 *
 * The adapter in `lib/tick/adapters/memory/economy.ts` implements this
 * interface. The fixed-interval system shard (which systems update this tick)
 * and the simulate→write loop live in the shared processor body
 * (`runEconomyProcessor`).
 *
 * See `docs/active/engineering/processor-architecture.md` for the broader pattern.
 */

import type { ModifierRow, ModifierCaps } from "@/lib/engine/events";
import type { EconomySimParams } from "@/lib/engine/tick";
import type { StrikeParams } from "@/lib/engine/population";

/**
 * Flat market row + the system context the processor needs. `goodId` is
 * already the canonical good key on the row, so the processor body never
 * thinks about resolution.
 */
export interface MarketView {
  /** Adapter-owned identifier — round-trips into `MarketUpdate.id`. */
  id: string;
  systemId: string;
  /** Owning region — the shard spans regions, so the body maps each system's
   *  region-targeted modifiers via this. */
  regionId: string;
  goodId: string;
  stock: number;
  /** Base production rate for this good. `undefined` means no built producer;
   *  `0` means built capacity is currently unable to produce due to staffing/skills. */
  baseProductionRate?: number;
  /** Base consumption rate for this good, if any. */
  baseConsumptionRate?: number;
  /** Stored local demand rate, read from `WorldMarket.demandRate`: civilian + industrial draw, the
   *  cycles-of-supply pricing denominator (see that field's doc — not the civilian-only footprint). */
  demandRate: number;
  /** THE USE FIGURE — the brake knee's warehousing denominator. The adapter resolves it from the
   *  persisted `WorldMarket.honestUseRate`, live-recomputing (never 0) where a legacy row lacks it. */
  honestUseRate: number;
  /** Built infrastructure storage capacity from the station market row. */
  storageCapacity: number;
  /** Reference-cycles the previous rationed economy streak had persisted (finite, [0,2]); missing reads as 0. */
  squeezeCycles?: number;
  /** Prior-cycle rolling realised-use rate (`WorldMarket.realisedUse`). Absent = unknown — the fold
   *  seeds from this cycle's observation rather than averaging against 0. */
  realisedUse?: number;
  /** Prior-cycle rolling steady-inbound rate (`WorldMarket.steadyInbound`). Absent = unknown. */
  steadyInbound?: number;
  /** Prior-cycle rolling late-inbound share (`WorldMarket.lateInboundShare`). Absent = unknown. */
  lateInboundShare?: number;
  /** Inbound credited since the last fold (`WorldMarket.inboundSinceFold`), written every tick by the
   *  goods-arrivals stage. A tick-scoped accumulator, not a rate: absent reads as 0. */
  inboundSinceFold?: number;
  /** The late-arriving share of `inboundSinceFold` (`WorldMarket.lateInboundSinceFold`). Absent reads as 0. */
  lateInboundSinceFold?: number;
}

/** Result of one market simulation step — written back via applyMarketUpdates. */
export interface MarketUpdate {
  id: string;
  stock: number;
  /** Active pricing-anchor multiplier from event modifiers (1 = none). */
  anchorMult: number;
  /** Consumption satisfaction actually applied this cycle (delivered ÷ demanded; 1 for non-consumers). */
  satisfaction: number;
  /** Realised output normalised to the reference economy interval. */
  realisedProductionRate: number;
  /** Whether strike or maintenance reduced production during this assessment. */
  productionSuppressed: boolean;
  /** The system's strike × maintenance production scalar this assessment, ∈ (0,1] — the same value on
   *  every row the system owns, unlike the per-market `productionSuppressed` bool above. */
  productionSuppressRate: number;
  /** Aggregated event production multiplier applied this assessment (1 = none). */
  productionMult: number;
  /** Reference-cycles a rationed economy assessment has persisted — a finite value in [0,2] advanced per
   *  assessment by the economy interval's catchUpFactor (2 = two reference cycles). */
  squeezeCycles: number;
  /** Folded rolling realised-use rate (`WorldMarket.realisedUse`), per reference cycle. Always written —
   *  seeded from this cycle's observation when no prior rate is stored. */
  realisedUse: number;
  /** Folded rolling steady-inbound rate (`WorldMarket.steadyInbound`), per reference cycle. Always written. */
  steadyInbound: number;
  /** Folded rolling late-inbound share (`WorldMarket.lateInboundShare`). `undefined` when this cycle
   *  credited nothing and no prior share exists — a 0/0 that must not be folded into a false 0. */
  lateInboundShare?: number;
  /** Zeroes `WorldMarket.inboundSinceFold` — this cycle's accumulator has just been folded into
   *  `steadyInbound`/`lateInboundShare` above. */
  inboundSinceFold: number;
  /** Zeroes `WorldMarket.lateInboundSinceFold`, alongside `inboundSinceFold`. */
  lateInboundSinceFold: number;
}

export interface EconomyWorld {
  /** All system ids, stable-sorted by id — the shard schedule's item list. */
  getSystemIds(): Promise<string[]>;

  /** Markets for the given systems (this tick's shard), with system info inlined. */
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

/** Per-tick params passed alongside the world, all sourced by `runWorldTick`. */
export interface EconomyProcessorParams {
  /** Ticks for the shard to refresh every system once (fixed gameplay cadence). */
  interval: number;
  /** Economy simulation params (brake-knee covers + ration cover). */
  simParams: EconomySimParams;
  /** Caps applied when aggregating event modifiers per market. */
  modifierCaps: ModifierCaps;
  /** Strike production-suppression regime derived from unrest. */
  strikeParams: StrikeParams;
  /** Per-system maintenance output malus (production multiplier, 1 = none) from the
   *  owning faction's latched maintenance funding. Missing system or omitted map → 1.
   *  Rides productionSuppress — flow-only, must never feed buildingUsed utilisation. */
  maintenanceMalusBySystem?: ReadonlyMap<string, number>;
}
