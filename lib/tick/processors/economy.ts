import type {
  TickContext,
  TickProcessorResult,
  EconomySignals,
  GlobalEventMap,
} from "../types";
import {
  brakeKnee,
  productionCeiling,
  type MarketTickEntry,
} from "@/lib/engine/tick";
import { simulateCoupledEconomyTick } from "@/lib/engine/supply-chain";
import type { ModifierRow } from "@/lib/engine/events";
import { resolveMarketTickEntry } from "@/lib/engine/market-tick-builder";
import type {
  EconomyProcessorParams,
  EconomyWorld,
  MarketUpdate,
  MarketView,
} from "@/lib/tick/world/economy-world";
import {
  dissatisfaction,
  strikeMultiplier,
  foldSupplyState,
  type GoodSatisfaction,
  type SupplyState,
} from "@/lib/engine/population";
import { cycleStartShard, isCycleStart, catchUpFactor } from "@/lib/tick/shard";

const DEBUG = process.env.DEBUG_ECONOMY === "1";

/**
 * The broadcast this processor emits on a tick where it resolves nothing.
 *
 * Exported because `runWorldTick` gates this stage's setup mid-cycle and so never
 * calls the body — it emits this instead, keeping the per-tick signal identical to
 * an ungated run. One definition so the gated and ungated paths can't diverge.
 */
export function economyMidCyclePayload(tick: number, interval: number): Partial<GlobalEventMap> {
  const iv = Math.max(1, Math.floor(interval));
  return { economyTick: [{ systemCount: 0, shardIndex: ((tick % iv) + iv) % iv, shardCount: iv }] };
}

/**
 * Pure processor body, run against the in-memory adapter by `runWorldTick`.
 * Per-run knobs the body must not hard-code (the production cover, modifier
 * caps, the strike regime) come in via `params`.
 *
 * Cycle resolution: on the boundary tick (`tick % interval === 0`) the
 * whole system list resolves at once via `cycleStartShard`; every other tick is a
 * no-op (empty window → no `economySignals`, so infrastructure-decay and
 * population skip too). Per-resolution production/consumption are scaled by
 * `catchUpFactor(interval)` so the wall-clock rate is constant and the
 * equilibrium stock is interval-invariant.
 */
export async function runEconomyProcessor(
  world: EconomyWorld,
  ctx: TickContext,
  params: EconomyProcessorParams,
): Promise<TickProcessorResult> {
  const { interval, simParams, modifierCaps, strikeParams, maintenanceMalusBySystem } = params;

  // Normalise the interval the same way cycleStartShard does so the reported shard
  // index/count can't diverge from the actual cycle boundary for a non-integer interval.
  const iv = Math.max(1, Math.floor(interval));
  const shardIndex = ((ctx.tick % iv) + iv) % iv;
  const emptyPayload = economyMidCyclePayload(ctx.tick, interval);
  // Mid-cycle before reading the world: the system list is fetched only for its
  // length, which cycleStartShard uses solely to distinguish "empty galaxy" — so mid-cycle
  // it cost a filter and a sort over every system to reach a foregone conclusion.
  if (!isCycleStart(ctx.tick, interval)) {
    return { globalEvents: emptyPayload };
  }

  const allSystemIds = await world.getSystemIds();
  const { start, end } = cycleStartShard(allSystemIds.length, ctx.tick, interval);
  if (start >= end) {
    return { globalEvents: emptyPayload };
  }

  const shardSystemIds = allSystemIds.slice(start, end);
  const markets = await world.getMarketsForSystems(shardSystemIds);
  if (markets.length === 0) {
    return { globalEvents: emptyPayload };
  }

  // The shard spans regions, so a region-targeted modifier applies only to the
  // systems in THAT region (not the whole slice). Map each system's region, then
  // attach region-targeted mods by region and system-targeted mods by system.
  const systemIds = [...new Set(markets.map((m) => m.systemId))];
  const regionBySystem = new Map<string, string>();
  for (const m of markets) regionBySystem.set(m.systemId, m.regionId);

  const rawModifiers = await world.getModifiers(systemIds);
  const regionModsByRegion = new Map<string, ModifierRow[]>();
  for (const mod of rawModifiers) {
    if (mod.targetType === "region" && mod.targetId) {
      const arr = regionModsByRegion.get(mod.targetId) ?? [];
      arr.push(mod);
      regionModsByRegion.set(mod.targetId, arr);
    }
  }
  const modifiersBySystem = new Map<string, ModifierRow[]>();
  for (const sysId of systemIds) {
    const regionId = regionBySystem.get(sysId);
    const regionMods = regionId ? regionModsByRegion.get(regionId) ?? [] : [];
    modifiersBySystem.set(sysId, [...regionMods]);
  }
  for (const mod of rawModifiers) {
    if (mod.targetType === "system" && mod.targetId) {
      modifiersBySystem.get(mod.targetId)?.push(mod);
    }
  }

  // Read stored unrest from the previous tick to derive per-system strike multipliers.
  const unrestBySystem = await world.getUnrest(systemIds);
  const productionSuppressBySystem = new Map<string, number>();
  for (const systemId of systemIds) {
    const productionSuppress =
      strikeMultiplier(unrestBySystem.get(systemId) ?? 0, strikeParams) *
      (maintenanceMalusBySystem?.get(systemId) ?? 1);
    productionSuppressBySystem.set(systemId, productionSuppress);
  }
  // The multiplier is a property of the SYSTEM (its unrest and maintenance funding), but the flag it
  // raises is a property of the MARKET: a good with no output of its own has nothing to suppress, so
  // the malus reduces it by definition zero. Recording the flag per system instead marked every good
  // at a striking world as suppressed, including ones it has never produced — which the build planner
  // reads as "a strike explains this shortfall" and so refuses to propose the capacity that would end
  // it. A striking world may be a bad exporter; it is not thereby well supplied.
  const marketSuppressed = (m: MarketView): boolean =>
    (productionSuppressBySystem.get(m.systemId) ?? 1) < 1 && (m.baseProductionRate ?? 0) > 0;

  // Build tick entries via the shared market-tick builder. Government modifiers
  // are resolved per-market (a shard slice contains systems owned by different
  // factions) rather than once per region. Strike suppression is production-only
  // — consumption is unaffected by labor action. The catch-up factor scales the
  // per-update production AND consumption symmetrically (band geometry — demand
  // anchor + storage — is rate-independent and stays untouched).
  const catchUp = catchUpFactor(interval);
  const resolved = markets.map((m) =>
    resolveMarketTickEntry({
      goodId: m.goodId,
      stock: m.stock,
      demandRate: m.demandRate,
      honestUseRate: m.honestUseRate,
      // The knee's output denominator is the reference-cycle rate — deliberately NOT the
      // catch-up-scaled, strike-suppressed productionRate the entry carries for flow.
      capacityProduction: m.baseProductionRate ?? 0,
      storageCapacity: m.storageCapacity,
      baseProductionRate: m.baseProductionRate != null ? m.baseProductionRate * catchUp : undefined,
      baseConsumptionRate: m.baseConsumptionRate != null ? m.baseConsumptionRate * catchUp : undefined,
      productionSuppress: productionSuppressBySystem.get(m.systemId),
      modifiers: modifiersBySystem.get(m.systemId) ?? [],
      modifierCaps,
    }),
  );

  const tickEntries: MarketTickEntry[] = resolved.map((r) => r.entry);
  const entrySystemIds = markets.map((m) => m.systemId);
  const simulated = simulateCoupledEconomyTick(tickEntries, entrySystemIds, simParams);

  // Satisfaction is the FLOW actually applied this cycle (delivered ÷ demanded),
  // never a post-tick stock recompute — a cycle that starts above the comfort
  // knee delivers in full even when it ends just below it. Non-consumers read 1.
  const satisfactionByIndex = markets.map((_, i) => {
    const consumptionRate = tickEntries[i].consumptionRate;
    if (consumptionRate == null || consumptionRate <= 0) return 1;
    const demanded = consumptionRate * (tickEntries[i].consumptionMult ?? 1);
    return demanded > 0 ? Math.max(0, Math.min(1, simulated[i].delivered / demanded)) : 1;
  });

  // anchorMult comes straight off the resolved tick — the builder already
  // aggregated the system's modifiers, so there's no second aggregation pass.
  const marketUpdates: MarketUpdate[] = markets.map((m, i) => {
    const realisedProductionRate = simulated[i].realised / catchUp;
    const productionSuppressRate = productionSuppressBySystem.get(m.systemId) ?? 1;
    const productionMult = resolved[i].entry.productionMult ?? 1;
    // Advance by this cycle's reference-time (catchUpFactor), not a flat +1, so "two reference cycles
    // rationed" is the same wall-clock latency at any economy cadence. Fractional, finite, clamped [0,2].
    const squeezeCycles = satisfactionByIndex[i] < 1
      ? Math.min(2, Math.max(0, m.squeezeCycles ?? 0) + catchUp)
      : 0;
    return {
      id: m.id,
      stock: simulated[i].stock,
      anchorMult: resolved[i].anchorMult,
      satisfaction: satisfactionByIndex[i],
      realisedProductionRate: Number.isFinite(realisedProductionRate) && realisedProductionRate >= 0
        ? realisedProductionRate
        : 0,
      productionSuppressed: marketSuppressed(m),
      // Both are draw-figure inputs the logistics read derives urgency from, so they carry the same
      // finite guard as the realised rate above; a non-finite scalar reads as "no gate", never 0.
      productionSuppressRate: Number.isFinite(productionSuppressRate) && productionSuppressRate >= 0
        ? productionSuppressRate
        : 1,
      productionMult: Number.isFinite(productionMult) && productionMult >= 0 ? productionMult : 1,
      squeezeCycles,
    };
  });

  await world.applyMarketUpdates(marketUpdates);

  // The producer signal is the isolated start-stock ceiling term. It deliberately
  // excludes labour, recipe gates, strikes, maintenance, events, and realised flow.
  const goodsBySystem = new Map<string, GoodSatisfaction[]>();
  const sellingFactorBySystem = new Map<string, Map<string, number>>();
  const realisedProductionBySystem = new Map<string, Map<string, number>>();
  markets.forEach((m, i) => {
    const consumptionRate = tickEntries[i].consumptionRate;
    if (consumptionRate != null && consumptionRate > 0) {
      const demanded = consumptionRate * (tickEntries[i].consumptionMult ?? 1);
      const arr = goodsBySystem.get(m.systemId) ?? [];
      arr.push({ goodId: m.goodId, satisfaction: satisfactionByIndex[i], demanded });
      goodsBySystem.set(m.systemId, arr);
    }
    if (m.baseProductionRate !== undefined) {
      const factor = productionCeiling(
        tickEntries[i].stock,
        brakeKnee(
          {
            useRate: tickEntries[i].honestUseRate,
            capacityProduction: tickEntries[i].capacityProduction,
            anchorMult: tickEntries[i].anchorMult,
          },
          simParams,
        ),
      );
      const map = sellingFactorBySystem.get(m.systemId) ?? new Map<string, number>();
      map.set(m.goodId, factor);
      sellingFactorBySystem.set(m.systemId, map);
    }
    const realised = simulated[i].realised;
    if (realised > 0) {
      const bySystem = realisedProductionBySystem.get(m.systemId) ?? new Map<string, number>();
      bySystem.set(m.goodId, (bySystem.get(m.goodId) ?? 0) + realised);
      realisedProductionBySystem.set(m.systemId, bySystem);
    }
  });
  // Two folds of the same per-good satisfactions: D is the magnitude of the shortfall, the supply
  // state is its class. A system with no consuming markets reads supplied.
  const dissatisfactionBySystem = new Map<string, number>();
  const supplyStateBySystem = new Map<string, SupplyState>();
  for (const sysId of systemIds) {
    const goods = goodsBySystem.get(sysId) ?? [];
    const d = dissatisfaction(goods);
    dissatisfactionBySystem.set(sysId, d);
    supplyStateBySystem.set(sysId, foldSupplyState(goods));
  }
  const economySignals: EconomySignals = {
    dissatisfactionBySystem,
    supplyStateBySystem,
    sellingFactorBySystem,
    realisedProductionBySystem,
    productionSuppressBySystem,
  };

  const modCount = rawModifiers.length;
  if (DEBUG) {
    console.log(
      `[economy] Shard ${shardIndex + 1}/${iv}: ${systemIds.length} systems / ${markets.length} markets` +
        (modCount > 0 ? `, ${modCount} active modifier(s)` : ""),
    );
  }

  return {
    globalEvents: {
      economyTick: [
        {
          systemCount: systemIds.length,
          shardIndex,
          shardCount: iv,
        },
      ],
    },
    economySignals,
  };
}
