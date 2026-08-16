/**
 * DirectedLogisticsWorld — data interface for the directed-logistics processor.
 * The adapter in `lib/tick/adapters/memory/directed-logistics.ts` implements it.
 * Sharding is PER-FACTION (matching needs all of a faction's systems at once), so the
 * adapter returns whole-faction system groups for the faction shard due this tick.
 */
import type { ResourceVector } from "@/lib/types/game";

/**
 * One market's raw band inputs (mirrors the fields marketBandForRow consumes).
 * The good's price multiples are catalog constants, not row state — read them
 * from `GOODS[goodId]` alongside this row.
 */
export interface MarketRowForLogistics {
  id: string;
  goodId: string;
  stock: number;
  anchorMult: number;
  demandRate: number;
  /** Persisted use figure — what this system's population and industry draw when running.
   *  Missing ⇒ recompute live; never read a missing field as 0. */
  honestUseRate?: number;
  storageCapacity: number;
  /** Persisted consumption satisfaction from the last economy cycle (missing ⇒ 1). */
  satisfaction?: number;
  /** Reference-cycle realized output; missing falls back to current capacity for old saves only. */
  realizedProductionRate?: number;
  /** Strike or maintenance reduced production; event modifiers deliberately excluded. */
  productionSuppressed?: boolean;
  /** The owning system's strike × maintenance production scalar, ∈ (0,1]; missing ⇒ 1. */
  productionSuppressRate?: number;
  /** Aggregated event production multiplier applied last cycle; missing ⇒ 1. */
  productionMult?: number;
  /** Rationed-economy persistence clock: advanced by the cycle's reference-time span, saturated at 2. */
  squeezeCycles?: number;
  /** Structural-deficit persistence clock: advanced by the cycle's reference-time span, saturated at 2. */
  proposalCycles?: number;
  logisticsFundingBound?: boolean;
  /** The prior assessment, read only so the processor can skip a no-op write; the matcher itself
   *  never reads it as a decision input. See `WorldMarket.demandUnservable` for the full contract. */
  demandUnservable?: boolean;
  /** The prior level, read only so the processor can skip a no-op write when neither the bit nor the
   *  size changed. See `WorldMarket.unservedShortfall` for the full contract. */
  unservedShortfall?: number;
}

/** One system's logistics-relevant state. */
export interface SystemLogisticsRow {
  systemId: string;
  factionId: string | null;
  population: number;
  buildings: Record<string, number>;
  /** Per-resource effective yields, for inputDemandForGood / capacityGoodRates. */
  yields: ResourceVector;
  markets: MarketRowForLogistics[];
}

export interface LogisticsMarketUpdate {
  id: string;
  stock: number;
}

export interface LogisticsFundingBoundUpdate {
  id: string;
  logisticsFundingBound: boolean;
}

export interface DemandUnservableUpdate {
  id: string;
  demandUnservable: boolean;
  /** The unclosed deficit's level (`UnservableDeficit.shortfall`) — present iff `demandUnservable` is
   *  `true` on this same update; a closed row's update carries `demandUnservable: false` and omits
   *  this key, which is how the world layer clears it back to absent. */
  unservedShortfall?: number;
}

export interface LogisticsFlowInsert {
  tick: number;
  fromSystemId: string;
  toSystemId: string;
  goodId: string;
  quantity: number;
}

export interface DirectedLogisticsWorld {
  /** Total distinct faction groups (incl. one null/independents group) — drives the shard split. */
  getFactionShardKeys(): Promise<Array<string | null>>;
  /** All systems (with markets) belonging to the given faction keys. */
  getSystemsForFactions(factionKeys: Array<string | null>): Promise<SystemLogisticsRow[]>;
  /** Bulk absolute stock writes (already clamped). */
  applyMarketUpdates(updates: LogisticsMarketUpdate[]): Promise<void>;
  /** Apply changed wanted-but-unfunded assessments without rewriting stock. */
  applyFundingBoundUpdates(updates: LogisticsFundingBoundUpdate[]): Promise<void>;
  /** Apply changed structural-unservable assessments without rewriting stock. */
  applyDemandUnservableUpdates(updates: DemandUnservableUpdate[]): Promise<void>;
  /** Append directed-logistics flow rows to the world flow log. */
  appendLogisticsFlows(flows: LogisticsFlowInsert[]): Promise<void>;
}
