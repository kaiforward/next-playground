/**
 * Read service for the player's per-system build surface: which verbs exist here and their
 * feasibility. `none` on anything that isn't the player's system; `colony` on a controlled world
 * (the verb + its eligibility); `build` on a developed one (per-type options + queue-aware ETA —
 * the same numbers the order services enforce, so the UI never learns a different truth).
 */
import { getWorld, hasWorld } from "@/lib/world/store";
import { ServiceError } from "@/lib/services/errors";
import { computeBuildOptions, buildSiteFromSystem } from "@/lib/engine/build-options";
import {
  factionConstructionPool, forecastIndependentEtaCycles, orderOpenProjects,
} from "@/lib/engine/construction";
import { buildingLabel, foundingCeilings } from "@/lib/engine/construction-readout";
import { colonyEligibility, sizingParams } from "@/lib/services/colony-eligibility";
import { foundingCommitmentCost } from "@/lib/engine/founding-cost";
import { COLONISATION } from "@/lib/constants/colonisation";
import { foundingReadoutInputs } from "@/lib/services/construction";
import { sizeColonyEstablish, queuedBuildLevelsAt } from "@/lib/engine/directed-build";
import { buildingsBySystem } from "@/lib/services/world-index";
import { CONSTRUCTION } from "@/lib/constants/construction";
import type { SystemBuildOptionsData, BuildOptionData } from "@/lib/types/api";
import type { WorldConstructionProject } from "@/lib/world/types";

export function getSystemBuildOptions(systemId: string): SystemBuildOptionsData {
  if (!hasWorld()) throw new ServiceError("No world loaded", "no_world");
  const world = getWorld();
  const system = world.systems.find((s) => s.id === systemId);
  if (!system) throw new ServiceError(`System ${systemId} not found.`, "not_found");

  const player = world.player;
  if (!player || system.factionId !== player.controlledFactionId) return { mode: "none" };

  if (system.control === "controlled") {
    const check = colonyEligibility(world, player.controlledFactionId, system);
    // The money block is the one ineligible reason that still carries a quote, so the preview is
    // assembled for it exactly as for the eligible branch — same fields, same sizing.
    const priced = check.eligible || check.reason === "insufficient_funds" ? check : null;
    const sizing = priced === null ? null : sizeColonyEstablish(system.peopleLand, sizingParams());
    const preview =
      priced === null || sizing === null
        ? null
        : {
            sourceSystemId: priced.sourceSystemId,
            sourceSystemName:
              world.systems.find((s) => s.id === priced.sourceSystemId)?.name ?? priced.sourceSystemId,
            seedPop: sizing.seedPop, housingLevels: sizing.housingLevels, work: sizing.work,
            charter: priced.charter, projectedBill: priced.projectedBill,
            commitment: foundingCommitmentCost(
              priced.charter, priced.projectedBill, COLONISATION.FOUNDING_GATE_HEADROOM,
            ),
          };
    if (!check.eligible) return { mode: "colony", colony: { state: "ineligible", reason: check.reason, preview } };
    if (preview === null) {
      return { mode: "colony", colony: { state: "ineligible", reason: "below_habitable_floor", preview: null } };
    }
    return { mode: "colony", colony: { state: "eligible", preview } };
  }
  if (system.control !== "developed") return { mode: "none" };

  const buildings = buildingsBySystem();
  const factionId = player.controlledFactionId;
  const factionProjects = orderOpenProjects(
    world.constructionProjects.filter((p) => p.factionId === factionId),
  );

  const options = computeBuildOptions(
    buildSiteFromSystem(system, buildings.get(system.id) ?? {}),
    queuedBuildLevelsAt(world.constructionProjects, system.id),
  );

  // Queue-aware ETA: a 1-level order placed NOW joins the queue behind everything committed (it is
  // a fresh player row). Each open option's hypothetical is independent of the others (it answers
  // "what if I ordered just this one"), but they all share the same committed prefix, so one
  // `forecastIndependentEtaCycles` call simulates that prefix once instead of once per option —
  // see the function's own doc comment for why the hypotheticals don't compete with each other.
  const pool = factionConstructionPool(
    world.systems
      .filter((s) => s.factionId === factionId)
      .map((s) => ({ control: s.control, population: s.population, buildings: buildings.get(s.id) ?? {} })),
    { throughputPerPop: CONSTRUCTION.THROUGHPUT_PER_POP, pointsPerLevel: CONSTRUCTION.POINTS_PER_LEVEL },
  ).total;
  const cap = CONSTRUCTION.PER_BUILD_ABSORPTION_CAP;

  const openIndices: number[] = [];
  const hypotheticals: WorldConstructionProject[] = [];
  options.forEach((o, i) => {
    if (o.maxLevels <= 0) return;
    openIndices.push(i);
    hypotheticals.push({
      kind: "build", id: `eta-probe-${i}`, factionId, systemId: system.id, origin: "player",
      buildingType: o.buildingType, levels: 1, workTotal: o.workPerLevel, workDone: 0,
    });
  });
  // The committed prefix drains under the same per-project ceilings the tick funds it with: a colony
  // whose materials the treasury cannot buy absorbs less than the cap, and what it leaves reaches the
  // order the player is pricing. Forecasting it at the scalar cap would have a gated colony eat pool
  // it was never going to take, and every ETA quoted here would read late. Derived only when there
  // is an option to price: the inputs walk the faction's treasury and every source's markets, and
  // this is a per-page-view read path.
  const etas = (() => {
    if (hypotheticals.length === 0) return [];
    const ceilings = foundingCeilings(
      factionProjects,
      foundingReadoutInputs(world, factionId, factionProjects, buildings),
      cap,
    );
    return forecastIndependentEtaCycles(
      factionProjects, hypotheticals, pool, cap, undefined,
      (p) => ceilings.get(p.id) ?? cap,
    );
  })();
  const etaByOptionIndex = new Map(openIndices.map((optionIndex, k) => [optionIndex, etas[k]]));

  const decorated: BuildOptionData[] = options.map((o, i) => ({
    ...o, label: buildingLabel(o.buildingType), etaCycles: etaByOptionIndex.get(i) ?? null,
  }));

  return { mode: "build", options: decorated };
}
