/**
 * Construction read services — thin marshallers over the pure `computeFactionConstruction` readout.
 * The faction roll-up reads the whole readout; the per-system section reads it filtered to one system
 * (ETA needs the whole faction queue, so both go through one faction-scoped computation). Read-only.
 */
import { getWorld } from "@/lib/world/store";
import { ServiceError } from "@/lib/services/errors";
import { CONSTRUCTION } from "@/lib/constants/construction";
import {
  computeFactionConstruction,
  type ConstructionSystemInfo,
  type FactionConstructionReadout,
} from "@/lib/engine/construction-readout";
import type { SystemConstructionData, FactionConstructionData } from "@/lib/types/api";

function readoutForFaction(factionId: string): FactionConstructionReadout {
  const world = getWorld();
  const faction = world.factions.find((f) => f.id === factionId);
  if (!faction) throw new ServiceError("Faction not found.", 404);

  const systems: ConstructionSystemInfo[] = world.systems
    .filter((s) => s.factionId === factionId)
    .map((s) => ({ id: s.id, name: s.name, control: s.control, population: s.population }));
  const projects = world.constructionProjects.filter((p) => p.factionId === factionId);

  return computeFactionConstruction(
    projects, systems, CONSTRUCTION.THROUGHPUT_PER_POP, CONSTRUCTION.PER_BUILD_ABSORPTION_CAP,
  );
}

export function getFactionConstruction(factionId: string): FactionConstructionData {
  const readout = readoutForFaction(factionId);
  return {
    factionId,
    pool: readout.pool,
    expandCount: readout.expandCount,
    buildCount: readout.buildCount,
    expansion: readout.expansion,
    buildOut: readout.buildOut,
  };
}

export function getSystemConstruction(systemId: string): SystemConstructionData {
  const world = getWorld();
  const system = world.systems.find((s) => s.id === systemId);
  if (!system) throw new ServiceError("System not found.", 404);
  // Unclaimed/independent systems have no faction pool → nothing to show.
  if (!system.factionId) return { visibility: "hidden" };

  const readout = readoutForFaction(system.factionId);
  const projects = readout.all.filter((r) => r.systemId === systemId);
  if (projects.length > 0) return { visibility: "visible", factionId: system.factionId, projects };
  // Nothing under way here: a controlled world still shows the section (that's the question you
  // bring to it); a developed world hides it (avoids clutter on the common case).
  if (system.control === "controlled") return { visibility: "empty", control: "controlled", factionId: system.factionId };
  return { visibility: "hidden" };
}
