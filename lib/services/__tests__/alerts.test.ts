import { describe, it, expect, afterEach } from "vitest";
import { generateWorld } from "@/lib/world/gen";
import { setWorld, getWorld, clearWorld } from "@/lib/world/store";
import { getAlertData } from "@/lib/services/alerts";
import type {
  World, WorldSystem, WorldBuildProject, WorldMarket, WorldEvent,
  WorldFactionTreasury, WorldTreasurySettlement,
} from "@/lib/world/types";
import type { AlertCategory } from "@/lib/types/api";
import { planFactionProposals, type BuildSystemState, type BuildGoodState } from "@/lib/engine/directed-build";
import { emptyResourceVector, RESOURCE_TYPES } from "@/lib/engine/resources";
import type { DevelopmentRefs } from "@/lib/engine/development";
import { SURVIVAL_GOODS } from "@/lib/constants/physical-economy";

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

/** Adds/replaces market rows keyed by (systemId, goodId) — spare systems carry no market rows at
 *  world-gen (markets are seeded only for systems ALREADY developed at generation time, lib/world/gen.ts:184-193),
 *  so a fixture that patches a spare system to `developed` after the fact must add its own rows. */
function withMarketRows(world: World, rows: WorldMarket[]): World {
  const keep = world.markets.filter(
    (m) => !rows.some((r) => r.systemId === m.systemId && r.goodId === m.goodId),
  );
  return { ...world, markets: [...keep, ...rows] };
}

function marketRow(systemId: string, goodId: string, overrides: Partial<WorldMarket> = {}): WorldMarket {
  return { systemId, goodId, stock: 100, anchorMult: 1, demandRate: 10, storageCapacity: 1000, ...overrides };
}

function withEvents(world: World, events: WorldEvent[]): World {
  return { ...world, events };
}

function fixtureEvent(overrides: Partial<WorldEvent> = {}): WorldEvent {
  return {
    id: "ev-1", type: "plague", phase: "outbreak", systemId: null, regionId: null,
    startTick: 0, phaseStartTick: 0, phaseDuration: 50, severity: 1, sourceEventId: null,
    metadata: null,
    ...overrides,
  };
}

function withTreasury(world: World, factionId: string, patch: Partial<WorldFactionTreasury>): World {
  return {
    ...world,
    treasuries: world.treasuries.map((t) => (t.factionId === factionId ? { ...t, ...patch } : t)),
  };
}

function settlement(overrides: Partial<WorldTreasurySettlement> = {}): WorldTreasurySettlement {
  return {
    tick: 100, headsIncome: 0, productionIncome: 0, incomeBySystem: [],
    maintenanceBill: 0, maintenanceByType: [], logisticsBill: 0, constructionBill: 0,
    paid: { maintenance: 0, logistics: 0, construction: 0 },
    foundingExpense: 0,
    ...overrides,
  };
}

function withAutomation(world: World, patch: Partial<{ build: boolean; colonisation: boolean }>): World {
  if (!world.player) throw new Error("fixture: no player");
  return { ...world, player: { ...world.player, automation: { ...world.player.automation, ...patch } } };
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

  describe("Survival stock falling", () => {
    it("excludes a system whose stock is rising, and one whose cycles-to-empty is above the threshold", () => {
      const world = seatWorld();
      const pid = world.player!.controlledFactionId;
      const [rising, farFromEmpty, falling] = spareSystemIds(world, 3);
      const withTargets = withSystems(
        world,
        new Map([
          [rising, developedPatch(pid)],
          [farFromEmpty, developedPatch(pid)],
          [falling, developedPatch(pid)],
        ]),
      );
      const withFixture = withMarketRows(withTargets, [
        // Rising stock: stockChange positive — never a cycles-to-empty reading at all.
        marketRow(rising, "food", { stock: 10, stockChange: 5 }),
        // Falling, but cycles-to-empty (100 / 1 = 100) sits far above the threshold.
        marketRow(farFromEmpty, "food", { stock: 100, stockChange: -1 }),
        // Falling, cycles-to-empty = 6 / 3 = 2, below the threshold — the only one that qualifies.
        marketRow(falling, "food", { stock: 6, stockChange: -3 }),
      ]);
      setWorld(withFixture);

      const ids = category("survival_stock_falling").instances.map((i) => i.systemId);
      expect(ids).not.toContain(rising);
      expect(ids).not.toContain(farFromEmpty);
      expect(ids).toContain(falling);
    });

    it("counts a system short in both survival goods once, at its worse (lower) reading", () => {
      const world = seatWorld();
      const pid = world.player!.controlledFactionId;
      const [target] = spareSystemIds(world, 1);
      const withTarget = withSystems(world, new Map([[target, developedPatch(pid)]]));
      const withFixture = withMarketRows(withTarget, [
        marketRow(target, "water", { stock: 6, stockChange: -3 }), // cycles-to-empty 2
        marketRow(target, "food", { stock: 4, stockChange: -4 }), // cycles-to-empty 1 — worse
      ]);
      setWorld(withFixture);

      const stockFalling = category("survival_stock_falling");
      expect(stockFalling.instances.filter((i) => i.systemId === target)).toHaveLength(1);
      expect(stockFalling.instances[0].measure).toBe("food empties in 1.0 cycles");
    });
  });

  describe("Demand unservable", () => {
    it("counts a system unservable in three goods once, at its largest shortfall — not three times and not the sum", () => {
      const world = seatWorld();
      const pid = world.player!.controlledFactionId;
      const [target, servable] = spareSystemIds(world, 2);
      const withTargets = withSystems(
        world,
        new Map([
          [target, developedPatch(pid)],
          [servable, developedPatch(pid)],
        ]),
      );
      const withFixture = withMarketRows(withTargets, [
        marketRow(target, "food", { demandUnservable: true, unservedShortfall: 5 }),
        marketRow(target, "ore", { demandUnservable: true, unservedShortfall: 20 }),
        marketRow(target, "metals", { demandUnservable: true, unservedShortfall: 8 }),
        // A row with no demandUnservable flag never contributes — a merely funding-bound deficit
        // (logisticsFundingBound) is a different, temporary condition.
        marketRow(servable, "food", { logisticsFundingBound: true }),
      ]);
      setWorld(withFixture);

      const unservable = category("demand_unservable");
      expect(unservable.instances.filter((i) => i.systemId === target)).toHaveLength(1);
      expect(unservable.instances.map((i) => i.systemId)).not.toContain(servable);
      // Sorts by the worst (largest) unservedShortfall — ore's 20 dominates food's 5, metals' 8, and
      // the sum (33) they would produce if this wrongly accumulated instead of taking the max.
      expect(unservable.instances[0].measure).toBe("ore unserved by 20.0");
    });

    it("excludes a row carrying the bit with no persisted shortfall — absence-not-zero, never demandRate", () => {
      const world = seatWorld();
      const pid = world.player!.controlledFactionId;
      const [target] = spareSystemIds(world, 1);
      const withTarget = withSystems(world, new Map([[target, developedPatch(pid)]]));
      const withFixture = withMarketRows(withTarget, [
        // demandUnservable true, but unservedShortfall was never written (a corrupt/legacy row) —
        // this must not fall back to demandRate, the proxy this rework removes.
        marketRow(target, "food", { demandUnservable: true, demandRate: 999 }),
      ]);
      setWorld(withFixture);

      expect(category("demand_unservable").instances.map((i) => i.systemId)).not.toContain(target);
    });
  });

  describe("Build blocked", () => {
    it("sorts by authored reason severity, not by droppedRoi — a worse reason with a lower ROI still sorts first", () => {
      const world = seatWorld();
      const pid = world.player!.controlledFactionId;
      const [saturated, nearMiss] = spareSystemIds(world, 2);
      const withFixture = withSystems(
        world,
        new Map([
          // no-capacity is the worst reason (severity 1), even though its dropped ROI is 0.
          [saturated, developedPatch(pid, { buildBlocked: { reason: "no-capacity", droppedRoi: 0 } })],
          // no-whole-level is the least severe reason (severity 5), despite a large dropped ROI.
          [nearMiss, developedPatch(pid, { buildBlocked: { reason: "no-whole-level", droppedRoi: 1000 } })],
        ]),
      );
      setWorld(withFixture);

      const blocked = category("build_blocked");
      expect(blocked.instances.map((i) => i.systemId)).toEqual([saturated, nearMiss]);
    });
  });

  describe("Industry idle", () => {
    it("reads a fully unstaffed producer as idle capacity", () => {
      const world = seatWorld();
      const pid = world.player!.controlledFactionId;
      const [target] = spareSystemIds(world, 1);
      const withTarget = withSystems(world, new Map([[target, developedPatch(pid, { population: 0 })]]));
      const withFixture: World = {
        ...withTarget,
        buildings: [
          ...withTarget.buildings.filter((b) => b.systemId !== target),
          // "ore" is a tier-0 extractor: no recipe, but it still draws unskilled labour — with
          // population 0 nobody staffs it, so every level reads idle.
          { systemId: target, buildingType: "ore", count: 5, idleCycles: 0 },
        ],
      };
      setWorld(withFixture);

      const idle = category("industry_idle");
      expect(idle.instances.map((i) => i.systemId)).toContain(target);
      expect(idle.instances.find((i) => i.systemId === target)?.measure).toBe("100% idle capacity");
    });
  });

  describe("Maintenance unfunded", () => {
    it("does not appear before a fresh world's first settlement", () => {
      const world = seatWorld();
      setWorld(world); // lastSettlement is null on a fresh world (lib/world/gen.ts)

      expect(category("maintenance_unfunded").instances).toHaveLength(0);
    });

    it("does not fire when the maintenance slider is below 1.0 with a solvent treasury", () => {
      const world = seatWorld();
      const pid = world.player!.controlledFactionId;
      const withFixture = withTreasury(world, pid, {
        bands: { maintenance: 0.5, logistics: 1, construction: 1 },
        lastSettlement: settlement({
          maintenanceBill: 100,
          paid: { maintenance: 50, logistics: 0, construction: 0 }, // exactly bill × slider — solvent
        }),
      });
      setWorld(withFixture);

      expect(category("maintenance_unfunded").instances).toHaveLength(0);
    });

    it("fires when the settlement could not pay the band it was asked to pay", () => {
      const world = seatWorld();
      const pid = world.player!.controlledFactionId;
      const withFixture = withTreasury(world, pid, {
        bands: { maintenance: 1, logistics: 1, construction: 1 },
        lastSettlement: settlement({
          maintenanceBill: 100,
          paid: { maintenance: 50, logistics: 0, construction: 0 }, // 50 < 100 × 1 — insolvent
        }),
      });
      setWorld(withFixture);

      const unfunded = category("maintenance_unfunded");
      expect(unfunded.instances).toHaveLength(1);
      expect(unfunded.instances[0].systemId).toBeNull();
    });
  });

  describe("Events — Crisis / Disruption / Windfall", () => {
    it("raises no chip for an event in a rival faction's system", () => {
      const world = seatWorld();
      const [rivalSystem] = spareSystemIds(world, 1); // NOT patched to the player's faction
      const withFixture = withEvents(world, [
        fixtureEvent({ id: "ev-rival", type: "plague", systemId: rivalSystem }),
      ]);
      setWorld(withFixture);

      expect(category("crisis").instances.map((i) => i.systemId)).not.toContain(rivalSystem);
    });

    it("raises a chip for an event in the player's own developed system", () => {
      const world = seatWorld();
      const pid = world.player!.controlledFactionId;
      const [target] = spareSystemIds(world, 1);
      const withTarget = withSystems(world, new Map([[target, developedPatch(pid)]]));
      const withFixture = withEvents(withTarget, [
        fixtureEvent({ id: "ev-own", type: "plague", systemId: target }),
      ]);
      setWorld(withFixture);

      expect(category("crisis").instances.map((i) => i.systemId)).toContain(target);
    });

    it("raises a chip for a relations-owned pair event involving the player's faction, with systemId null", () => {
      const world = seatWorld();
      const pid = world.player!.controlledFactionId;
      const otherFaction = world.factions.find((f) => f.id !== pid)!.id;
      const withFixture = withEvents(world, [
        fixtureEvent({
          id: "ev-alliance",
          type: "alliance_dissolved", // disruption band
          systemId: null,
          regionId: null,
          metadata: { factionAId: pid, factionBId: otherFaction, expiresAtTick: 9999 },
        }),
      ]);
      setWorld(withFixture);

      const disruption = category("disruption");
      expect(disruption.instances).toHaveLength(1);
      expect(disruption.instances[0].systemId).toBeNull();
    });

    it("raises no chip for a relations-owned pair event between two rival factions", () => {
      const world = seatWorld();
      const pid = world.player!.controlledFactionId;
      const rivals = world.factions.filter((f) => f.id !== pid);
      if (rivals.length < 2) throw new Error("fixture: need two non-player factions");
      const withFixture = withEvents(world, [
        fixtureEvent({
          id: "ev-rival-pair",
          type: "alliance_dissolved",
          systemId: null,
          regionId: null,
          metadata: { factionAId: rivals[0].id, factionBId: rivals[1].id, expiresAtTick: 9999 },
        }),
      ]);
      setWorld(withFixture);

      expect(category("disruption").instances).toHaveLength(0);
    });

    it("counts events as instances, not systems — two systemId:null events both count", () => {
      const world = seatWorld();
      const pid = world.player!.controlledFactionId;
      const otherFaction = world.factions.find((f) => f.id !== pid)!.id;
      const withFixture = withEvents(world, [
        fixtureEvent({
          id: "ev-1", type: "pact_under_negotiation", systemId: null, regionId: null,
          metadata: { factionAId: pid, factionBId: otherFaction, expiresAtTick: 9999 },
        }),
        fixtureEvent({
          id: "ev-2", type: "pact_under_negotiation", systemId: null, regionId: null,
          metadata: { factionAId: pid, factionBId: otherFaction, expiresAtTick: 9998 },
        }),
      ]);
      setWorld(withFixture);

      expect(category("windfall").count).toBe(2);
      expect(category("windfall").instances.every((i) => i.systemId === null)).toBe(true);
    });
  });

  describe("Build opportunity / Colony opportunity — automation self-gate", () => {
    it("Build opportunity returns nothing while build automation is ON, even with a stored buildOpportunity", () => {
      const world = seatWorld();
      const pid = world.player!.controlledFactionId;
      const [target] = spareSystemIds(world, 1);
      const withTarget = withSystems(
        world,
        new Map([[target, developedPatch(pid, { buildOpportunity: { score: 5, goodId: "food" } })]]),
      );
      setWorld(withAutomation(withTarget, { build: true }));

      expect(category("build_opportunity").instances).toHaveLength(0);
    });

    it("Build opportunity returns a system carrying a stored buildOpportunity once build automation is OFF", () => {
      const world = seatWorld();
      const pid = world.player!.controlledFactionId;
      const [target] = spareSystemIds(world, 1);
      const withTarget = withSystems(
        world,
        new Map([[target, developedPatch(pid, { buildOpportunity: { score: 5, goodId: "food" } })]]),
      );
      setWorld(withAutomation(withTarget, { build: false }));

      expect(category("build_opportunity").instances.map((i) => i.systemId)).toContain(target);
    });

    it("excludes a developed system with no stored buildOpportunity — absence-not-zero", () => {
      const world = seatWorld();
      const pid = world.player!.controlledFactionId;
      const [target] = spareSystemIds(world, 1);
      const withTarget = withSystems(world, new Map([[target, developedPatch(pid)]]));
      setWorld(withAutomation(withTarget, { build: false }));

      expect(category("build_opportunity").instances.map((i) => i.systemId)).not.toContain(target);
    });

    it("Colony opportunity returns nothing while colonisation automation is ON, even with a stored colonyOpportunity", () => {
      const world = seatWorld();
      const pid = world.player!.controlledFactionId;
      const [target] = spareSystemIds(world, 1);
      const withTarget = withSystems(
        world,
        new Map([[target, { factionId: pid, colonyOpportunity: { value: 100, work: 10 } }]]),
      );
      setWorld(withAutomation(withTarget, { colonisation: true }));

      expect(category("colony_opportunity").instances).toHaveLength(0);
    });

    it("Colony opportunity returns the system carrying a stored colonyOpportunity once colonisation automation is OFF", () => {
      const world = seatWorld();
      const pid = world.player!.controlledFactionId;
      const [target] = spareSystemIds(world, 1);
      const withTarget = withSystems(
        world,
        new Map([[target, { factionId: pid, colonyOpportunity: { value: 100, work: 10 } }]]),
      );
      setWorld(withAutomation(withTarget, { colonisation: false }));

      expect(category("colony_opportunity").instances.map((i) => i.systemId)).toContain(target);
    });

    it("excludes a player-owned system with no stored colonyOpportunity — absence-not-zero", () => {
      const world = seatWorld();
      const pid = world.player!.controlledFactionId;
      const [target] = spareSystemIds(world, 1);
      const withTarget = withSystems(world, new Map([[target, { factionId: pid, control: "controlled" }]]));
      setWorld(withAutomation(withTarget, { colonisation: false }));

      expect(category("colony_opportunity").instances.map((i) => i.systemId)).not.toContain(target);
    });
  });

  describe("Build opportunity — banding and within-band sort", () => {
    it("sorts a higher score first within one band", () => {
      const world = seatWorld();
      const pid = world.player!.controlledFactionId;
      const [lower, higher] = spareSystemIds(world, 2);
      const withFixture = withSystems(
        world,
        new Map([
          [lower, developedPatch(pid, { buildOpportunity: { score: 2, goodId: "ore" } })],
          [higher, developedPatch(pid, { buildOpportunity: { score: 50, goodId: "metals" } })],
        ]),
      );
      setWorld(withAutomation(withFixture, { build: false }));

      const buildOpp = category("build_opportunity");
      expect(buildOpp.instances.map((i) => i.systemId)).toEqual([higher, lower]);
    });

    it("sorts a low-scoring survival-serving opportunity above a high-scoring non-survival one — band wins whatever the scores", () => {
      const world = seatWorld();
      const pid = world.player!.controlledFactionId;
      const [survival, nonSurvival] = spareSystemIds(world, 2);
      const withFixture = withSystems(
        world,
        new Map([
          [survival, developedPatch(pid, { buildOpportunity: { score: 1, goodId: SURVIVAL_GOODS[0] } })],
          [nonSurvival, developedPatch(pid, { buildOpportunity: { score: 10_000, goodId: "ore" } })],
        ]),
      );
      setWorld(withAutomation(withFixture, { build: false }));

      const buildOpp = category("build_opportunity");
      expect(buildOpp.instances.map((i) => i.systemId)).toEqual([survival, nonSurvival]);
    });
  });

  describe("Build opportunity — banding coupled to the engine's own choice", () => {
    it("bands the engine's own survival-serving pick above a band-2 system, regardless of score", () => {
      // planFactionProposals's own recordScoredOpportunity (lib/engine/directed-build.ts:778-788)
      // makes ITS OWN SURVIVAL_GOODS.includes(goodId) check to decide what to persist when a system
      // can serve both a survival and a non-survival deficit — the exact shape
      // lib/engine/__tests__/directed-build.test.ts's own "Proves 2" case uses. This test calls the
      // REAL planner, not a hand-authored fixture, so it breaks the moment the engine's own choice and
      // this file's band predicate (buildOpportunitySortKey) diverge — nothing else pins the two
      // independent SURVIVAL_GOODS reads together.
      const slotCap = emptyResourceVector();
      for (const k of RESOURCE_TYPES) slotCap[k] = 20;
      const devRefs: DevelopmentRefs = { popRef: 150, industryRef: 12 };
      const builder = (): BuildSystemState => ({
        systemId: "B", factionId: "f1", population: 100_000, control: "developed", buildings: {},
        slotCap, generalSpace: 50, habitableSpace: 0, goods: [],
      });
      const survivalGood = SURVIVAL_GOODS[0];
      const survivalOnlyGoods: BuildGoodState[] = [
        { goodId: survivalGood, stock: 1, demand: 5, capacityProduction: 0, proposalCycles: 1 },
      ];
      const oreOnlyGoods: BuildGoodState[] = [
        { goodId: "ore", stock: 1, demand: 5000, capacityProduction: 0, proposalCycles: 1 },
      ];
      const sinkWith = (goods: BuildGoodState[]): BuildSystemState => ({
        systemId: "A", factionId: "f1", population: 100, control: "developed", buildings: {},
        slotCap: emptyResourceVector(), generalSpace: 0, habitableSpace: 0, goods,
      });

      // Sanity, measured not assumed: ore's own opportunity genuinely outscores the survival good's
      // alone, so the combined case below cannot pass vacuously.
      const survivalOnly = planFactionProposals([sinkWith(survivalOnlyGoods), builder()], () => 1, [], devRefs);
      const oreOnly = planFactionProposals([sinkWith(oreOnlyGoods), builder()], () => 1, [], devRefs);
      const survivalScore = survivalOnly.buildOpportunities.find((o) => o.systemId === "B")?.score ?? 0;
      const oreScore = oreOnly.buildOpportunities.find((o) => o.systemId === "B")?.score ?? 0;
      expect(oreScore).toBeGreaterThan(survivalScore);

      // Combined: B can score both this run — the engine's own band must still pick the survival good.
      const combined = planFactionProposals(
        [sinkWith([...survivalOnlyGoods, ...oreOnlyGoods]), builder()],
        () => 1, [], devRefs,
      );
      const opp = combined.buildOpportunities.find((o) => o.systemId === "B");
      if (!opp) throw new Error("fixture: engine produced no buildOpportunity for system B");
      expect(opp.goodId).toBe(survivalGood); // ground truth: this is what the engine actually persists

      // Feed the engine's REAL choice into the read service, beside a hand-authored band-2 system
      // scored a thousand times higher, and confirm the service still bands the engine's pick first.
      const world = seatWorld();
      const pid = world.player!.controlledFactionId;
      const [survivalSystem, richerNonSurvival] = spareSystemIds(world, 2);
      const withFixture = withSystems(
        world,
        new Map([
          [survivalSystem, developedPatch(pid, { buildOpportunity: { score: opp.score, goodId: opp.goodId } })],
          [richerNonSurvival, developedPatch(pid, { buildOpportunity: { score: opp.score * 1000, goodId: "ore" } })],
        ]),
      );
      setWorld(withAutomation(withFixture, { build: false }));

      const buildOpp = category("build_opportunity");
      expect(buildOpp.instances.map((i) => i.systemId)).toEqual([survivalSystem, richerNonSurvival]);
    });
  });

  describe("Colony opportunity — sorts by the planner's own value / work", () => {
    it("sorts the higher ROI (value / work) first", () => {
      const world = seatWorld();
      const pid = world.player!.controlledFactionId;
      const [lowRoi, highRoi] = spareSystemIds(world, 2);
      const withFixture = withSystems(
        world,
        new Map([
          // ROI 2
          [lowRoi, { factionId: pid, colonyOpportunity: { value: 20, work: 10 } }],
          // ROI 5
          [highRoi, { factionId: pid, colonyOpportunity: { value: 50, work: 10 } }],
        ]),
      );
      setWorld(withAutomation(withFixture, { colonisation: false }));

      const colonyOpp = category("colony_opportunity");
      expect(colonyOpp.instances.map((i) => i.systemId)).toEqual([highRoi, lowRoi]);
    });
  });

  describe("Category order", () => {
    it("emits all sixteen categories, in registry tier + order", () => {
      const world = seatWorld();
      setWorld(world);

      const ids = getAlertData().categories.map((c) => c.id);
      expect(ids).toEqual([
        "famine", "strike", "maintenance_unfunded", "crisis",
        "deprived_worlds", "unrest_rising", "survival_stock_falling", "demand_unservable",
        "overcrowded", "no_housing_headroom", "build_blocked", "industry_idle", "disruption",
        "build_opportunity", "colony_opportunity", "windfall",
      ]);
    });
  });
});
