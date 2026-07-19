import type { TickContext, TickProcessorResult } from "../types";
import { isPulseTick, catchUpFactor } from "@/lib/tick/shard";
import {
  headsTaxIncome,
  productionTaxIncome,
  maintenanceBill,
  settleLadder,
  safeMoney,
} from "@/lib/engine/treasury";
import { computeSystemLabourSnapshot } from "@/lib/engine/industry";
import { TAX_LEVEL_RATE_MULT } from "@/lib/constants/treasury";
import type {
  WorldFactionTreasury,
  WorldTreasurySettlement,
  TreasuryIncomeBySystem,
  TreasuryMaintenanceLine,
} from "@/lib/world/types";
import type { TreasuryWorld, TreasuryProcessorParams } from "@/lib/tick/world/treasury-world";

const EMPTY_REALIZED: ReadonlyMap<string, ReadonlyMap<string, number>> = new Map();

/**
 * Monthly treasury settlement: collect both tax lines from the month just
 * produced, then pay bills in the fixed ladder maintenance → logistics →
 * construction; the paid fraction per band latches as that band's effective
 * funding for the following month. Off the month pulse the body only accrues
 * work performed by band pulses (bills charge work performed, not standing
 * capacity — the standing-cost job belongs to maintenance).
 *
 * Heads tax and maintenance are monthly rates → scaled by catchUpFactor here;
 * realized production and work quantities arrive already catchUp-scaled from
 * their own pulses and are never rescaled. Logistics work is S-scaled and is
 * normalised by economyScale at accrual; realized production at collection.
 */
export async function runTreasuryProcessor(
  world: TreasuryWorld,
  ctx: TickContext,
  params: TreasuryProcessorParams,
): Promise<TickProcessorResult> {
  const treasuries = await world.getTreasuries();
  if (treasuries.length === 0) return {};

  const settles = isPulseTick(ctx.tick, params.interval);
  const hasWork =
    params.constructionWorkByFaction.size > 0 || params.logisticsWorkByFaction.size > 0;
  if (!settles && !hasWork) return {};

  const scale =
    Number.isFinite(params.economyScale) && params.economyScale > 0 ? params.economyScale : 1;
  const rawCatchUp = catchUpFactor(params.interval);
  const catchUp = Number.isFinite(rawCatchUp) && rawCatchUp > 0 ? rawCatchUp : 1;
  const realizedBySystem =
    ctx.results.get("economy")?.economySignals?.realizedProductionBySystem ?? EMPTY_REALIZED;

  const systemsByFaction = new Map<string, { systemId: string; population: number; buildings: Record<string, number> }[]>();
  if (settles) {
    for (const s of await world.getFactionSystems()) {
      const list = systemsByFaction.get(s.factionId) ?? [];
      list.push(s);
      systemsByFaction.set(s.factionId, list);
    }
  }

  const updates: WorldFactionTreasury[] = [];
  for (const t of treasuries) {
    // Work signals cross a processor boundary — coerce here so neither the
    // off-pulse pendingWork write nor the on-pulse bills → lastSettlement path
    // can carry a non-finite value into persisted state (settleLadder sanitises
    // internally but never returns a sanitised bill).
    const pendingConstruction = safeMoney(
      t.pendingWork.construction + (params.constructionWorkByFaction.get(t.factionId) ?? 0),
    );
    const pendingLogistics = safeMoney(
      t.pendingWork.logistics + (params.logisticsWorkByFaction.get(t.factionId) ?? 0) / scale,
    );

    if (!settles) {
      if (
        pendingConstruction !== t.pendingWork.construction ||
        pendingLogistics !== t.pendingWork.logistics
      ) {
        updates.push({
          ...t,
          pendingWork: { construction: pendingConstruction, logistics: pendingLogistics },
          updatedAtTick: ctx.tick,
        });
      }
      continue;
    }

    const rateMult = TAX_LEVEL_RATE_MULT[t.taxLevel];
    const systems = systemsByFaction.get(t.factionId) ?? [];

    let headsIncome = 0;
    let productionIncome = 0;
    const incomeBySystem: TreasuryIncomeBySystem[] = [];
    const levelsByType = new Map<string, number>();
    for (const s of systems) {
      const alloc = computeSystemLabourSnapshot(s.buildings, s.population).basis;
      const heads =
        headsTaxIncome(alloc, params.rates.headsWeights, params.rates.headsTaxPerMonth, rateMult) *
        catchUp;
      const production = productionTaxIncome(
        realizedBySystem.get(s.systemId) ?? new Map<string, number>(),
        params.rates.referenceValues,
        params.rates.productionTaxRate,
        rateMult,
        scale,
      );
      headsIncome += heads;
      productionIncome += production;
      if (heads > 0 || production > 0) {
        incomeBySystem.push({ systemId: s.systemId, heads, production });
      }
      for (const [buildingType, count] of Object.entries(s.buildings)) {
        if (count > 0) levelsByType.set(buildingType, (levelsByType.get(buildingType) ?? 0) + count);
      }
    }

    const upkeep = maintenanceBill(levelsByType, params.rates.maintenanceRatePerWork);
    const bills = {
      maintenance: upkeep.total * catchUp,
      logistics: pendingLogistics * params.rates.logisticsRatePerWork,
      construction: pendingConstruction * params.rates.constructionRatePerWork,
    };
    const maintenanceByType: TreasuryMaintenanceLine[] = upkeep.byType.map((l) => ({
      buildingType: l.buildingType,
      amount: l.amount * catchUp,
    }));

    const income = headsIncome + productionIncome;
    const settled = settleLadder(t.balance, income, bills, t.bands);

    const lastSettlement: WorldTreasurySettlement = {
      tick: ctx.tick,
      headsIncome,
      productionIncome,
      incomeBySystem,
      maintenanceBill: bills.maintenance,
      maintenanceByType,
      logisticsBill: bills.logistics,
      constructionBill: bills.construction,
      paid: settled.paid,
    };

    updates.push({
      ...t,
      balance: settled.balance,
      funded: settled.funded,
      pendingWork: { construction: 0, logistics: 0 },
      lastSettlement,
      updatedAtTick: ctx.tick,
    });
  }

  if (updates.length > 0) await world.applyTreasuryUpdates(updates);
  return {};
}
