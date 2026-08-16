import { describe, it, expect, afterEach } from "vitest";
import { generateWorld } from "@/lib/world/gen";
import { setWorld, getWorld, clearWorld } from "@/lib/world/store";
import { getAlertData } from "@/lib/services/alerts";
import type { World, WorldSystem, WorldBuildProject } from "@/lib/world/types";
import type { AlertCategory } from "@/lib/types/api";

/** A player-seat world: the player faction owns a developed homeworld. */
function seatWorld(): World {
  return generateWorld({
    systemCount: 60,
    seed: 42,
    playerFaction: { name: "Test Seat", governmentType: "federation", doctrine: "mercantile" },
  });
}

/** Two arbitrary systems that are NOT the player's homeworld — fixture sites the tests force into
 *  a developed, player-owned state (mirrors lib/services/__tests__/tracker.test.ts's own pattern of
 *  patching a spare system rather than depending on world-gen's starting layout). */
function spareSystemIds(world: World, count: number): string[] {
  const pid = world.player!.controlledFactionId;
  const home = world.factions.find((f) => f.id === pid)!.homeworldId;
  const spares = world.systems.filter((s) => s.id !== home).slice(0, count);
  if (spares.length < count) throw new Error("fixture: not enough spare systems");
  return spares.map((s) => s.id);
}

function withSystems(world: World, patches: ReadonlyMap<string, Partial<WorldSystem>>): World {
  return {
    ...world,
    systems: world.systems.map((s) => {
      const patch = patches.get(s.id);
      return patch ? { ...s, ...patch } : s;
    }),
  };
}

/** A developed system owned by the player faction — the baseline every category's condition patch
 *  builds on top of. */
function developedPatch(pid: string, extra: Partial<WorldSystem> = {}): Partial<WorldSystem> {
  return { factionId: pid, control: "developed", ...extra };
}

function category(id: AlertCategory["id"]): AlertCategory {
  const found = getAlertData().categories.find((c) => c.id === id);
  if (!found) throw new Error(`category ${id} missing from getAlertData()`);
  return found;
}

afterEach(() => {
  clearWorld();
});

describe("getAlertData", () => {
  it("returns empty categories rather than throwing on a world with no player seat", () => {
    setWorld(generateWorld({ systemCount: 60, seed: 42 })); // no playerFaction => player is null
    expect(getWorld().player).toBeNull();

    let data: ReturnType<typeof getAlertData> | undefined;
    expect(() => {
      data = getAlertData();
    }).not.toThrow();
    expect(data).toEqual({ categories: [] });
  });

  it("never surfaces a system belonging to another faction, in any category", () => {
    const world = seatWorld();
    const pid = world.player!.controlledFactionId;
    const [target] = spareSystemIds(world, 1);
    // Meets Famine's condition in every respect except ownership.
    setWorld(
      withSystems(
        world,
        new Map([
          [
            target,
            {
              factionId: `not-${pid}`,
              control: "developed",
              supplyBand: "famine",
              provision: 0.1,
              populationChange: -5,
              population: 100,
            },
          ],
        ]),
      ),
    );

    const data = getAlertData();
    for (const c of data.categories) {
      expect(c.instances.map((i) => i.systemId)).not.toContain(target);
    }
  });

  describe("Famine", () => {
    it("excludes a never-assessed system (no supplyBand) while a sibling with supplyBand famine appears", () => {
      const world = seatWorld();
      const pid = world.player!.controlledFactionId;
      const [assessed, neverAssessed] = spareSystemIds(world, 2);
      setWorld(
        withSystems(
          world,
          new Map([
            [
              assessed,
              developedPatch(pid, {
                supplyBand: "famine",
                provision: 0.1,
                populationChange: -5,
                population: 100,
              }),
            ],
            // Never assessed: developed, owned, but the economy has not run on it yet — every
            // absent-not-zero field left untouched.
            [neverAssessed, developedPatch(pid)],
          ]),
        ),
      );

      const famine = category("famine");
      const ids = famine.instances.map((i) => i.systemId);
      expect(ids).toContain(assessed);
      expect(ids).not.toContain(neverAssessed);
    });

    it("sorts a shrinking world's time-to-abandonment ahead of a non-shrinking world's shortfall depth", () => {
      const world = seatWorld();
      const pid = world.player!.controlledFactionId;
      const [shrinking, steady] = spareSystemIds(world, 2);
      setWorld(
        withSystems(
          world,
          new Map([
            [
              shrinking,
              developedPatch(pid, {
                supplyBand: "famine",
                provision: 0.2,
                population: 100,
                populationChange: -5, // k = 0.05/cycle -> ln(100)/0.05
              }),
            ],
            [
              steady,
              developedPatch(pid, {
                supplyBand: "famine",
                provision: 0.1, // shortfall depth 0.9
                population: 100,
                populationChange: 0, // not shrinking: no countdown
              }),
            ],
          ]),
        ),
      );

      const famine = category("famine");
      expect(famine.instances.map((i) => i.systemId)).toEqual([shrinking, steady]);
      const countdown = Math.log(100 / 1) / 0.05;
      expect(famine.instances[0].measure).toBe(`${countdown.toFixed(1)} cycles to abandonment`);
      expect(famine.instances[1].measure).toBe("not shrinking — 90% short");
    });
  });

  describe("Strike", () => {
    it("excludes unrest exactly at the threshold and includes unrest just above it", () => {
      const world = seatWorld();
      const pid = world.player!.controlledFactionId;
      const [atThreshold, aboveThreshold] = spareSystemIds(world, 2);
      setWorld(
        withSystems(
          world,
          new Map([
            [atThreshold, developedPatch(pid, { unrest: 0.65 })],
            [aboveThreshold, developedPatch(pid, { unrest: 0.66 })],
          ]),
        ),
      );

      const strike = category("strike");
      const ids = strike.instances.map((i) => i.systemId);
      expect(ids).not.toContain(atThreshold);
      expect(ids).toContain(aboveThreshold);
    });
  });

  describe("Deprived worlds", () => {
    it("includes a Deprived-banded system, sorted by Provision ascending, and excludes a Supplied one", () => {
      const world = seatWorld();
      const pid = world.player!.controlledFactionId;
      const [deeper, shallower, supplied] = spareSystemIds(world, 3);
      setWorld(
        withSystems(
          world,
          new Map([
            [deeper, developedPatch(pid, { supplyBand: "deprived", provision: 0.2 })],
            [shallower, developedPatch(pid, { supplyBand: "deprived", provision: 0.4 })],
            [supplied, developedPatch(pid, { supplyBand: "supplied", provision: 0.95 })],
          ]),
        ),
      );

      const deprived = category("deprived_worlds");
      expect(deprived.instances.map((i) => i.systemId)).toEqual([deeper, shallower]);
      expect(deprived.instances[0].measure).toBe("20% Provisioned");
    });

    it("excludes a never-assessed system (no supplyBand) while a sibling with supplyBand deprived appears", () => {
      const world = seatWorld();
      const pid = world.player!.controlledFactionId;
      const [assessed, neverAssessed] = spareSystemIds(world, 2);
      setWorld(
        withSystems(
          world,
          new Map([
            [assessed, developedPatch(pid, { supplyBand: "deprived", provision: 0.3 })],
            // Never assessed: developed, owned, but the economy has not run on it yet — every
            // absent-not-zero field left untouched.
            [neverAssessed, developedPatch(pid)],
          ]),
        ),
      );

      const ids = category("deprived_worlds").instances.map((i) => i.systemId);
      expect(ids).toContain(assessed);
      expect(ids).not.toContain(neverAssessed);
    });
  });

  describe("Unrest rising", () => {
    it("excludes a system with no stored provisionExpectation, while an assessed sibling appears", () => {
      const world = seatWorld();
      const pid = world.player!.controlledFactionId;
      const [noMemory, hasMemory] = spareSystemIds(world, 2);
      setWorld(
        withSystems(
          world,
          new Map([
            // Fresh colony: provision assessed, but no stored expectation memory yet.
            [noMemory, developedPatch(pid, { provision: 0.3, unrest: 0.1 })],
            [
              hasMemory,
              developedPatch(pid, { provision: 0.6, provisionExpectation: 0.8, unrest: 0.1 }),
            ],
          ]),
        ),
      );

      const unrestRising = category("unrest_rising");
      const ids = unrestRising.instances.map((i) => i.systemId);
      expect(ids).not.toContain(noMemory);
      expect(ids).toContain(hasMemory);
      expect(unrestRising.instances[0].measure).toBe("60% Provisioned, expects 80%");
    });

    it("excludes a system already past the strike threshold", () => {
      const world = seatWorld();
      const pid = world.player!.controlledFactionId;
      const [striking] = spareSystemIds(world, 1);
      setWorld(
        withSystems(
          world,
          new Map([
            [
              striking,
              developedPatch(pid, { provision: 0.6, provisionExpectation: 0.8, unrest: 0.7 }),
            ],
          ]),
        ),
      );

      expect(category("unrest_rising").instances.map((i) => i.systemId)).not.toContain(striking);
    });
  });

  describe("Overcrowded", () => {
    it("is false at population === popCap and true one pop above it", () => {
      const world = seatWorld();
      const pid = world.player!.controlledFactionId;
      const [atCap, overCap] = spareSystemIds(world, 2);
      setWorld(
        withSystems(
          world,
          new Map([
            [atCap, developedPatch(pid, { population: 100, popCap: 100 })],
            [overCap, developedPatch(pid, { population: 101, popCap: 100 })],
          ]),
        ),
      );

      const overcrowded = category("overcrowded");
      const ids = overcrowded.instances.map((i) => i.systemId);
      expect(ids).not.toContain(atCap);
      expect(ids).toContain(overCap);
    });

    it("reads popCap === 0 with population above 0 as not overcrowded", () => {
      const world = seatWorld();
      const pid = world.player!.controlledFactionId;
      const [zeroCap] = spareSystemIds(world, 1);
      setWorld(
        withSystems(world, new Map([[zeroCap, developedPatch(pid, { population: 5, popCap: 0 })]])),
      );

      expect(category("overcrowded").instances.map((i) => i.systemId)).not.toContain(zeroCap);
    });
  });

  describe("No housing headroom", () => {
    it("evaluates headroom against queue-adjusted buildings: a queued FACTORY (not housing) build changes the read", () => {
      // A queued HOUSING level would itself exclude this system via the separate "no housing
      // standing in the queue" conjunct — see the test below — so this fixture queues a
      // non-housing build (metals, tier 1) to isolate the queue-adjustment on conjunct 3 alone:
      // a committed factory eats general space that would otherwise still read as room for housing.
      const world = seatWorld();
      const pid = world.player!.controlledFactionId;
      const [target] = spareSystemIds(world, 1);
      const withTarget = withSystems(
        world,
        new Map([
          [
            target,
            developedPatch(pid, {
              population: 61,
              popCap: 60,
              generalSpace: 10,
              habitableSpace: 5,
            }),
          ],
        ]),
      );

      const queuedFactory: WorldBuildProject = {
        kind: "build",
        id: "test-metals-project",
        factionId: pid,
        systemId: target,
        origin: "auto",
        workTotal: 100,
        workDone: 10,
        buildingType: "metals",
        levels: 7,
      };
      const withFixture: World = {
        ...withTarget,
        buildings: [
          ...withTarget.buildings.filter((b) => b.systemId !== target),
          { systemId: target, buildingType: "housing", count: 3, idleCycles: 0 },
        ],
        constructionProjects: [
          ...withTarget.constructionProjects.filter((p) => p.systemId !== target),
          queuedFactory,
        ],
      };
      setWorld(withFixture);

      // 3 landed housing levels leave headroom = min(5 - 3, 10 - 3) = 2 (>= 1) on RAW buildings —
      // this system would NOT read "no housing headroom" if the queued metals levels were ignored.
      // Once they fold in, remaining general space = 10 - 3 - 7 = 0, so headroom = min(2, 0) = 0
      // (< 1, no room for a whole level), and the system is still Overcrowded (61 > 60) on the
      // persisted, non-queue-adjusted popCap. The fixture is deliberately sized so raw and
      // queue-adjusted disagree.
      const noHousing = category("no_housing_headroom");
      expect(noHousing.instances.map((i) => i.systemId)).toContain(target);
    });

    it("excludes a system that is otherwise headroom-exhausted once a housing level is standing in its queue", () => {
      const world = seatWorld();
      const pid = world.player!.controlledFactionId;
      const [target] = spareSystemIds(world, 1);
      const withTarget = withSystems(
        world,
        new Map([
          [
            target,
            developedPatch(pid, {
              population: 61,
              popCap: 60,
              generalSpace: 100,
              habitableSpace: 5,
            }),
          ],
        ]),
      );

      const queuedHousing: WorldBuildProject = {
        kind: "build",
        id: "test-housing-project",
        factionId: pid,
        systemId: target,
        origin: "auto",
        workTotal: 100,
        workDone: 10,
        buildingType: "housing",
        levels: 2,
      };
      const withFixture: World = {
        ...withTarget,
        buildings: [
          ...withTarget.buildings.filter((b) => b.systemId !== target),
          // 5 landed housing levels already exhaust headroom on RAW buildings alone:
          // min(5 - 5, 100 - 5) = 0 — conjuncts 1 and 3 are satisfied without any queue fold.
          { systemId: target, buildingType: "housing", count: 5, idleCycles: 0 },
        ],
        constructionProjects: [
          ...withTarget.constructionProjects.filter((p) => p.systemId !== target),
          queuedHousing,
        ],
      };
      setWorld(withFixture);

      // Still Overcrowded — the queued housing conjunct is specific to No housing headroom.
      expect(category("overcrowded").instances.map((i) => i.systemId)).toContain(target);
      // But excluded from No housing headroom: a housing level is already standing in the queue,
      // so this system is building its way out.
      expect(category("no_housing_headroom").instances.map((i) => i.systemId)).not.toContain(target);
    });

    it("still requires Overcrowded — a system with headroom < 1 but population <= popCap never appears", () => {
      const world = seatWorld();
      const pid = world.player!.controlledFactionId;
      const [target] = spareSystemIds(world, 1);
      const withTarget = withSystems(
        world,
        new Map([
          [
            target,
            developedPatch(pid, {
              population: 50,
              popCap: 100, // NOT overcrowded
              generalSpace: 100,
              habitableSpace: 5,
            }),
          ],
        ]),
      );
      const withFixture: World = {
        ...withTarget,
        buildings: [
          ...withTarget.buildings.filter((b) => b.systemId !== target),
          { systemId: target, buildingType: "housing", count: 5, idleCycles: 0 }, // headroom 0
        ],
      };
      setWorld(withFixture);

      expect(category("overcrowded").instances.map((i) => i.systemId)).not.toContain(target);
      expect(category("no_housing_headroom").instances.map((i) => i.systemId)).not.toContain(target);
    });
  });
});
