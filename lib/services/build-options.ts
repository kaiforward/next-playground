/**
 * Read service for the player's per-system build surface: which verbs exist here and their
 * feasibility. `none` on anything that isn't the player's system; `colony` on a controlled world
 * (the verb + its eligibility); `build` on a developed one (per-type options + queue-aware ETA —
 * the same numbers the order services enforce, so the UI never learns a different truth).
 */
import { getWorld, hasWorld } from "@/lib/world/store";
import { ServiceError } from "@/lib/services/errors";
import { computeBuildOptions } from "@/lib/engine/build-options";
import {
  factionConstructionPool, forecastEtaPulses, orderOpenProjects,
} from "@/lib/engine/construction";
import { buildingLabel } from "@/lib/engine/construction-readout";
import { colonyEligibility, sizingParams } from "@/lib/services/construction-orders";
import { sizeColonyEstablish } from "@/lib/engine/directed-build";
import { buildingsBySystem } from "@/lib/services/world-index";
import { resourceVectorFromColumns } from "@/lib/engine/resources";
import { CONSTRUCTION } from "@/lib/constants/construction";
import type { SystemBuildOptionsData, BuildOptionData } from "@/lib/types/api";
import type { WorldConstructionProject } from "@/lib/world/types";

export function getSystemBuildOptions(systemId: string): SystemBuildOptionsData {
  if (!hasWorld()) throw new ServiceError("No world loaded", 409);
  const world = getWorld();
  const system = world.systems.find((s) => s.id === systemId);
  if (!system) throw new ServiceError(`System ${systemId} not found.`, 404);

  const player = world.player;
  if (!player || system.factionId !== player.controlledFactionId) return { mode: "none" };

  if (system.control === "controlled") {
    const check = colonyEligibility(world, player.controlledFactionId, system);
    if (!check.eligible) return { mode: "colony", colony: { state: "ineligible", reason: check.reason } };
    const sizing = sizeColonyEstablish(system.habitableSpace, sizingParams());
    if (sizing === null) {
      return { mode: "colony", colony: { state: "ineligible", reason: "below_habitable_floor" } };
    }
    const sourceName = world.systems.find((s) => s.id === check.sourceSystemId)?.name ?? check.sourceSystemId;
    return {
      mode: "colony",
      colony: {
        state: "eligible",
        preview: {
          sourceSystemId: check.sourceSystemId, sourceSystemName: sourceName,
          seedPop: sizing.seedPop, housingLevels: sizing.housingLevels, work: sizing.work,
        },
      },
    };
  }
  if (system.control !== "developed") return { mode: "none" };

  const buildings = buildingsBySystem();
  const factionId = player.controlledFactionId;
  const factionProjects = orderOpenProjects(
    world.constructionProjects.filter((p) => p.factionId === factionId),
  );
  const committed: Record<string, number> = {};
  for (const p of factionProjects) {
    if (p.kind === "build" && p.systemId === system.id) {
      committed[p.buildingType] = (committed[p.buildingType] ?? 0) + p.levels;
    }
  }

  const options = computeBuildOptions(
    {
      population: system.population,
      buildings: buildings.get(system.id) ?? {},
      slotCap: resourceVectorFromColumns(
        {
          slotGas: system.slotGas,
          slotMinerals: system.slotMinerals,
          slotOre: system.slotOre,
          slotBiomass: system.slotBiomass,
          slotArable: system.slotArable,
          slotWater: system.slotWater,
          slotRadioactive: system.slotRadioactive,
        },
        "slot",
      ),
      generalSpace: system.generalSpace,
      habitableSpace: system.habitableSpace,
    },
    committed,
  );

  // Queue-aware ETA: a 1-level order placed NOW joins the queue behind everything committed (it is
  // a fresh player row), so its landing pulse comes from one forecast over queue + hypothetical row.
  const pool = factionConstructionPool(
    world.systems
      .filter((s) => s.factionId === factionId)
      .map((s) => ({ control: s.control, population: s.population, buildings: buildings.get(s.id) ?? {} })),
    { throughputPerPop: CONSTRUCTION.THROUGHPUT_PER_POP, pointsPerLevel: CONSTRUCTION.POINTS_PER_LEVEL },
  ).total;
  const cap = CONSTRUCTION.PER_BUILD_ABSORPTION_CAP;

  const decorated: BuildOptionData[] = options.map((o) => {
    let etaPulses: number | null = null;
    if (o.maxLevels > 0) {
      const hypothetical: WorldConstructionProject = {
        kind: "build", id: "eta-probe", factionId, systemId: system.id, origin: "player",
        buildingType: o.buildingType, levels: 1, workTotal: o.workPerLevel, workDone: 0,
      };
      const queue = [...factionProjects, hypothetical];
      etaPulses = forecastEtaPulses(queue, pool, cap)[queue.length - 1];
    }
    return { ...o, label: buildingLabel(o.buildingType), etaPulses };
  });

  return { mode: "build", options: decorated };
}
