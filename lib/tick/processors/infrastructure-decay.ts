import type { TickContext, TickProcessorResult } from "../types";
import { computeSystemDecay } from "@/lib/engine/infrastructure-decay";
import { catchUpFactor } from "@/lib/tick/shard";
import { HOUSING_TYPE } from "@/lib/constants/industry";
import type {
  InfrastructureWorld,
  InfrastructureProcessorParams,
  BuildingCountUpdate,
  IdleCyclesUpdate,
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
  // reference-cycles of idle countdown and collapse debt.
  const catchUp = catchUpFactor(params.interval);

  const countUpdates: BuildingCountUpdate[] = [];
  const idleUpdates: IdleCyclesUpdate[] = [];
  const debtUpdates: CollapseDebtUpdate[] = [];
  const popCapUpdates: PopCapUpdate[] = [];
  // Per-system whole levels torn down this cycle — read by the harness's episode-cost instrument
  // (calibration) and by the tick body's worked-yield refold (`refoldWorkedYields`,
  // `lib/world/tick.ts`), which folds every system whose keys appear here. Absent system ⇒ 0 levels
  // lost. `computeSystemDecay` only ever
  // writes a strictly-lower count into `newCounts` (both the idle-buffer channel and the
  // unrest-collapse channel), so the pre/post difference here is exactly what left this cycle,
  // combining both channels without needing to re-derive which one fired.
  const teardownLevelsBySystem = new Map<string, number>();
  for (const s of states) {
    const selling = signals.sellingFactorBySystem.get(s.systemId);
    const fundingBound = params.logisticsFundingBoundBySystem?.get(s.systemId);
    // Maintenance funding stretches/shrinks the idle buffer only — the unrest
    // channel and the buffer machinery itself are untouched (no new decay channel).
    const bufferScale = params.bufferScaleBySystem?.get(s.systemId) ?? 1;
    const decayParams =
      bufferScale === 1
        ? params.decay
        : { ...params.decay, idleBufferCycles: params.decay.idleBufferCycles * bufferScale };
    const result = computeSystemDecay(
      {
        buildings: s.buildings,
        buildingIdleCycles: s.buildingIdleCycles,
        collapseDebt: s.collapseDebt,
        population: s.population,
        unrest: s.unrest,
        sellingFactor: (goodId) => selling?.get(goodId) ?? 1,
        logisticsFundingBound: (goodId) => fundingBound?.has(goodId) ?? false,
      },
      decayParams,
      catchUp,
    );
    let teardown = 0;
    for (const [buildingType, count] of Object.entries(result.newCounts)) {
      countUpdates.push({ systemId: s.systemId, buildingType, count });
      teardown += Math.max(0, (s.buildings[buildingType] ?? 0) - count);
    }
    if (teardown > 0) teardownLevelsBySystem.set(s.systemId, teardown);
    for (const [buildingType, idleCycles] of Object.entries(result.newIdleCycles)) {
      idleUpdates.push({ systemId: s.systemId, buildingType, idleCycles });
    }
    if (result.collapseDebt !== s.collapseDebt) {
      debtUpdates.push({ systemId: s.systemId, collapseDebt: result.collapseDebt });
    }
    if (HOUSING_TYPE in result.newCounts) {
      popCapUpdates.push({ systemId: s.systemId, popCap: result.popCap });
    }
  }

  await world.applyBuildingDecays(countUpdates);
  await world.applyIdleCycles(idleUpdates);
  await world.applyCollapseDebts(debtUpdates);
  await world.applyPopCapUpdates(popCapUpdates);
  return teardownLevelsBySystem.size > 0 ? { teardownLevelsBySystem } : {};
}
