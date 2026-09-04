/**
 * DirectedLogisticsWorld — data interface for the directed-logistics processor.
 * The adapter in `lib/tick/adapters/memory/directed-logistics.ts` implements it.
 * Sharding is PER-FACTION (matching needs all of a faction's systems at once), so the
 * adapter returns whole-faction system groups for the faction shard due this tick.
 */
import type { ResourceVector } from "@/lib/types/game";
import type { WorldPendingArrival } from "@/lib/world/types";

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
  /** Reference-cycle realised output; missing falls back to current capacity for old saves only. */
  realisedProductionRate?: number;
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
  /** The prior structural-shortfall level, read only so the processor can skip a no-op write; the
   *  matcher itself never reads it as a decision input. See `WorldMarket.unservedShortfall` for the
   *  full contract. */
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
  /** Per-resource extraction-work efficiency, threaded alongside `yields` — required, matching
   *  `TickSystem.extractionEff` (`lib/tick/rows.ts`): a fixture that omits it is a type error
   *  rather than a silent neutral-1.0 fallback that could mask a real deposit-grade effect. Pass
   *  `unitResourceVector()` when a fixture genuinely wants the neutral reading. */
  extractionEff: ResourceVector;
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

export interface UnservedShortfallUpdate {
  id: string;
  /** The unclosed part of the deficit (`UnservableDeficit.shortfall`: its want less the capacity its
   *  reachable donors still held) — strictly positive for a market this run classified structurally
   *  unservable, and exactly `0` for one it did not. The size is the whole classification: the engine
   *  only records an entry where that residue is positive, so `0` can only mean servable, and it is
   *  how the world layer knows to clear the key back to absent. */
  unservedShortfall: number;
}

/** One lane's booked/blocked load after this run's matching — `RouteBooker.loads()` written back
 *  for EVERY lane in the network, zero for one no faction touched this run (the reset: a lane
 *  loaded last run and left idle this run must read back to 0, not keep a stale figure). */
export interface LaneLoadUpdate {
  key: string;
  bookedLoad: number;
  blockedVolume: number;
}

/** One dispatched haul, written to the scheduled-freight ledger at dispatch time — see
 *  `WorldPendingArrival`. `id` is minted by the caller (`DirectedLogisticsProcessorParams.mintId`). */
export type PendingArrivalInsert = WorldPendingArrival;

export interface DirectedLogisticsWorld {
  /** Total distinct faction groups (incl. one null/independents group) — drives the shard split. */
  getFactionShardKeys(): Promise<Array<string | null>>;
  /** All systems (with markets) belonging to the given faction keys. */
  getSystemsForFactions(factionKeys: Array<string | null>): Promise<SystemLogisticsRow[]>;
  /** Bulk absolute stock writes (already clamped) — donor debits only; dispatch never credits a
   *  destination (docs/planned/logistics-lanes.md §3: the arrivals stage credits on delivery). */
  applyMarketUpdates(updates: LogisticsMarketUpdate[]): Promise<void>;
  /** Apply changed wanted-but-unfunded assessments without rewriting stock. */
  applyFundingBoundUpdates(updates: LogisticsFundingBoundUpdate[]): Promise<void>;
  /** Apply changed structural-unservable assessments without rewriting stock. */
  applyUnservedShortfallUpdates(updates: UnservedShortfallUpdate[]): Promise<void>;
  /** Write this run's booked/blocked load for every lane in the network. */
  applyLaneLoadUpdates(updates: LaneLoadUpdate[]): Promise<void>;
  /** Append dispatched hauls to the scheduled-freight ledger. */
  appendPendingArrivals(arrivals: PendingArrivalInsert[]): Promise<void>;
}
