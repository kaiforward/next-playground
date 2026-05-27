import { prisma } from "@/lib/prisma";
import { ServiceError } from "./errors";
import {
  deriveFactionStatus,
  toDoctrine,
  toEconomyType,
  toGovernmentType,
} from "@/lib/types/guards";
import { DOCTRINES } from "@/lib/constants/doctrines";
import { GOVERNMENT_TYPES } from "@/lib/constants/government";
import { getRelationTier, type RelationTier } from "@/lib/constants/relations";
import { isEventTypeId } from "@/lib/types/guards";
import type { EventTypeId } from "@/lib/constants/events";
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
  territorySample: FactionTerritorySystem[];
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

/** List all factions with derived status and territory size. */
export async function listFactions(): Promise<FactionSummary[]> {
  const rows = await prisma.faction.findMany({
    select: {
      id: true,
      name: true,
      description: true,
      color: true,
      governmentType: true,
      doctrine: true,
      homeworldId: true,
      homeworld: { select: { name: true } },
      _count: { select: { territory: true } },
    },
    orderBy: { name: "asc" },
  });

  const totalSystems = rows.reduce((sum, r) => sum + r._count.territory, 0);

  return rows.map((r) => {
    const gov = toGovernmentType(r.governmentType);
    const doc = toDoctrine(r.doctrine);
    const territorySize = r._count.territory;
    return {
      id: r.id,
      name: r.name,
      description: r.description,
      color: r.color,
      governmentType: gov,
      governmentName: GOVERNMENT_TYPES[gov].name,
      doctrine: doc,
      doctrineName: DOCTRINES[doc].name,
      homeworldId: r.homeworldId,
      homeworldName: r.homeworld.name,
      territorySize,
      status: deriveFactionStatus(territorySize, totalSystems),
    };
  });
}

/** Detail for one faction with territory sample, per-faction relations, and active alliances. */
export async function getFactionDetail(
  factionId: string,
  territorySampleLimit = 20,
): Promise<FactionDetail> {
  const faction = await prisma.faction.findUnique({
    where: { id: factionId },
    select: {
      id: true,
      name: true,
      description: true,
      color: true,
      governmentType: true,
      doctrine: true,
      homeworldId: true,
      homeworld: { select: { name: true } },
      _count: { select: { territory: true } },
    },
  });
  if (!faction) {
    throw new ServiceError(`Faction ${factionId} not found.`, 404);
  }

  const gov = toGovernmentType(faction.governmentType);
  const doc = toDoctrine(faction.doctrine);
  const territorySize = faction._count.territory;

  const [
    territorySample,
    otherFactions,
    relationsA,
    relationsB,
    alliancesA,
    alliancesB,
    relatedEventRows,
  ] = await Promise.all([
    prisma.starSystem.findMany({
      where: { factionId },
      select: { id: true, name: true, economyType: true, isGateway: true },
      orderBy: [{ isGateway: "desc" }, { name: "asc" }],
      take: territorySampleLimit,
    }),
    prisma.faction.findMany({
      where: { id: { not: factionId } },
      select: {
        id: true,
        name: true,
        color: true,
        _count: { select: { territory: true } },
      },
    }),
    prisma.factionRelation.findMany({
      where: { factionAId: factionId },
      select: { factionBId: true, score: true },
    }),
    prisma.factionRelation.findMany({
      where: { factionBId: factionId },
      select: { factionAId: true, score: true },
    }),
    prisma.alliancePact.findMany({
      where: { factionAId: factionId },
      select: {
        factionBId: true,
        formedAtTick: true,
        pendingDissolutionAtTick: true,
      },
    }),
    prisma.alliancePact.findMany({
      where: { factionBId: factionId },
      select: {
        factionAId: true,
        formedAtTick: true,
        pendingDissolutionAtTick: true,
      },
    }),
    // Relations-spawned events touching this faction. Identified by the
    // factionId substring inside the JSON metadata column — cuids are unique
    // enough across the table that false matches are negligible. Ordered
    // newest-first; cap at 10 for the panel surface.
    prisma.gameEvent.findMany({
      where: {
        type: { in: ["border_conflict", "pact_under_negotiation", "alliance_dissolved"] },
        metadata: { contains: factionId },
      },
      select: {
        id: true,
        type: true,
        phase: true,
        startTick: true,
        systemId: true,
        system: { select: { name: true } },
        metadata: true,
      },
      orderBy: { startTick: "desc" },
      take: 10,
    }),
  ]);

  // Status is relative to the total factioned-system pool — sum across this
  // faction plus all others. `getFactions` queries already returned `_count.territory`.
  const totalSystems =
    territorySize + otherFactions.reduce((sum, o) => sum + o._count.territory, 0);
  const status = deriveFactionStatus(territorySize, totalSystems);

  const scoreByOther = new Map<string, number>();
  for (const r of relationsA) scoreByOther.set(r.factionBId, r.score);
  for (const r of relationsB) scoreByOther.set(r.factionAId, r.score);

  const allianceByOther = new Map<
    string,
    { formedAtTick: number; pendingDissolutionAtTick: number | null }
  >();
  for (const a of alliancesA) {
    allianceByOther.set(a.factionBId, {
      formedAtTick: a.formedAtTick,
      pendingDissolutionAtTick: a.pendingDissolutionAtTick,
    });
  }
  for (const a of alliancesB) {
    allianceByOther.set(a.factionAId, {
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
        otherFactionStatus: deriveFactionStatus(o._count.territory, totalSystems),
        score,
        tier: getRelationTier(score),
        hasAlliance: allianceByOther.has(o.id),
      };
    })
    .sort((a, b) => b.score - a.score);

  const otherById = new Map(otherFactions.map((o) => [o.id, o]));

  const recentEvents: FactionRelatedEvent[] = [];
  for (const ev of relatedEventRows) {
    if (!isEventTypeId(ev.type)) continue;
    const { otherFactionId, otherFactionName } = resolveEventOtherFaction(
      ev.metadata,
      factionId,
      otherById,
    );
    recentEvents.push({
      id: ev.id,
      type: ev.type,
      phase: ev.phase,
      startTick: ev.startTick,
      systemId: ev.systemId,
      systemName: ev.system?.name ?? null,
      otherFactionId,
      otherFactionName,
    });
  }

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

  return {
    id: faction.id,
    name: faction.name,
    description: faction.description,
    color: faction.color,
    governmentType: gov,
    governmentName: GOVERNMENT_TYPES[gov].name,
    governmentDescription: GOVERNMENT_TYPES[gov].description,
    doctrine: doc,
    doctrineName: DOCTRINES[doc].name,
    doctrineDescription: DOCTRINES[doc].description,
    homeworldId: faction.homeworldId,
    homeworldName: faction.homeworld.name,
    territorySize,
    status,
    territorySample: territorySample.map((s) => ({
      id: s.id,
      name: s.name,
      economyType: toEconomyType(s.economyType),
      isGateway: s.isGateway,
    })),
    relations,
    alliances: alliancesList,
    recentEvents,
  };
}

/**
 * Pull the partner faction id+name out of a relations-event metadata blob.
 * The metadata contains a factionA/factionB pair; whichever is not the
 * subject faction is the partner. Returns nulls when parsing fails or the
 * partner isn't in the known faction set.
 */
function resolveEventOtherFaction(
  metadataJson: string,
  selfFactionId: string,
  otherById: Map<string, { id: string; name: string }>,
): { otherFactionId: string | null; otherFactionName: string | null } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(metadataJson);
  } catch {
    return { otherFactionId: null, otherFactionName: null };
  }
  if (typeof parsed !== "object" || parsed === null) {
    return { otherFactionId: null, otherFactionName: null };
  }
  const a = "factionAId" in parsed && typeof parsed.factionAId === "string"
    ? parsed.factionAId
    : null;
  const b = "factionBId" in parsed && typeof parsed.factionBId === "string"
    ? parsed.factionBId
    : null;
  const otherId = a === selfFactionId ? b : b === selfFactionId ? a : null;
  if (!otherId) return { otherFactionId: null, otherFactionName: null };
  const other = otherById.get(otherId);
  return {
    otherFactionId: otherId,
    otherFactionName: other?.name ?? null,
  };
}

/** Full relations matrix across all factions. */
export async function getRelationsMatrix(): Promise<RelationsMatrixData> {
  const [factions, relations, alliances] = await Promise.all([
    prisma.faction.findMany({
      select: {
        id: true,
        name: true,
        color: true,
        governmentType: true,
        doctrine: true,
        _count: { select: { territory: true } },
      },
      orderBy: { name: "asc" },
    }),
    prisma.factionRelation.findMany({
      select: { factionAId: true, factionBId: true, score: true },
    }),
    prisma.alliancePact.findMany({
      select: { factionAId: true, factionBId: true },
    }),
  ]);

  const allianceKeys = new Set<string>();
  for (const a of alliances) {
    allianceKeys.add(`${a.factionAId}|${a.factionBId}`);
  }

  const totalSystems = factions.reduce((sum, f) => sum + f._count.territory, 0);

  return {
    factions: factions.map((f) => {
      const territorySize = f._count.territory;
      return {
        id: f.id,
        name: f.name,
        color: f.color,
        governmentType: toGovernmentType(f.governmentType),
        doctrine: toDoctrine(f.doctrine),
        status: deriveFactionStatus(territorySize, totalSystems),
        territorySize,
      };
    }),
    pairs: relations.map((r) => ({
      factionAId: r.factionAId,
      factionBId: r.factionBId,
      score: r.score,
      tier: getRelationTier(r.score),
      hasAlliance: allianceKeys.has(`${r.factionAId}|${r.factionBId}`),
    })),
  };
}
