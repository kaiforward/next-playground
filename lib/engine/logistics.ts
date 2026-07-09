/**
 * Pure builders for the per-system Logistics tab. The service in
 * `lib/services/trade-flow.ts` window-sums raw flow rows and feeds them
 * through these helpers to produce the panel-facing shape.
 *
 * Pure: no I/O. Safe to unit-test against in-memory data.
 */

import { GOODS, GOOD_TIER_BY_KEY } from "@/lib/constants/goods";
import type { SubstrateGoodRate } from "@/lib/engine/physical-economy";
import type { SystemFlowRow } from "@/lib/engine/system-trade-flow";
import type { LogisticsGoodRow, TradeFlowPartner } from "@/lib/types/api";

/** Per-good cross-border import/export totals plus top partners. */
export interface GoodFlowAggregate {
  importLogistics: number;
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
  importLogistics: 0, exportLogistics: 0,
  importPartners: [], exportPartners: [],
};

/**
 * Assemble the aligned, tier-grouped row model from prod/con rates and the
 * per-good flow aggregate. Goods active in either source appear; goods with
 * neither prod/con nor flow are dropped. Rows are ordered tier-ascending then
 * internal-net-descending (stable by goodId), so both columns share one order.
 *
 * `cyclesInWindow` normalises the imports/exports — which are SUMMED over the
 * whole flow-retention window — into a per-economy-cycle RATE, so the External
 * column shares units with the Internal production/consumption rates (both
 * per-cycle) and the two are directly comparable. Default 1 = raw window totals.
 * Partner quantities are normalised the same way so tooltips read in /cyc too.
 */
export function buildLogisticsRows(
  prodCon: ReadonlyArray<SubstrateGoodRate>,
  flowsByGood: ReadonlyMap<string, GoodFlowAggregate>,
  cyclesInWindow: number = 1,
  inputDemandByGood: ReadonlyMap<string, number> = new Map(),
): LogisticsRowModel {
  const norm = cyclesInWindow > 0 ? cyclesInWindow : 1;
  const normPartners = (ps: TradeFlowPartner[]): TradeFlowPartner[] =>
    norm === 1 ? ps : ps.map((p) => ({ ...p, quantity: p.quantity / norm }));

  const prodConByGood = new Map(prodCon.map((g) => [g.goodId, g]));
  const goodIds = new Set<string>([...prodConByGood.keys(), ...flowsByGood.keys(), ...inputDemandByGood.keys()]);

  const rows: LogisticsGoodRow[] = [];
  let internalMax = 0;
  let externalMax = 0;
  let activeGoodCount = 0;
  let tradedGoodCount = 0;

  for (const goodId of goodIds) {
    const pc = prodConByGood.get(goodId);
    const production = pc?.production ?? 0;
    const consumption = pc?.consumption ?? 0;
    const inputDemand = inputDemandByGood.get(goodId) ?? 0;
    const totalConsumption = consumption + inputDemand;
    const a = flowsByGood.get(goodId) ?? EMPTY_AGG;

    // Window sums → per-cycle rates (matches production/consumption units).
    const importLogistics = a.importLogistics / norm;
    const exportLogistics = a.exportLogistics / norm;

    const importTotal = importLogistics;
    const exportTotal = exportLogistics;
    const traded = importTotal > 0 || exportTotal > 0;
    const active = production > 0 || totalConsumption > 0;
    if (!active && !traded) continue;

    if (active) activeGoodCount++;
    if (traded) tradedGoodCount++;
    internalMax = Math.max(internalMax, production, totalConsumption);
    externalMax = Math.max(externalMax, importTotal, exportTotal);

    rows.push({
      goodId,
      goodName: GOODS[goodId]?.name ?? goodId,
      tier: GOOD_TIER_BY_KEY[goodId] ?? 0,
      production,
      consumption,
      inputDemand,
      internalNet: production - totalConsumption,
      importLogistics,
      exportLogistics,
      externalNet: exportTotal - importTotal,
      traded,
      importPartners: normPartners(a.importPartners),
      exportPartners: normPartners(a.exportPartners),
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

/** Partner systems shown per good in the import/export tooltips. */
const TOP_PARTNERS = 3;

/**
 * Aggregate one system's directed-logistics flow rows into per-good import/export
 * totals plus the top contributing partner systems for each direction.
 */
export function aggregateLogisticsFlows(
  flows: ReadonlyArray<SystemFlowRow>,
  systemId: string,
  resolveName: (id: string) => string,
): Map<string, GoodFlowAggregate> {
  interface Acc {
    importLogistics: number;
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
        importLogistics: 0, exportLogistics: 0,
        importByPartner: new Map(), exportByPartner: new Map(),
      };
      byGood.set(f.goodId, acc);
    }
    if (f.toSystemId === systemId) {
      acc.importLogistics += f.quantity;
      acc.importByPartner.set(f.fromSystemId, (acc.importByPartner.get(f.fromSystemId) ?? 0) + f.quantity);
    } else if (f.fromSystemId === systemId) {
      acc.exportLogistics += f.quantity;
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
      importLogistics: acc.importLogistics,
      exportLogistics: acc.exportLogistics,
      importPartners: topPartners(acc.importByPartner),
      exportPartners: topPartners(acc.exportByPartner),
    });
  }
  return out;
}
