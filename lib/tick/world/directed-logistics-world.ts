/**
 * DirectedLogisticsWorld — data interface for the directed-logistics processor.
 * The adapter in `lib/tick/adapters/memory/directed-logistics.ts` implements it.
 * Sharding is PER-FACTION (matching needs all of a faction's systems at once), so the
 * adapter returns whole-faction system groups for the faction shard due this tick.
 */
import type { ResourceVector } from "@/lib/types/game";

/** One market's raw band inputs (mirrors the fields marketBandForRow consumes). */
export interface MarketRowForLogistics {
  id: string;
  goodId: string;
  stock: number;
  basePrice: number;
  anchorMult: number;
  demandRate: number;
  priceFloor: number;
  priceCeiling: number;
  storageCapacity: number;
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
  /** Append directed-logistics flow rows to the world flow log. */
  appendLogisticsFlows(flows: LogisticsFlowInsert[]): Promise<void>;
}
