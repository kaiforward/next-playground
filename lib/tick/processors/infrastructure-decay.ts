import type { TickContext, TickProcessorResult } from "../types";
import { computeSystemDecay } from "@/lib/engine/infrastructure-decay";
import { catchUpFactor } from "@/lib/tick/shard";
import { HOUSING_TYPE } from "@/lib/constants/industry";
import type {
  InfrastructureWorld,
  InfrastructureProcessorParams,
  BuildingCountUpdate,
  IdleMonthsUpdate,
  CollapseDebtUpdate,
  PopCapUpdate,
} from "@/lib/tick/world/infrastructure-world";

/**
 * Pure processor body. Runs right after the economy processor, on the SAME shard:
 * the system set is exactly the economy's `dissatisfactionBySystem` key set (its
 * processed shard), and selling factors come from the same in-memory signals. Reads the
 * building roster + population + unrest, computes downward-only `count` deltas
 * (disuse + unrest decay) plus the recomputed popCap, and batch-writes both. Writes
 * are skipped where nothing decayed; popCap is written only where housing changed.
 */
export async function runInfrastructureDecayProcessor(
  world: InfrastructureWorld,
  ctx: TickContext,
  params: InfrastructureProcessorParams,
): Promise<TickProcessorResult> {
  const signals = ctx.results.get("economy")?.economySignals;
  if (!signals || signals.dissatisfactionBySystem.size === 0) return {};

  const systemIds = [...signals.dissatisfactionBySystem.keys()];
  const states = await world.getInfrastructureState(systemIds);

  // Decay counters are reference-denominated; one run accrues catchUpFactor(interval)
  // reference-months of idle countdown and collapse debt.
  const catchUp = catchUpFactor(params.interval);

  const countUpdates: BuildingCountUpdate[] = [];
  const idleUpdates: IdleMonthsUpdate[] = [];
  const debtUpdates: CollapseDebtUpdate[] = [];
  const popCapUpdates: PopCapUpdate[] = [];
  for (const s of states) {
    const selling = signals.sellingFactorBySystem.get(s.systemId);
    const fundingBound = params.logisticsFundingBoundBySystem?.get(s.systemId);
    // Maintenance funding stretches/shrinks the idle buffer only — the unrest
    // channel and the buffer machinery itself are untouched (no new decay channel).
    const bufferScale = params.bufferScaleBySystem?.get(s.systemId) ?? 1;
    const decayParams =
      bufferScale === 1
        ? params.decay
        : { ...params.decay, idleBufferMonths: params.decay.idleBufferMonths * bufferScale };
    const result = computeSystemDecay(
      {
        buildings: s.buildings,
        buildingIdleMonths: s.buildingIdleMonths,
        buildingCollapseDebt: s.buildingCollapseDebt,
        population: s.population,
        unrest: s.unrest,
        sellingFactor: (goodId) => selling?.get(goodId) ?? 1,
        logisticsFundingBound: (goodId) => fundingBound?.has(goodId) ?? false,
      },
      decayParams,
      catchUp,
    );
    for (const [buildingType, count] of Object.entries(result.newCounts)) {
      countUpdates.push({ systemId: s.systemId, buildingType, count });
    }
    for (const [buildingType, idleMonths] of Object.entries(result.newIdleMonths)) {
      idleUpdates.push({ systemId: s.systemId, buildingType, idleMonths });
    }
    for (const [buildingType, collapseDebt] of Object.entries(result.newCollapseDebt)) {
      debtUpdates.push({ systemId: s.systemId, buildingType, collapseDebt });
    }
    if (HOUSING_TYPE in result.newCounts) {
      popCapUpdates.push({ systemId: s.systemId, popCap: result.popCap });
    }
  }

  await world.applyBuildingDecays(countUpdates);
  await world.applyIdleMonths(idleUpdates);
  await world.applyCollapseDebts(debtUpdates);
  await world.applyPopCapUpdates(popCapUpdates);
  return {};
}
