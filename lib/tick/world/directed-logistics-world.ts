/**
 * DirectedLogisticsWorld — data interface for the directed-logistics processor.
 * Adapters in lib/tick/adapters/{prisma,memory}/directed-logistics.ts implement it.
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
  /** Map good KEY → DB good id (TradeFlow/market rows key differ from good KEY). */
  resolveGoodIds(): Promise<Map<string, string>>;
  /** Bulk absolute stock writes (already clamped). */
  applyMarketUpdates(updates: LogisticsMarketUpdate[]): Promise<void>;
  /** Append directed-logistics flow rows (flowType = "logistics"). */
  appendLogisticsFlows(flows: LogisticsFlowInsert[]): Promise<void>;
}
