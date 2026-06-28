/**
 * Pure builders for the per-system Logistics tab. The service in
 * `lib/services/trade-flow.ts` loads raw rows from Prisma and feeds them
 * through these helpers to produce the panel-facing shape.
 *
 * Pure: no Prisma, no I/O. Safe to unit-test against in-memory data.
 */

import { GOODS, GOOD_TIER_BY_KEY } from "@/lib/constants/goods";
import type { SubstrateGoodRate } from "@/lib/engine/physical-economy";
import type { SystemFlowRow } from "@/lib/engine/system-trade-flow";
import type { LogisticsGoodRow, TradeFlowPartner } from "@/lib/types/api";

/** Per-good cross-border flow totals (split by flow type) plus top partners. */
export interface GoodFlowAggregate {
  importMarket: number;
  importLogistics: number;
  exportMarket: number;
  exportLogistics: number;
  importPartners: TradeFlowPartner[];
  exportPartners: TradeFlowPartner[];
}

export interface LogisticsRowModel {
  rows: LogisticsGoodRow[];
  internalMax: number;
  externalMax: number;
  activeGoodCount: number;
  tradedGoodCount: number;
}

const EMPTY_AGG: GoodFlowAggregate = {
  importMarket: 0, importLogistics: 0, exportMarket: 0, exportLogistics: 0,
  importPartners: [], exportPartners: [],
};

/**
 * Assemble the aligned, tier-grouped row model from prod/con rates and the
 * per-good flow aggregate. Goods active in either source appear; goods with
 * neither prod/con nor flow are dropped. Rows are ordered tier-ascending then
 * internal-net-descending (stable by goodId), so both columns share one order.
 */
export function buildLogisticsRows(
  prodCon: ReadonlyArray<SubstrateGoodRate>,
  flowsByGood: ReadonlyMap<string, GoodFlowAggregate>,
): LogisticsRowModel {
  const prodConByGood = new Map(prodCon.map((g) => [g.goodId, g]));
  const goodIds = new Set<string>([...prodConByGood.keys(), ...flowsByGood.keys()]);

  const rows: LogisticsGoodRow[] = [];
  let internalMax = 0;
  let externalMax = 0;
  let activeGoodCount = 0;
  let tradedGoodCount = 0;

  for (const goodId of goodIds) {
    const pc = prodConByGood.get(goodId);
    const production = pc?.production ?? 0;
    const consumption = pc?.consumption ?? 0;
    const a = flowsByGood.get(goodId) ?? EMPTY_AGG;

    const importTotal = a.importMarket + a.importLogistics;
    const exportTotal = a.exportMarket + a.exportLogistics;
    const traded = importTotal > 0 || exportTotal > 0;
    const active = production > 0 || consumption > 0;
    if (!active && !traded) continue;

    if (active) activeGoodCount++;
    if (traded) tradedGoodCount++;
    internalMax = Math.max(internalMax, production, consumption);
    externalMax = Math.max(externalMax, importTotal, exportTotal);

    rows.push({
      goodId,
      goodName: GOODS[goodId]?.name ?? goodId,
      tier: GOOD_TIER_BY_KEY[goodId] ?? 0,
      production,
      consumption,
      internalNet: production - consumption,
      importMarket: a.importMarket,
      importLogistics: a.importLogistics,
      exportMarket: a.exportMarket,
      exportLogistics: a.exportLogistics,
      externalNet: exportTotal - importTotal,
      traded,
      importPartners: a.importPartners,
      exportPartners: a.exportPartners,
    });
  }

  rows.sort(
    (x, y) =>
      x.tier - y.tier ||
      y.internalNet - x.internalNet ||
      x.goodId.localeCompare(y.goodId),
  );

  return { rows, internalMax, externalMax, activeGoodCount, tradedGoodCount };
}

/** A flow row carrying its flow type, for the import/export split. */
export interface LogisticsFlowRow extends SystemFlowRow {
  flowType: string;
}

/** Partner systems shown per good in the import/export tooltips. */
const TOP_PARTNERS = 3;

/**
 * Aggregate one system's flow rows into per-good import/export totals split by
 * flow type ("logistics" = directed, anything else = market diffusion), plus
 * the top contributing partner systems for each direction.
 */
export function aggregateLogisticsFlows(
  flows: ReadonlyArray<LogisticsFlowRow>,
  systemId: string,
  resolveName: (id: string) => string,
): Map<string, GoodFlowAggregate> {
  interface Acc {
    importMarket: number;
    importLogistics: number;
    exportMarket: number;
    exportLogistics: number;
    importByPartner: Map<string, number>;
    exportByPartner: Map<string, number>;
  }
  const byGood = new Map<string, Acc>();

  for (const f of flows) {
    if (f.quantity <= 0) continue;
    let acc = byGood.get(f.goodId);
    if (!acc) {
      acc = {
        importMarket: 0, importLogistics: 0, exportMarket: 0, exportLogistics: 0,
        importByPartner: new Map(), exportByPartner: new Map(),
      };
      byGood.set(f.goodId, acc);
    }
    const directed = f.flowType === "logistics";
    if (f.toSystemId === systemId) {
      if (directed) acc.importLogistics += f.quantity;
      else acc.importMarket += f.quantity;
      acc.importByPartner.set(f.fromSystemId, (acc.importByPartner.get(f.fromSystemId) ?? 0) + f.quantity);
    } else if (f.fromSystemId === systemId) {
      if (directed) acc.exportLogistics += f.quantity;
      else acc.exportMarket += f.quantity;
      acc.exportByPartner.set(f.toSystemId, (acc.exportByPartner.get(f.toSystemId) ?? 0) + f.quantity);
    }
  }

  const topPartners = (m: Map<string, number>): TradeFlowPartner[] =>
    [...m.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, TOP_PARTNERS)
      .map(([id, quantity]) => ({ systemId: id, systemName: resolveName(id), quantity }));

  const out = new Map<string, GoodFlowAggregate>();
  for (const [goodId, acc] of byGood) {
    out.set(goodId, {
      importMarket: acc.importMarket,
      importLogistics: acc.importLogistics,
      exportMarket: acc.exportMarket,
      exportLogistics: acc.exportLogistics,
      importPartners: topPartners(acc.importByPartner),
      exportPartners: topPartners(acc.exportByPartner),
    });
  }
  return out;
}
