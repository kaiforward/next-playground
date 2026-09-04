/**
 * Player construction verbs — the mutation half of the control surface. Every verb validates the
 * seat (a player exists, the system is theirs) and the same physical ceilings the planner uses
 * (`computeBuildOptions` / `sizeColonyEstablish`), then swaps a new world into the store.
 *
 * Concurrency: `runWorldTick` awaits only in-memory adapters, so the event loop never reaches an
 * HTTP handler mid-tick — these synchronous mutations are strictly ordered between ticks and the
 * open set they append to is exactly what the next directed-build cycle funds.
 */
import { getWorld, hasWorld, setWorld } from "@/lib/world/store";
import type { World, WorldSystem, WorldBuildProject, WorldColonyEstablishProject, WorldConstructionProject, WorldLaneUpgradeProject, WorldMarket } from "@/lib/world/types";
import { computeBuildOptions, buildSiteFromSystem } from "@/lib/engine/build-options";
import { sizeColonyEstablish, queuedBuildLevelsAt } from "@/lib/engine/directed-build";
import { buildingsBySystem } from "@/lib/services/world-index";
import { BUILDING_TYPES } from "@/lib/constants/industry";
import { colonyEligibility, sizingParams } from "@/lib/services/colony-eligibility";
import { COLONY_BLOCK_COPY } from "@/lib/types/colonisation";
import { laneInvestor } from "@/lib/engine/lanes";
import { LANES } from "@/lib/constants/lanes";

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

/**
 * Swap in a world carrying one newly minted project. Appending it and advancing `nextId` are the
 * same act — the id came from that counter, so a caller that appended without bumping would hand
 * the next order the same id.
 */
function commitNewProject(seat: Seat, project: WorldConstructionProject): void {
  setWorld({
    ...seat.world,
    constructionProjects: [...seat.world.constructionProjects, project],
    nextId: seat.world.nextId + 1,
  });
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
    buildSiteFromSystem(system, buildingsBySystem().get(system.id) ?? {}),
    queuedBuildLevelsAt(seat.world.constructionProjects, system.id),
  );
  const option = options.find((o) => o.buildingType === input.buildingType);
  if (!option) return { ok: false, error: `Unknown building type: ${input.buildingType}` };
  if (option.maxLevels !== null && input.levels > option.maxLevels) {
    return {
      ok: false,
      error: option.blocked === "no_deposit_slots"
        ? "No free resource slots for that building here."
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
  commitNewProject(seat, project);
  return { ok: true, data: { projectId: project.id, levels: project.levels } };
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
    return { ok: false, error: COLONY_BLOCK_COPY[check.reason] };
  }
  const sizing = sizeColonyEstablish(system.peopleLand, sizingParams());
  if (sizing === null) return { ok: false, error: "Below the habitable floor — this world cannot hold a colony." };

  // The order buys its charter at the click: the same fee the eligibility quote carried, accrued
  // into `pendingFounding` exactly as the tick's charter phase pays (that phase skips paid
  // charters, so nothing charges twice, and the settlement stays the single `balance` writer).
  // This is what makes the working balance fall immediately — a second order is priced against
  // what is genuinely left, instead of seeing money the first colony already called for. Lost on
  // cancel by design, like every charter.
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
    stagedManifest: [],
    charterPaid: true,
    stalledCycles: 0,
  };
  setWorld({
    ...seat.world,
    constructionProjects: [...seat.world.constructionProjects, project],
    nextId: seat.world.nextId + 1,
    treasuries: seat.world.treasuries.map((t) =>
      t.factionId === seat.factionId
        ? { ...t, pendingFounding: t.pendingFounding + check.charter }
        : t,
    ),
  });
  return { ok: true, data: { projectId: project.id } };
}

/**
 * The reason a lane order is refused: the first endpoint that is unclaimed, else the first that
 * belongs to a different faction. `laneInvestor` already treats both as "no investor" — this just
 * names which one, and for which system, so the refusal reads as a place the player can act on.
 */
function laneRefusalReason(aSystem: WorldSystem, bSystem: WorldSystem, factionId: string): string {
  for (const system of [aSystem, bSystem]) {
    if (system.factionId === null) return `${system.name} is unclaimed.`;
  }
  for (const system of [aSystem, bSystem]) {
    if (system.factionId !== factionId) return `${system.name} is not yours.`;
  }
  return "You do not control this lane.";
}

export type OrderLaneUpgradeResult =
  | { ok: true; data: { projectId: string; levels: number } }
  | { ok: false; error: string };

/**
 * Queue `levels` whole upgrade levels on the undirected lane `laneKey` — refused unless the player
 * is the lane's investor (`laneInvestor`, `lib/engine/lanes.ts`: controls both endpoints at
 * control ≥ controlled). Batches onto a standing `origin: "player"` row for the same lane exactly
 * as `orderBuild` batches onto a (system, buildingType) row.
 */
export function orderLaneUpgrade(input: { laneKey: string; levels: number }): OrderLaneUpgradeResult {
  const seat = requireSeat();
  if ("error" in seat) return { ok: false, error: seat.error };
  const lane = seat.world.lanes.find((l) => l.key === input.laneKey);
  if (!lane) return { ok: false, error: `Unknown lane: ${input.laneKey}` };
  const aSystem = seat.world.systems.find((s) => s.id === lane.aId);
  const bSystem = seat.world.systems.find((s) => s.id === lane.bId);
  if (!aSystem || !bSystem) return { ok: false, error: `Unknown lane: ${input.laneKey}` };

  const investor = laneInvestor(lane, (systemId) => {
    const system = systemId === aSystem.id ? aSystem : bSystem;
    return { factionId: system.factionId, control: system.control };
  });
  if (investor !== seat.factionId) {
    return { ok: false, error: laneRefusalReason(aSystem, bSystem, seat.factionId) };
  }

  // Batching: a repeat order extends the standing player row for this lane — same ledger row,
  // growing workTotal, keeping its queue position and accrued work.
  const existing = seat.world.constructionProjects.find(
    (p): p is WorldLaneUpgradeProject =>
      p.kind === "lane_upgrade" && p.origin === "player" && p.laneKey === input.laneKey,
  );
  if (existing) {
    const levels = existing.levels + input.levels;
    const workTotal = existing.workTotal + input.levels * LANES.UPGRADE_WORK_PER_LEVEL;
    const constructionProjects = seat.world.constructionProjects.map((p) =>
      p.id === existing.id ? { ...existing, levels, workTotal } : p,
    );
    setWorld({ ...seat.world, constructionProjects });
    return { ok: true, data: { projectId: existing.id, levels } };
  }

  const project: WorldLaneUpgradeProject = {
    kind: "lane_upgrade",
    id: mintProjectId(seat.world),
    factionId: seat.factionId,
    origin: "player",
    laneKey: input.laneKey,
    levels: input.levels,
    workTotal: input.levels * LANES.UPGRADE_WORK_PER_LEVEL,
    workDone: 0,
  };
  commitNewProject(seat, project);
  return { ok: true, data: { projectId: project.id, levels: project.levels } };
}

export type CancelOrderResult =
  | { ok: true; data: { projectId: string } }
  | { ok: false; error: string };

/**
 * Put a cancelled colony's staged goods back on its founder's shelves. They are real inventory —
 * drawn from those very rows and paid for cycle by cycle, and sitting in the project ledger ever
 * since — so cancelling without returning them would destroy stock the faction owns.
 *
 * Uncapped: stock coming home can never breach a reserve, and there is no storage ceiling to respect
 * that the goods did not already sit under before they left. Lines are credited only onto rows the
 * source still has (it holds a row for every good it ever staged, because each draw was sized off
 * that row), and a non-finite or non-positive line is dropped rather than written into world state.
 */
function returnStagedManifest(
  markets: WorldMarket[],
  project: WorldColonyEstablishProject,
): WorldMarket[] {
  const credit = new Map<string, number>();
  for (const line of project.stagedManifest) {
    if (!Number.isFinite(line.quantity) || line.quantity <= 0) continue;
    credit.set(line.goodId, (credit.get(line.goodId) ?? 0) + line.quantity);
  }
  if (credit.size === 0) return markets;
  return markets.map((m) => {
    if (m.systemId !== project.sourceSystemId) return m;
    const change = credit.get(m.goodId);
    if (change === undefined) return m;
    return { ...m, stock: m.stock + change };
  });
}

export function cancelOrder(input: { projectId: string }): CancelOrderResult {
  const seat = requireSeat();
  if ("error" in seat) return { ok: false, error: seat.error };
  const project = seat.world.constructionProjects.find((p) => p.id === input.projectId);
  if (!project || project.factionId !== seat.factionId || project.origin !== "player") {
    return { ok: false, error: "No cancellable order with that id." };
  }
  // Work spent is lost — by design, as is a colony's charter. Its staged materials are not: they
  // exist, so they go home to the founder.
  const markets =
    project.kind === "colony_establish"
      ? returnStagedManifest(seat.world.markets, project)
      : seat.world.markets;
  setWorld({
    ...seat.world,
    markets,
    constructionProjects: seat.world.constructionProjects.filter((p) => p.id !== input.projectId),
  });
  return { ok: true, data: { projectId: input.projectId } };
}

export type SetAutomationResult =
  | { ok: true; data: { build: boolean; colonisation: boolean; lanes: boolean } }
  | { ok: false; error: string };

/**
 * Set the player's per-domain autonomic switches. Spreads onto the existing object rather than
 * rebuilding it from `input` alone — the fix for a domain silently dropping whenever a future
 * automation field is added without every caller learning about it in the same change.
 */
export function setAutomation(input: { build: boolean; colonisation: boolean; lanes: boolean }): SetAutomationResult {
  const seat = requireSeat();
  if ("error" in seat) return { ok: false, error: seat.error };
  const player = seat.world.player;
  if (!player) return { ok: false, error: "This world has no player seat." };
  const automation = { ...player.automation, ...input };
  setWorld({ ...seat.world, player: { ...player, automation } });
  return { ok: true, data: automation };
}
