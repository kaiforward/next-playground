import type { WorldFactionTreasury } from "@/lib/world/types";

/** One faction-owned developed system's tax base: heads for the heads tax,
 *  buildings for the maintenance bill. */
export interface TreasuryFactionSystemRow {
  systemId: string;
  factionId: string;
  population: number;
  buildings: Record<string, number>;
}

export interface TreasuryWorld {
  /** All faction treasuries (every faction has exactly one). */
  getTreasuries(): Promise<WorldFactionTreasury[]>;
  /** Faction-owned, economically active systems with the columns the taxes read. */
  getFactionSystems(): Promise<TreasuryFactionSystemRow[]>;
  /** Bulk-write settled/accrued treasury rows (matched by factionId). */
  applyTreasuryUpdates(updates: WorldFactionTreasury[]): Promise<void>;
}

/** Per-tick params sourced by `runWorldTick`. */
export interface TreasuryProcessorParams {
  /** Settlement cadence — the economy cycle length in ticks (settles on its cycle start). */
  interval: number;
  /** ECONOMY_SCALE, for normalising S-scaled tax bases at collection. */
  economyScale: number;
  /** Construction points absorbed per faction this tick (directed-build's export). Empty map mid-cycle. */
  constructionWorkByFaction: ReadonlyMap<string, number>;
  /** Logistics work-budget consumed per faction this tick (raw, S-scaled). Empty map mid-cycle. */
  logisticsWorkByFaction: ReadonlyMap<string, number>;
  /**
   * Founding money committed per faction this tick — charter fees and staged materials, already
   * valued in money (directed-build's export). A settlement input, not instrumentation: it is
   * charged off the top at the next settlement, ahead of the funding ladder.
   */
  foundingDebitsByFaction: ReadonlyMap<string, number>;
  rates: {
    headsTaxPerCycle: number;
    headsWeights: { unskilled: number; technicians: number; engineers: number };
    productionTaxRate: number;
    referenceValues: Record<string, number>;
    maintenanceRatePerWork: number;
    constructionRatePerWork: number;
    logisticsRatePerWork: number;
  };
}
