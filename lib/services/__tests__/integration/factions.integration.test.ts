import { describe, it, expect, vi, beforeEach } from "vitest";
import { useIntegrationDb } from "@/lib/test-utils/integration";
import { seedTestUniverse } from "@/lib/test-utils/fixtures";
import type { TestUniverse } from "@/lib/test-utils/fixtures";
import { ServiceError } from "@/lib/services/errors";

const { prisma } = useIntegrationDb();
vi.mock("@/lib/prisma", () => ({ prisma }));

const { listFactions, getFactionDetail, getRelationsMatrix } =
  await import("@/lib/services/factions");

// Pact + relation rows must be stored with factionAId < factionBId (canonical).
function canonical(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

describe("factions service (integration)", () => {
  let universe: TestUniverse;

  beforeEach(async () => {
    universe = await seedTestUniverse(prisma);
  });

  describe("listFactions", () => {
    it("returns typed summaries with derived territory counts and status", async () => {
      const rows = await listFactions();

      expect(rows).toHaveLength(2);

      const fed = rows.find((r) => r.id === universe.factions.federation);
      const corp = rows.find((r) => r.id === universe.factions.corporate);
      expect(fed).toBeDefined();
      expect(corp).toBeDefined();

      // Fixture: federation owns 1 system, corporate owns 2 (out of 3 total).
      expect(fed?.territorySize).toBe(1);
      expect(corp?.territorySize).toBe(2);
      expect(fed?.governmentType).toBe("federation");
      expect(corp?.governmentType).toBe("corporate");
      expect(fed?.doctrine).toBe("protectionist");
      expect(corp?.doctrine).toBe("mercantile");
      // Resolved names should be non-empty (sourced from constants tables).
      expect(fed?.governmentName.length).toBeGreaterThan(0);
      expect(fed?.doctrineName.length).toBeGreaterThan(0);
      expect(fed?.homeworldName).toContain("Harvest Prime");
    });

    it("returns rows sorted by name ascending", async () => {
      const rows = await listFactions();
      const names = rows.map((r) => r.name);
      const sorted = [...names].sort();
      expect(names).toEqual(sorted);
    });
  });

  describe("getFactionDetail", () => {
    it("throws ServiceError(404) for an unknown factionId", async () => {
      await expect(getFactionDetail("does-not-exist")).rejects.toBeInstanceOf(
        ServiceError,
      );
      await expect(getFactionDetail("does-not-exist")).rejects.toMatchObject({
        status: 404,
      });
    });

    it("returns full detail including territory sample and relations row for each other faction", async () => {
      const detail = await getFactionDetail(universe.factions.federation);

      expect(detail.id).toBe(universe.factions.federation);
      expect(detail.territorySize).toBe(1);
      // Territory sample lists only owned systems.
      expect(detail.territorySample).toHaveLength(1);
      expect(detail.territorySample[0].name).toContain("Harvest Prime");

      // Relations row exists for every other faction even when no relation row is stored.
      expect(detail.relations).toHaveLength(1);
      const relToCorp = detail.relations[0];
      expect(relToCorp.otherFactionId).toBe(universe.factions.corporate);
      expect(relToCorp.score).toBe(0); // defaulted — no FactionRelation row seeded
      expect(relToCorp.hasAlliance).toBe(false);

      // No alliances, no recent events seeded.
      expect(detail.alliances).toEqual([]);
      expect(detail.recentEvents).toEqual([]);
    });

    it("reflects stored FactionRelation scores regardless of canonical pair direction", async () => {
      const [aId, bId] = canonical(
        universe.factions.federation,
        universe.factions.corporate,
      );
      await prisma.factionRelation.create({
        data: { factionAId: aId, factionBId: bId, score: 42 },
      });
      const detail = await getFactionDetail(universe.factions.federation);
      expect(detail.relations[0].score).toBe(42);
    });

    it("surfaces active alliance pacts in both directions", async () => {
      const [aId, bId] = canonical(
        universe.factions.federation,
        universe.factions.corporate,
      );
      await prisma.alliancePact.create({
        data: {
          factionAId: aId,
          factionBId: bId,
          formedAtTick: 7,
          pendingDissolutionAtTick: null,
        },
      });

      const fedDetail = await getFactionDetail(universe.factions.federation);
      expect(fedDetail.alliances).toHaveLength(1);
      expect(fedDetail.alliances[0].otherFactionId).toBe(universe.factions.corporate);
      expect(fedDetail.alliances[0].formedAtTick).toBe(7);
      expect(fedDetail.relations[0].hasAlliance).toBe(true);

      const corpDetail = await getFactionDetail(universe.factions.corporate);
      expect(corpDetail.alliances).toHaveLength(1);
      expect(corpDetail.alliances[0].otherFactionId).toBe(universe.factions.federation);
      expect(corpDetail.relations[0].hasAlliance).toBe(true);
    });

    it("resolves the partner faction from event metadata regardless of which side is factionA", async () => {
      const fed = universe.factions.federation;
      const corp = universe.factions.corporate;

      await prisma.gameEvent.create({
        data: {
          type: "border_conflict",
          phase: "active",
          startTick: 5,
          phaseStartTick: 5,
          phaseDuration: 10,
          systemId: universe.systems.agricultural,
          metadata: JSON.stringify({ factionAId: fed, factionBId: corp }),
        },
      });
      await prisma.gameEvent.create({
        data: {
          type: "pact_under_negotiation",
          phase: "active",
          startTick: 6,
          phaseStartTick: 6,
          phaseDuration: 10,
          systemId: null,
          // Partner on the other side of the pair.
          metadata: JSON.stringify({ factionAId: corp, factionBId: fed }),
        },
      });

      const detail = await getFactionDetail(fed);
      expect(detail.recentEvents).toHaveLength(2);
      for (const ev of detail.recentEvents) {
        expect(ev.otherFactionId).toBe(corp);
        expect(ev.otherFactionName).toContain("Corporate");
      }
    });

    it("returns the event row with null partner fields when metadata is malformed", async () => {
      const fed = universe.factions.federation;

      // factionId substring matches so the row is returned by the contains filter,
      // but the JSON itself cannot parse.
      await prisma.gameEvent.create({
        data: {
          type: "border_conflict",
          phase: "active",
          startTick: 8,
          phaseStartTick: 8,
          phaseDuration: 10,
          systemId: null,
          metadata: `not-json-but-includes-${fed}`,
        },
      });

      const detail = await getFactionDetail(fed);
      expect(detail.recentEvents).toHaveLength(1);
      expect(detail.recentEvents[0].otherFactionId).toBeNull();
      expect(detail.recentEvents[0].otherFactionName).toBeNull();
    });

    it("returns null partner when metadata references a faction id that no longer exists", async () => {
      const fed = universe.factions.federation;
      const ghostId = "ghost-faction-id-that-isnt-seeded";

      await prisma.gameEvent.create({
        data: {
          type: "alliance_dissolved",
          phase: "complete",
          startTick: 9,
          phaseStartTick: 9,
          phaseDuration: 10,
          systemId: null,
          metadata: JSON.stringify({ factionAId: fed, factionBId: ghostId }),
        },
      });

      const detail = await getFactionDetail(fed);
      expect(detail.recentEvents).toHaveLength(1);
      expect(detail.recentEvents[0].otherFactionId).toBe(ghostId);
      // Partner not in the known-faction map → name nulled out.
      expect(detail.recentEvents[0].otherFactionName).toBeNull();
    });

    it("orders the territory sample with gateways first", async () => {
      // Make one of corporate's systems a gateway so we can verify ordering.
      await prisma.starSystem.update({
        where: { id: universe.systems.tech },
        data: { isGateway: true },
      });

      const detail = await getFactionDetail(universe.factions.corporate);
      expect(detail.territorySample.length).toBeGreaterThanOrEqual(2);
      expect(detail.territorySample[0].isGateway).toBe(true);
    });
  });

  describe("getRelationsMatrix", () => {
    it("returns one row per faction with derived status and the pairs that have relation rows", async () => {
      const matrix = await getRelationsMatrix();

      expect(matrix.factions).toHaveLength(2);
      expect(matrix.pairs).toEqual([]); // no relations seeded yet
    });

    it("includes hasAlliance:true for pairs with an active pact", async () => {
      const [aId, bId] = canonical(
        universe.factions.federation,
        universe.factions.corporate,
      );
      await prisma.factionRelation.create({
        data: { factionAId: aId, factionBId: bId, score: 25 },
      });
      await prisma.alliancePact.create({
        data: {
          factionAId: aId,
          factionBId: bId,
          formedAtTick: 0,
          pendingDissolutionAtTick: null,
        },
      });

      const matrix = await getRelationsMatrix();
      expect(matrix.pairs).toHaveLength(1);
      expect(matrix.pairs[0].score).toBe(25);
      expect(matrix.pairs[0].hasAlliance).toBe(true);
    });
  });
});
