import type { TickContext, TickProcessorResult } from "../types";
import { isCycleStart, catchUpFactor } from "@/lib/tick/shard";
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
 * Per-cycle treasury settlement: collect both tax lines from the cycle just
 * produced, then pay bills in the fixed ladder maintenance → logistics →
 * construction; the paid fraction per band latches as that band's effective
 * funding for the following cycle. Off the cycle start the body only accrues
 * work performed by band cycles (bills charge work performed, not standing
 * capacity — the standing-cost job belongs to maintenance), plus the founding
 * money directed build has committed. Founding is not a band: it is charged
 * off the top, before the ladder runs, so it outranks every bill including the
 * maintenance floor.
 *
 * Heads tax and maintenance are per-cycle rates → scaled by catchUpFactor here;
 * realized production and work quantities arrive already catchUp-scaled from
 * their own cycles and are never rescaled. Logistics work is S-scaled and is
 * normalised by economyScale at accrual; realized production at collection.
 */
export async function runTreasuryProcessor(
  world: TreasuryWorld,
  ctx: TickContext,
  params: TreasuryProcessorParams,
): Promise<TickProcessorResult> {
  const treasuries = await world.getTreasuries();
  if (treasuries.length === 0) return {};

  const settles = isCycleStart(ctx.tick, params.interval);
  // Founding money is an accrual like the two work bands — a debit committed on a tick with no
  // work at all must still reach the next settlement, so it belongs in this guard.
  const hasAccruals =
    params.constructionWorkByFaction.size > 0 ||
    params.logisticsWorkByFaction.size > 0 ||
    params.foundingDebitsByFaction.size > 0;
  if (!settles && !hasAccruals) return {};

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
    // mid-cycle pendingWork write nor the cycle-start bills → lastSettlement path
    // can carry a non-finite value into persisted state (settleLadder sanitises
    // internally but never returns a sanitised bill).
    const pendingConstruction = safeMoney(
      t.pendingWork.construction + (params.constructionWorkByFaction.get(t.factionId) ?? 0),
    );
    const pendingLogistics = safeMoney(
      t.pendingWork.logistics + (params.logisticsWorkByFaction.get(t.factionId) ?? 0) / scale,
    );
    // Founding debits arrive already valued in money, so they are never S-normalised here — the
    // valuation seam did that when it priced the goods.
    const pendingFounding = safeMoney(
      t.pendingFounding + (params.foundingDebitsByFaction.get(t.factionId) ?? 0),
    );

    if (!settles) {
      if (
        pendingConstruction !== t.pendingWork.construction ||
        pendingLogistics !== t.pendingWork.logistics ||
        pendingFounding !== t.pendingFounding
      ) {
        updates.push({
          ...t,
          pendingWork: { construction: pendingConstruction, logistics: pendingLogistics },
          pendingFounding,
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
        headsTaxIncome(alloc, params.rates.headsWeights, params.rates.headsTaxPerCycle, rateMult) *
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
    // Founding is taken off the top: what the faction already committed to colonies leaves before
    // the ladder divides anything, so the charter keeps biting during the founding burst instead of
    // becoming a residual claimant. The floor is a guard only — directed build commits against
    // `balance − pendingFounding`, so the subtraction cannot legitimately go negative.
    const settled = settleLadder(safeMoney(t.balance - pendingFounding), income, bills, t.bands);

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
      charged: settled.charged,
      foundingExpense: pendingFounding,
    };

    updates.push({
      ...t,
      balance: settled.balance,
      funded: settled.funded,
      pendingWork: { construction: 0, logistics: 0 },
      pendingFounding: 0,
      lastSettlement,
      updatedAtTick: ctx.tick,
    });
  }

  if (updates.length > 0) await world.applyTreasuryUpdates(updates);
  return {};
}
