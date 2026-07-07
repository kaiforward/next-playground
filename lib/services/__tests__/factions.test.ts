import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { generateWorld } from "@/lib/world/gen";
import { setWorld, clearWorld } from "@/lib/world/store";
import { listFactions, getFactionDetail, getRelationsMatrix } from "@/lib/services/factions";
import { ServiceError } from "@/lib/services/errors";
import type { World, WorldEvent } from "@/lib/world/types";

let world: World;

beforeEach(() => {
  world = generateWorld({ systemCount: 60, seed: 13 });
  setWorld(world);
});

afterEach(() => {
  clearWorld();
});

// Pact rows must be stored with factionAId < factionBId (canonical).
function canonical(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

function relationEvent(
  id: string,
  factionAId: string,
  factionBId: string,
  overrides: Partial<WorldEvent> = {},
): WorldEvent {
  return {
    id,
    type: "border_conflict",
    phase: "active",
    systemId: null,
    regionId: null,
    startTick: 5,
    phaseStartTick: 5,
    phaseDuration: 10,
    severity: 1,
    sourceEventId: null,
    metadata: { factionAId, factionBId, expiresAtTick: 100 },
    ...overrides,
  };
}

describe("listFactions", () => {
  it("returns typed summaries whose territory counts match the world", () => {
    const rows = listFactions();
    expect(rows).toHaveLength(world.factions.length);

    for (const row of rows) {
      const owned = world.systems.filter((s) => s.factionId === row.id).length;
      expect(row.territorySize).toBe(owned);
      expect(row.governmentName.length).toBeGreaterThan(0);
      expect(row.doctrineName.length).toBeGreaterThan(0);
      const homeworld = world.systems.find((s) => s.id === row.homeworldId)!;
      expect(row.homeworldName).toBe(homeworld.name);
    }
  });

  it("returns rows sorted by name ascending", () => {
    const names = listFactions().map((r) => r.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });
});

describe("getFactionDetail", () => {
  it("throws ServiceError(404) for an unknown factionId", () => {
    expect(() => getFactionDetail("does-not-exist")).toThrow(ServiceError);
    try {
      getFactionDetail("does-not-exist");
    } catch (error) {
      expect(error).toMatchObject({ status: 404 });
    }
  });

  it("returns a relations row for every other faction with the seeded score", () => {
    const faction = world.factions[0];
    const detail = getFactionDetail(faction.id);

    expect(detail.relations).toHaveLength(world.factions.length - 1);
    for (const rel of detail.relations) {
      const [aId, bId] = canonical(faction.id, rel.otherFactionId);
      const seeded = world.relations.find(
        (r) => r.factionAId === aId && r.factionBId === bId,
      )!;
      expect(rel.score).toBe(seeded.score);
    }
    // Sorted best-relations-first.
    for (let i = 1; i < detail.relations.length; i++) {
      expect(detail.relations[i].score).toBeLessThanOrEqual(detail.relations[i - 1].score);
    }
  });

  it("surfaces active alliance pacts in both directions", () => {
    const [aId, bId] = canonical(world.factions[0].id, world.factions[1].id);
    setWorld({
      ...world,
      alliancePacts: [
        { factionAId: aId, factionBId: bId, formedAtTick: 7, pendingDissolutionAtTick: null },
      ],
    });

    for (const [selfId, otherId] of [[aId, bId], [bId, aId]]) {
      const detail = getFactionDetail(selfId);
      expect(detail.alliances).toHaveLength(1);
      expect(detail.alliances[0].otherFactionId).toBe(otherId);
      expect(detail.alliances[0].formedAtTick).toBe(7);
      const rel = detail.relations.find((r) => r.otherFactionId === otherId)!;
      expect(rel.hasAlliance).toBe(true);
    }
  });

  it("resolves the partner faction from event metadata regardless of which side is factionA", () => {
    const fed = world.factions[0].id;
    const corp = world.factions[1].id;
    setWorld({
      ...world,
      events: [
        relationEvent("ev-1", fed, corp),
        relationEvent("ev-2", corp, fed, { type: "pact_under_negotiation", startTick: 6 }),
      ],
    });

    const detail = getFactionDetail(fed);
    expect(detail.recentEvents).toHaveLength(2);
    for (const ev of detail.recentEvents) {
      expect(ev.otherFactionId).toBe(corp);
      expect(ev.otherFactionName).toBe(world.factions[1].name);
    }
  });

  it("returns null partner name when metadata references a faction that doesn't exist", () => {
    const fed = world.factions[0].id;
    const ghostId = "ghost-faction-id-that-isnt-seeded";
    setWorld({
      ...world,
      events: [relationEvent("ev-ghost", fed, ghostId, { type: "alliance_dissolved" })],
    });

    const detail = getFactionDetail(fed);
    expect(detail.recentEvents).toHaveLength(1);
    expect(detail.recentEvents[0].otherFactionId).toBe(ghostId);
    expect(detail.recentEvents[0].otherFactionName).toBeNull();
  });

  it("orders the territory sample with gateways first", () => {
    const faction = world.factions.find(
      (f) => world.systems.filter((s) => s.factionId === f.id).length >= 2,
    )!;
    const owned = world.systems.filter((s) => s.factionId === faction.id);

    // Force exactly one owned system to be a gateway (a non-first one by name,
    // so ordering is observable).
    const target = owned[owned.length - 1];
    setWorld({
      ...world,
      systems: world.systems.map((s) => ({ ...s, isGateway: s.id === target.id })),
    });

    const detail = getFactionDetail(faction.id);
    expect(detail.territorySample[0].id).toBe(target.id);
    expect(detail.territorySample[0].isGateway).toBe(true);
  });
});

describe("getRelationsMatrix", () => {
  it("returns one row per faction and one pair per seeded relation", () => {
    const matrix = getRelationsMatrix();
    expect(matrix.factions).toHaveLength(world.factions.length);
    expect(matrix.pairs).toHaveLength(world.relations.length);
  });

  it("includes hasAlliance:true for pairs with an active pact", () => {
    const [aId, bId] = canonical(world.factions[0].id, world.factions[1].id);
    setWorld({
      ...world,
      alliancePacts: [
        { factionAId: aId, factionBId: bId, formedAtTick: 0, pendingDissolutionAtTick: null },
      ],
    });

    const matrix = getRelationsMatrix();
    const pair = matrix.pairs.find((p) => p.factionAId === aId && p.factionBId === bId)!;
    expect(pair.hasAlliance).toBe(true);
    expect(matrix.pairs.filter((p) => p.hasAlliance)).toHaveLength(1);
  });
});
