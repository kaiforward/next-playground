/**
 * Player construction verbs — the mutation half of the control surface. Every verb validates the
 * seat (a player exists, the system is theirs) and the same physical ceilings the planner uses
 * (`computeBuildOptions` / `sizeColonyEstablish`), then swaps a new world into the store.
 *
 * Concurrency: `runWorldTick` awaits only in-memory adapters, so the event loop never reaches an
 * HTTP handler mid-tick — these synchronous mutations are strictly ordered between ticks and the
 * open set they append to is exactly what the next directed-build pulse funds.
 */
import { getWorld, hasWorld, setWorld } from "@/lib/world/store";
import type { World, WorldSystem, WorldBuildProject, WorldColonyEstablishProject } from "@/lib/world/types";
import { toTickConnections } from "@/lib/world/tick";
import { computeBuildOptions } from "@/lib/engine/build-options";
import { sizeColonyEstablish } from "@/lib/engine/directed-build";
import { boundedHopsFromOrigin } from "@/lib/engine/pathfinding";
import { buildingsBySystem } from "@/lib/services/world-index";
import { resourceVectorFromColumns } from "@/lib/engine/resources";
import { BUILDING_TYPES } from "@/lib/constants/industry";
import { COLONISATION } from "@/lib/constants/colonisation";
import { EXPANSION } from "@/lib/constants/expansion";
import { DIRECTED_BUILD } from "@/lib/constants/directed-build";
import { DIRECTED_LOGISTICS } from "@/lib/constants/directed-logistics";

/** The hop radius the tick's shared BFS uses — seed-source reach for the colony verb matches it. */
export const COLONY_REACH_HOPS = Math.max(
  DIRECTED_LOGISTICS.MAX_HOPS, DIRECTED_BUILD.MAX_HOPS, EXPANSION.REACH_JUMPS,
);

type Seat = { world: World; factionId: string };

function requireSeat(): Seat | { error: string } {
  if (!hasWorld()) return { error: "No world loaded." };
  const world = getWorld();
  if (!world.player) return { error: "This world has no player seat." };
  return { world, factionId: world.player.controlledFactionId };
}

function playerSystem(seat: Seat, systemId: string): WorldSystem | { error: string } {
  const system = seat.world.systems.find((s) => s.id === systemId);
  if (!system) return { error: `System ${systemId} not found.` };
  if (system.factionId !== seat.factionId) return { error: "You do not control this system." };
  return system;
}

/** Mints a fresh construction-project id from the world's shared counter (matches the tick's own minting namespace). */
function mintProjectId(world: World): string {
  return `construction-${world.nextId}`;
}

/** In-flight build levels by type at one system (the committed state feasibility nets against). */
function committedAt(world: World, systemId: string): Record<string, number> {
  const committed: Record<string, number> = {};
  for (const p of world.constructionProjects) {
    if (p.kind !== "build" || p.systemId !== systemId) continue;
    committed[p.buildingType] = (committed[p.buildingType] ?? 0) + p.levels;
  }
  return committed;
}

export type OrderBuildResult =
  | { ok: true; data: { projectId: string; levels: number } }
  | { ok: false; error: string };

export function orderBuild(input: { systemId: string; buildingType: string; levels: number }): OrderBuildResult {
  const seat = requireSeat();
  if ("error" in seat) return { ok: false, error: seat.error };
  const system = playerSystem(seat, input.systemId);
  if ("error" in system) return { ok: false, error: system.error };
  if (system.control !== "developed") return { ok: false, error: "Builds require a developed system." };
  if (!(input.buildingType in BUILDING_TYPES)) {
    return { ok: false, error: `Unknown building type: ${input.buildingType}` };
  }

  const options = computeBuildOptions(
    {
      population: system.population,
      buildings: buildingsBySystem().get(system.id) ?? {},
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
    committedAt(seat.world, system.id),
  );
  const option = options.find((o) => o.buildingType === input.buildingType);
  if (!option) return { ok: false, error: `Unknown building type: ${input.buildingType}` };
  if (input.levels > option.maxLevels) {
    return {
      ok: false,
      error: option.blocked === "no_deposit_slots"
        ? "No free deposit slots for that building here."
        : `Not enough space: ${option.maxLevels} more level(s) fit here.`,
    };
  }

  // Batching: repeat orders extend the standing player row for this (system, type) — one ledger
  // row, growing workTotal, keeping its queue position and accrued work.
  const existing = seat.world.constructionProjects.find(
    (p): p is WorldBuildProject =>
      p.kind === "build" && p.origin === "player" &&
      p.systemId === system.id && p.buildingType === input.buildingType,
  );
  if (existing) {
    const levels = existing.levels + input.levels;
    const workTotal = existing.workTotal + input.levels * option.workPerLevel;
    const constructionProjects = seat.world.constructionProjects.map((p) =>
      p.id === existing.id ? { ...existing, levels, workTotal } : p,
    );
    setWorld({ ...seat.world, constructionProjects });
    return { ok: true, data: { projectId: existing.id, levels } };
  }

  const project: WorldBuildProject = {
    kind: "build",
    id: mintProjectId(seat.world),
    factionId: seat.factionId,
    systemId: system.id,
    origin: "player",
    buildingType: input.buildingType,
    levels: input.levels,
    workTotal: input.levels * option.workPerLevel,
    workDone: 0,
  };
  setWorld({
    ...seat.world,
    constructionProjects: [...seat.world.constructionProjects, project],
    nextId: seat.world.nextId + 1,
  });
  return { ok: true, data: { projectId: project.id, levels: project.levels } };
}

/** Why a controlled system can't take a colony order right now (mirrors planner eligibility). */
export type ColonyBlockReason = "already_forming" | "below_habitable_floor" | "no_seed_source";

/** Nearest developed same-faction seed source within the tick's reach radius, or null. */
export function findSeedSource(world: World, factionId: string, systemId: string): string | null {
  const hops = boundedHopsFromOrigin(systemId, toTickConnections(world), COLONY_REACH_HOPS);
  let best: { id: string; h: number } | null = null;
  for (const s of world.systems) {
    if (s.factionId !== factionId || s.control !== "developed") continue;
    const h = hops.get(s.id);
    if (h === undefined || h <= 0) continue;
    if (best === null || h < best.h || (h === best.h && s.id < best.id)) best = { id: s.id, h };
  }
  return best?.id ?? null;
}

/** Planner-equivalent eligibility for the direct-colony verb at a CONTROLLED player system. */
export function colonyEligibility(
  world: World, factionId: string, system: WorldSystem,
): { eligible: true; sourceSystemId: string } | { eligible: false; reason: ColonyBlockReason } {
  if (world.constructionProjects.some((p) => p.kind === "colony_establish" && p.systemId === system.id)) {
    return { eligible: false, reason: "already_forming" };
  }
  if (system.habitableSpace < EXPANSION.DEVELOP_HABITABLE_FLOOR) {
    return { eligible: false, reason: "below_habitable_floor" };
  }
  if (sizeColonyEstablish(system.habitableSpace, sizingParams()) === null) {
    return { eligible: false, reason: "below_habitable_floor" };
  }
  const source = findSeedSource(world, factionId, system.id);
  if (source === null) return { eligible: false, reason: "no_seed_source" };
  return { eligible: true, sourceSystemId: source };
}

export function sizingParams(): { seedPop: number; establishWork: number } {
  return { seedPop: EXPANSION.COLONY_SEED_POP, establishWork: COLONISATION.COLONY_ESTABLISH_WORK };
}

export type OrderColonyResult =
  | { ok: true; data: { projectId: string } }
  | { ok: false; error: string };

export function orderColony(input: { systemId: string }): OrderColonyResult {
  const seat = requireSeat();
  if ("error" in seat) return { ok: false, error: seat.error };
  const system = playerSystem(seat, input.systemId);
  if ("error" in system) return { ok: false, error: system.error };
  if (system.control !== "controlled") {
    return { ok: false, error: "Colonies are established at controlled, not-yet-colonised systems." };
  }

  const check = colonyEligibility(seat.world, seat.factionId, system);
  if (!check.eligible) {
    const message: Record<ColonyBlockReason, string> = {
      already_forming: "A colony is already forming here.",
      below_habitable_floor: "Below the habitable floor — this world cannot hold a colony.",
      no_seed_source: "No developed system in range to seed the colony from.",
    };
    return { ok: false, error: message[check.reason] };
  }
  const sizing = sizeColonyEstablish(system.habitableSpace, sizingParams());
  if (sizing === null) return { ok: false, error: "Below the habitable floor — this world cannot hold a colony." };

  const project: WorldColonyEstablishProject = {
    kind: "colony_establish",
    id: mintProjectId(seat.world),
    factionId: seat.factionId,
    systemId: system.id,
    origin: "player",
    sourceSystemId: check.sourceSystemId,
    seedPop: sizing.seedPop,
    housingLevels: sizing.housingLevels,
    workTotal: sizing.work,
    workDone: 0,
  };
  setWorld({
    ...seat.world,
    constructionProjects: [...seat.world.constructionProjects, project],
    nextId: seat.world.nextId + 1,
  });
  return { ok: true, data: { projectId: project.id } };
}

export type CancelOrderResult =
  | { ok: true; data: { projectId: string } }
  | { ok: false; error: string };

export function cancelOrder(input: { projectId: string }): CancelOrderResult {
  const seat = requireSeat();
  if ("error" in seat) return { ok: false, error: seat.error };
  const project = seat.world.constructionProjects.find((p) => p.id === input.projectId);
  if (!project || project.factionId !== seat.factionId || project.origin !== "player") {
    return { ok: false, error: "No cancellable order with that id." };
  }
  // Work spent is lost — by design.
  setWorld({
    ...seat.world,
    constructionProjects: seat.world.constructionProjects.filter((p) => p.id !== input.projectId),
  });
  return { ok: true, data: { projectId: input.projectId } };
}

export type SetAutomationResult =
  | { ok: true; data: { build: boolean; colonisation: boolean } }
  | { ok: false; error: string };

export function setAutomation(input: { build: boolean; colonisation: boolean }): SetAutomationResult {
  const seat = requireSeat();
  if ("error" in seat) return { ok: false, error: seat.error };
  const player = seat.world.player;
  if (!player) return { ok: false, error: "This world has no player seat." };
  const automation = { build: input.build, colonisation: input.colonisation };
  setWorld({ ...seat.world, player: { ...player, automation } });
  return { ok: true, data: automation };
}
