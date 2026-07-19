/**
 * Shared colony-eligibility planning — world-state-in, data-out, no store access of its own. Both
 * the build-options read service and the construction-orders mutation service consume this so
 * neither depends on the other (a read service importing from a mutation service was a layering
 * smell); the same eligibility check backs the order's own validation and the UI's preview.
 */
import type { World, WorldSystem } from "@/lib/world/types";
import { toTickConnections } from "@/lib/world/tick";
import { sizeColonyEstablish } from "@/lib/engine/directed-build";
import { boundedHopsFromOrigin } from "@/lib/engine/pathfinding";
import { COLONISATION } from "@/lib/constants/colonisation";
import { EXPANSION } from "@/lib/constants/expansion";
import { DIRECTED_BUILD } from "@/lib/constants/directed-build";
import { DIRECTED_LOGISTICS } from "@/lib/constants/directed-logistics";
import type { ColonyBlockReason } from "@/lib/types/colonisation";

/** The hop radius the tick's shared BFS uses — seed-source reach for the colony verb matches it. */
export const COLONY_REACH_HOPS = Math.max(
  DIRECTED_LOGISTICS.MAX_HOPS, DIRECTED_BUILD.MAX_HOPS, EXPANSION.REACH_JUMPS,
);

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

export function sizingParams(): { seedPop: number; establishWork: number } {
  return { seedPop: EXPANSION.COLONY_SEED_POP, establishWork: COLONISATION.COLONY_ESTABLISH_WORK };
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
