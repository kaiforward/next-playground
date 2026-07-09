import type { TickContext, TickProcessorResult } from "../types";
import { computeSystemDecay } from "@/lib/engine/infrastructure-decay";
import { HOUSING_TYPE } from "@/lib/constants/industry";
import type {
  InfrastructureWorld,
  InfrastructureProcessorParams,
  BuildingCountUpdate,
  IdleMonthsUpdate,
  PopCapUpdate,
} from "@/lib/tick/world/infrastructure-world";

/**
 * Pure processor body. Runs right after the economy processor, on the SAME shard:
 * the system set is exactly the economy's `dissatisfactionBySystem` key set (its
 * processed shard), and uptake comes from the same in-memory signals. Reads the
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

  const countUpdates: BuildingCountUpdate[] = [];
  const idleUpdates: IdleMonthsUpdate[] = [];
  const popCapUpdates: PopCapUpdate[] = [];
  for (const s of states) {
    const uptake = signals.outputUptakeBySystem.get(s.systemId);
    const result = computeSystemDecay(
      {
        buildings: s.buildings,
        buildingIdleMonths: s.buildingIdleMonths,
        population: s.population,
        unrest: s.unrest,
        outputUptake: (goodId) => uptake?.get(goodId) ?? 1,
      },
      params.decay,
    );
    for (const [buildingType, count] of Object.entries(result.newCounts)) {
      countUpdates.push({ systemId: s.systemId, buildingType, count });
    }
    for (const [buildingType, idleMonths] of Object.entries(result.newIdleMonths)) {
      idleUpdates.push({ systemId: s.systemId, buildingType, idleMonths });
    }
    if (HOUSING_TYPE in result.newCounts) {
      popCapUpdates.push({ systemId: s.systemId, popCap: result.popCap });
    }
  }

  await world.applyBuildingDecays(countUpdates);
  await world.applyIdleMonths(idleUpdates);
  await world.applyPopCapUpdates(popCapUpdates);
  return {};
}
