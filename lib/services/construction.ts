/**
 * Construction read services — thin marshallers over the pure `computeFactionConstruction` readout.
 * The faction roll-up reads the whole readout; the per-system section reads it filtered to one system
 * (ETA needs the whole faction queue, so both go through one faction-scoped computation). Read-only.
 *
 * Server-only, because a colony row's stall reason is priced: it reads `ECONOMY_SCALE` to compare
 * what the next staging draw would cost against the faction's working balance. The client only ever
 * sees the resolved reason.
 */
import { getWorld } from "@/lib/world/store";
import { ServiceError } from "@/lib/services/errors";
import { CONSTRUCTION } from "@/lib/constants/construction";
import { COLONISATION } from "@/lib/constants/colonisation";
import { ECONOMY_SCALE } from "@/lib/constants/economy-scale";
import { buildingsBySystem } from "@/lib/services/world-index";
import {
  computeFactionConstruction,
  type ConstructionSystemInfo,
  type FactionConstructionReadout,
  type FoundingReadoutInputs,
} from "@/lib/engine/construction-readout";
import { orderOpenProjects } from "@/lib/engine/construction";
import { surplusDrawable } from "@/lib/engine/directed-logistics";
import { resourceVectorFromColumns } from "@/lib/engine/resources";
import { safeMoney } from "@/lib/engine/treasury";
import type { FoundingSourceSupply } from "@/lib/engine/founding-cost";
import { toGoodMarketStates } from "@/lib/tick/processors/good-market-state";
import { marketRowsBySystem } from "@/lib/world/tick";
import type { World, WorldConstructionProject } from "@/lib/world/types";
import type { SystemConstructionData, FactionConstructionData } from "@/lib/types/api";

/**
 * What each in-flight colony's source can spare it, read exactly as the staging draw reads it: the
 * shared market-state derivation, then the export rule, then the row's live stock (a plan may never
 * promise more goods than physically sit there). Only the sources of open colonies are derived —
 * on the common queue that is nothing at all.
 */
function foundingSupplyBySource(
  world: World,
  projects: WorldConstructionProject[],
  buildings: Map<string, Record<string, number>>,
): Map<string, FoundingSourceSupply[]> {
  const supply = new Map<string, FoundingSourceSupply[]>();
  const sourceIds = new Set(
    projects.filter((p) => p.kind === "colony_establish").map((p) => p.sourceSystemId),
  );
  if (sourceIds.size === 0) return supply;

  const marketRows = marketRowsBySystem(world.markets);
  for (const sourceId of sourceIds) {
    const source = world.systems.find((s) => s.id === sourceId);
    if (source === undefined) continue;
    const states = toGoodMarketStates({
      buildings: buildings.get(sourceId) ?? {},
      population: source.population,
      yields: resourceVectorFromColumns(
        {
          yieldGas: source.yieldGas, yieldMinerals: source.yieldMinerals, yieldOre: source.yieldOre,
          yieldBiomass: source.yieldBiomass, yieldArable: source.yieldArable,
          yieldWater: source.yieldWater, yieldRadioactive: source.yieldRadioactive,
        },
        "yield",
      ),
      markets: marketRows.get(sourceId) ?? [],
    });
    supply.set(
      sourceId,
      states.map((g) => ({
        goodId: g.goodId,
        sparable: Math.min(
          surplusDrawable(g.stock, g.donorReserve, g.demand, g.production, g.productionSuppressed),
          Math.max(0, g.stock),
        ),
      })),
    );
  }
  return supply;
}

function readoutForFaction(factionId: string): FactionConstructionReadout {
  const world = getWorld();
  const faction = world.factions.find((f) => f.id === factionId);
  if (!faction) throw new ServiceError(`Faction ${factionId} not found.`, 404);

  const buildings = buildingsBySystem();
  const systems: ConstructionSystemInfo[] = world.systems
    .filter((s) => s.factionId === factionId)
    .map((s) => ({
      id: s.id, name: s.name, control: s.control, population: s.population,
      buildings: buildings.get(s.id) ?? {},
    }));
  const projects = orderOpenProjects(world.constructionProjects.filter((p) => p.factionId === factionId));

  const treasury = world.treasuries.find((t) => t.factionId === factionId);
  const founding: FoundingReadoutInputs = {
    workingBalance:
      treasury === undefined
        ? 0
        : safeMoney(safeMoney(treasury.balance) - safeMoney(treasury.pendingFounding)),
    supplyBySource: foundingSupplyBySource(world, projects, buildings),
    cover: COLONISATION.FOUNDING_STOCK_COVER,
    economyScale: ECONOMY_SCALE,
  };

  return computeFactionConstruction(
    projects, systems,
    { throughputPerPop: CONSTRUCTION.THROUGHPUT_PER_POP, pointsPerLevel: CONSTRUCTION.POINTS_PER_LEVEL },
    CONSTRUCTION.PER_BUILD_ABSORPTION_CAP,
    founding,
  );
}

export function getFactionConstruction(factionId: string): FactionConstructionData {
  const readout = readoutForFaction(factionId);
  const world = getWorld();

  const bySystem = new Map<string, { systemName: string; count: number }>();
  const colonies: Array<{ systemId: string; systemName: string; progress: number }> = [];
  let orderedCount = 0;
  for (const row of readout.all) {
    if (row.origin === "player") orderedCount += 1;
    if (row.kind === "colony_establish") {
      colonies.push({ systemId: row.systemId, systemName: row.systemName, progress: row.progress });
    } else {
      const entry = bySystem.get(row.systemId) ?? { systemName: row.systemName, count: 0 };
      entry.count += 1;
      bySystem.set(row.systemId, entry);
    }
  }
  const buildSystems = [...bySystem]
    .map(([systemId, v]) => ({ systemId, systemName: v.systemName, count: v.count }))
    .sort((a, b) => b.count - a.count || a.systemName.localeCompare(b.systemName));
  colonies.sort((a, b) => b.progress - a.progress || a.systemName.localeCompare(b.systemName));

  const automation =
    world.player?.controlledFactionId === factionId ? { ...world.player.automation } : null;

  return {
    factionId,
    pool: readout.pool, poolBase: readout.poolBase, poolCentres: readout.poolCentres,
    automation, buildSystems, colonies, orderedCount,
  };
}

export function getSystemConstruction(systemId: string): SystemConstructionData {
  const world = getWorld();
  const system = world.systems.find((s) => s.id === systemId);
  if (!system) throw new ServiceError(`System ${systemId} not found.`, 404);
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
