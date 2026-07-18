import { getWorld } from "@/lib/world/store";
import { systemNameById } from "./world-index";
import { ServiceError } from "./errors";
import { deriveFactionStatus } from "@/lib/types/guards";
import { DOCTRINES } from "@/lib/constants/doctrines";
import { GOVERNMENT_TYPES } from "@/lib/constants/government";
import { getRelationTier, type RelationTier } from "@/lib/constants/relations";
import type { EventTypeId } from "@/lib/constants/events";
import type { World, WorldFaction } from "@/lib/world/types";
import type {
  Doctrine,
  EconomyType,
  FactionStatus,
  GovernmentType,
} from "@/lib/types/game";

export interface FactionSummary {
  id: string;
  name: string;
  description: string;
  color: string;
  governmentType: GovernmentType;
  governmentName: string;
  doctrine: Doctrine;
  doctrineName: string;
  homeworldId: string;
  homeworldName: string;
  territorySize: number;
  status: FactionStatus;
  /** True for the faction the human player controls (world.player); false for AI factions. */
  isPlayer: boolean;
}

export interface FactionTerritorySystem {
  id: string;
  name: string;
  economyType: EconomyType;
  isGateway: boolean;
}

export interface FactionRelationRow {
  otherFactionId: string;
  otherFactionName: string;
  otherFactionColor: string;
  otherFactionStatus: FactionStatus;
  score: number;
  tier: RelationTier;
  hasAlliance: boolean;
}

export interface FactionAllianceRow {
  otherFactionId: string;
  otherFactionName: string;
  otherFactionColor: string;
  formedAtTick: number;
  pendingDissolutionAtTick: number | null;
}

export interface FactionRelatedEvent {
  id: string;
  type: EventTypeId;
  phase: string;
  startTick: number;
  systemId: string | null;
  systemName: string | null;
  otherFactionId: string | null;
  otherFactionName: string | null;
}

export interface FactionDetail extends FactionSummary {
  doctrineDescription: string;
  governmentDescription: string;
  /** Every system the faction owns, gateways first then name-sorted (the Territory tab's list). */
  territory: FactionTerritorySystem[];
  relations: FactionRelationRow[];
  alliances: FactionAllianceRow[];
  recentEvents: FactionRelatedEvent[];
}

export interface RelationsMatrixFaction {
  id: string;
  name: string;
  color: string;
  governmentType: GovernmentType;
  doctrine: Doctrine;
  status: FactionStatus;
  territorySize: number;
}

export interface RelationsMatrixPair {
  factionAId: string;
  factionBId: string;
  score: number;
  tier: RelationTier;
  hasAlliance: boolean;
}

export interface RelationsMatrixData {
  factions: RelationsMatrixFaction[];
  pairs: RelationsMatrixPair[];
}

/** Systems owned per faction id, over the whole world. */
function territoryCounts(world: World): Map<string, number> {
  const counts = new Map<string, number>();
  for (const s of world.systems) {
    if (!s.factionId) continue;
    counts.set(s.factionId, (counts.get(s.factionId) ?? 0) + 1);
  }
  return counts;
}

function toSummary(
  faction: WorldFaction,
  world: World,
  territorySize: number,
  totalSystems: number,
): FactionSummary {
  const homeworld = world.systems.find((s) => s.id === faction.homeworldId);
  return {
    id: faction.id,
    name: faction.name,
    description: faction.description,
    color: faction.color,
    governmentType: faction.governmentType,
    governmentName: GOVERNMENT_TYPES[faction.governmentType].name,
    doctrine: faction.doctrine,
    doctrineName: DOCTRINES[faction.doctrine].name,
    homeworldId: faction.homeworldId,
    homeworldName: homeworld?.name ?? "",
    territorySize,
    status: deriveFactionStatus(territorySize, totalSystems),
    isPlayer: world.player?.controlledFactionId === faction.id,
  };
}

/** List all factions with derived status and territory size. */
export function listFactions(): FactionSummary[] {
  const world = getWorld();
  const counts = territoryCounts(world);
  const totalSystems = [...counts.values()].reduce((sum, c) => sum + c, 0);

  return [...world.factions]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((f) => toSummary(f, world, counts.get(f.id) ?? 0, totalSystems));
}

/** Detail for one faction with its full territory list, per-faction relations, and active alliances. */
export function getFactionDetail(factionId: string): FactionDetail {
  const world = getWorld();
  const faction = world.factions.find((f) => f.id === factionId);
  if (!faction) {
    throw new ServiceError(`Faction ${factionId} not found.`, 404);
  }

  const counts = territoryCounts(world);
  const totalSystems = [...counts.values()].reduce((sum, c) => sum + c, 0);
  const territorySize = counts.get(factionId) ?? 0;

  const otherFactions = world.factions.filter((f) => f.id !== factionId);

  const scoreByOther = new Map<string, number>();
  for (const r of world.relations) {
    if (r.factionAId === factionId) scoreByOther.set(r.factionBId, r.score);
    else if (r.factionBId === factionId) scoreByOther.set(r.factionAId, r.score);
  }

  const allianceByOther = new Map<
    string,
    { formedAtTick: number; pendingDissolutionAtTick: number | null }
  >();
  for (const a of world.alliancePacts) {
    const otherId =
      a.factionAId === factionId ? a.factionBId : a.factionBId === factionId ? a.factionAId : null;
    if (!otherId) continue;
    allianceByOther.set(otherId, {
      formedAtTick: a.formedAtTick,
      pendingDissolutionAtTick: a.pendingDissolutionAtTick,
    });
  }

  const relations: FactionRelationRow[] = otherFactions
    .map((o) => {
      const score = scoreByOther.get(o.id) ?? 0;
      return {
        otherFactionId: o.id,
        otherFactionName: o.name,
        otherFactionColor: o.color,
        otherFactionStatus: deriveFactionStatus(counts.get(o.id) ?? 0, totalSystems),
        score,
        tier: getRelationTier(score),
        hasAlliance: allianceByOther.has(o.id),
      };
    })
    .sort((a, b) => b.score - a.score);

  const otherById = new Map(otherFactions.map((o) => [o.id, o]));
  const nameById = systemNameById();

  // Relations-spawned events touching this faction, newest-first, capped at
  // 10 for the panel surface.
  const recentEvents: FactionRelatedEvent[] = world.events
    .filter(
      (ev) =>
        ev.metadata !== null &&
        (ev.metadata.factionAId === factionId || ev.metadata.factionBId === factionId),
    )
    .sort((a, b) => b.startTick - a.startTick)
    .slice(0, 10)
    .map((ev) => {
      const metadata = ev.metadata;
      const otherId = metadata
        ? metadata.factionAId === factionId
          ? metadata.factionBId
          : metadata.factionAId
        : null;
      const other = otherId ? otherById.get(otherId) : undefined;
      return {
        id: ev.id,
        type: ev.type,
        phase: ev.phase,
        startTick: ev.startTick,
        systemId: ev.systemId,
        systemName: ev.systemId ? nameById.get(ev.systemId) ?? null : null,
        otherFactionId: otherId,
        otherFactionName: other?.name ?? null,
      };
    });

  const alliancesList: FactionAllianceRow[] = [];
  for (const o of otherFactions) {
    const pact = allianceByOther.get(o.id);
    if (!pact) continue;
    alliancesList.push({
      otherFactionId: o.id,
      otherFactionName: o.name,
      otherFactionColor: o.color,
      formedAtTick: pact.formedAtTick,
      pendingDissolutionAtTick: pact.pendingDissolutionAtTick,
    });
  }
  alliancesList.sort((a, b) => b.formedAtTick - a.formedAtTick);

  const territory: FactionTerritorySystem[] = world.systems
    .filter((s) => s.factionId === factionId)
    .sort((a, b) => Number(b.isGateway) - Number(a.isGateway) || a.name.localeCompare(b.name))
    .map((s) => ({
      id: s.id,
      name: s.name,
      economyType: s.economyType,
      isGateway: s.isGateway,
    }));

  return {
    ...toSummary(faction, world, territorySize, totalSystems),
    governmentDescription: GOVERNMENT_TYPES[faction.governmentType].description,
    doctrineDescription: DOCTRINES[faction.doctrine].description,
    territory,
    relations,
    alliances: alliancesList,
    recentEvents,
  };
}

/** Full relations matrix across all factions. */
export function getRelationsMatrix(): RelationsMatrixData {
  const world = getWorld();
  const counts = territoryCounts(world);
  const totalSystems = [...counts.values()].reduce((sum, c) => sum + c, 0);

  const allianceKeys = new Set<string>();
  for (const a of world.alliancePacts) {
    allianceKeys.add(`${a.factionAId}|${a.factionBId}`);
  }

  return {
    factions: [...world.factions]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((f) => {
        const territorySize = counts.get(f.id) ?? 0;
        return {
          id: f.id,
          name: f.name,
          color: f.color,
          governmentType: f.governmentType,
          doctrine: f.doctrine,
          status: deriveFactionStatus(territorySize, totalSystems),
          territorySize,
        };
      }),
    pairs: world.relations.map((r) => ({
      factionAId: r.factionAId,
      factionBId: r.factionBId,
      score: r.score,
      tier: getRelationTier(r.score),
      hasAlliance: allianceKeys.has(`${r.factionAId}|${r.factionBId}`),
    })),
  };
}
