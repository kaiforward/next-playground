import { describe, it, expect, afterEach } from "vitest";
import { generateWorld } from "@/lib/world/gen";
import { DEFAULT_ALERT_CATEGORIES } from "@/lib/constants/attention";
import { setWorld, getWorld, clearWorld } from "@/lib/world/store";
import { getAlertData } from "@/lib/services/alerts";
import { seatWorld } from "./seat-world";
import { getSystemIndustry } from "@/lib/services/universe";
import { labourDemand } from "@/lib/engine/industry";
import { strikeMultiplier } from "@/lib/engine/population";
import { STRIKE_PARAMS } from "@/lib/constants/population";
import { HOUSING_TYPE } from "@/lib/constants/industry";
import type {
  World, WorldSystem, WorldBuildProject, WorldMarket, WorldLane,
  WorldFactionTreasury, WorldTreasurySettlement,
} from "@/lib/world/types";
import { laneKey } from "@/lib/engine/lanes";
import type {
  AlertCategory, SystemScopedAlertCategory, ControlledSystemsAlertCategory, FactionAlertCategory,
  LaneScopedAlertCategory,
} from "@/lib/types/api";
import { planFactionProposals, type BuildSystemState, type BuildGoodState } from "@/lib/engine/directed-build";
import { emptyResourceVector, RESOURCE_TYPES } from "@/lib/engine/resources";
import type { DevelopmentRefs } from "@/lib/engine/development";
import { SURVIVAL_GOODS } from "@/lib/constants/physical-economy";

/** Two arbitrary systems that are NOT ANY faction's homeworld — fixture sites the tests force into
 *  a developed, player-owned state (mirrors lib/services/__tests__/tracker.test.ts's own pattern of
 *  patching a spare system rather than depending on world-gen's starting layout). Excludes every
 *  faction's homeworld, not just the player's: a homeworld already carries the stamped capital
 *  prefab (population, buildings, seeded markets — `stampHomeworldPrefabs`), so picking one by
 *  array-order accident silently hands a fixture a system that isn't actually spare. */
function spareSystemIds(world: World, count: number): string[] {
  const homeworldIds = new Set(world.factions.map((f) => f.homeworldId));
  const spares = world.systems.filter((s) => !homeworldIds.has(s.id)).slice(0, count);
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

/** A colony CANDIDATE owned by the player faction — claimed, not yet developed, which is exactly the
 *  control state the colonisation planner draws its candidates from (lib/world/tick.ts's
 *  `developProvider`) and therefore the only state a stored `colonyOpportunity` can sit on. */
function candidatePatch(pid: string, extra: Partial<WorldSystem> = {}): Partial<WorldSystem> {
  return { factionId: pid, control: "controlled", ...extra };
}

// Overloaded so every existing call site — which never touches Lane congested — keeps narrowing to
// the pre-existing `AlertInstance`-carrying variants without a single one of them having to assert
// or check `unit` itself; only a `category("lane_congested")` call narrows to `LaneScopedAlertCategory`,
// whose instances are `LaneAlertInstance[]`, not `AlertInstance[]` (see that type's own docstring for
// why a lane can't share the system-scoped shape).
function category(
  id: Exclude<AlertCategory["id"], "lane_congested">,
): SystemScopedAlertCategory | ControlledSystemsAlertCategory | FactionAlertCategory;
function category(id: "lane_congested"): LaneScopedAlertCategory;
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

/** A `WorldLane` fixture row — the alerts service reads `world.lanes` directly, with no dependency
 *  on `world.connections` actually carrying the pair, so a synthetic lane between two arbitrary
 *  system ids is a legitimate fixture regardless of whether the seeded galaxy really connects them.
 *  Sorts its own endpoints, matching the real invariant (`aId < bId`, `lib/world/types.ts`). */
function lane(x: string, y: string, overrides: Partial<WorldLane> = {}): WorldLane {
  const [aId, bId] = x < y ? [x, y] : [y, x];
  return { key: laneKey(aId, bId), aId, bId, level: 1, bookedLoad: 0, blockedVolume: 0, idleCycles: 0, ...overrides };
}

/** Replaces `world.lanes` with the given rows — every Lane congested fixture starts from an empty
 *  lane set rather than the seeded galaxy's own (irrelevant, and would pollute `denominator`). */
function withLanes(world: World, lanes: WorldLane[]): World {
  return { ...world, lanes };
}

function marketRow(systemId: string, goodId: string, overrides: Partial<WorldMarket> = {}): WorldMarket {
  return { systemId, goodId, stock: 100, anchorMult: 1, demandRate: 10, storageCapacity: 1000, ...overrides };
}

/** Replaces the building roster at the named systems, leaving every other system's untouched. */
function withBuildings(
  world: World, systemIds: string[], rows: Array<{ systemId: string; buildingType: string; count: number }>,
): World {
  const replaced = new Set(systemIds);
  return {
    ...world,
    buildings: [
      ...world.buildings.filter((b) => !replaced.has(b.systemId)),
      ...rows.map((r) => ({ ...r, idleCycles: 0 })),
    ],
    // A spare system carries no construction projects at world-gen, but clearing them keeps the
    // headroom fixtures below independent of anything world-gen may queue there later.
    constructionProjects: world.constructionProjects.filter(
      (p) => p.kind === "lane_upgrade" || !replaced.has(p.systemId),
    ),
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
  // A default-shaped world reads the same settings whether this returns the stored record or the
  // authored default, so the only test that can tell them apart is one that stores something else
  // first. `categorySettings` is what decides which chips the run draws at all.
  it("returns the seat's OWN stored category settings, not the authored defaults", () => {
    const world = seatWorld();
    setWorld({
      ...world,
      player: {
        ...world.player!,
        alertCategories: { ...world.player!.alertCategories, unrest_rising: true, overcrowded: false },
      },
    });

    const settings = getAlertData().categorySettings;
    expect(settings.unrest_rising).toBe(true);
    expect(settings.overcrowded).toBe(false);
  });

  it("returns empty categories rather than throwing on a world with no player seat", () => {
    setWorld(generateWorld({ systemCount: 60, seed: 42 })); // no playerFaction => player is null
    expect(getWorld().player).toBeNull();

    let data: ReturnType<typeof getAlertData> | undefined;
    expect(() => {
      data = getAlertData();
    }).not.toThrow();
    // No seat means no stored preference to read, so the settings fall back to the authored
    // defaults rather than being absent — every reader of `categorySettings` can index it
    // unconditionally.
    expect(data).toEqual({ categories: [], categorySettings: DEFAULT_ALERT_CATEGORIES });
  });

  it("never surfaces a system belonging to another faction, in any category", () => {
    const world = seatWorld();
    const pid = world.player!.controlledFactionId;
    const [target] = spareSystemIds(world, 1);
    // Meets Population collapse's condition in every respect except ownership.
    setWorld(
      withSystems(
        world,
        new Map([
          [
            target,
            {
              factionId: `not-${pid}`,
              control: "developed",
              populationTrend: -0.05,
              populationChange: -5,
              population: 100,
            },
          ],
        ]),
      ),
    );

    const data = getAlertData();
    for (const c of data.categories) {
      // Lane congested's own instances carry a `laneKey`, not a `systemId` (see `LaneAlertInstance`'s
      // own docstring) — harmless here as long as they don't spuriously equal `target`.
      expect(c.instances.map((i) => ("systemId" in i ? i.systemId : null))).not.toContain(target);
    }
  });

  describe("Population collapse", () => {
    it("excludes a never-assessed system (no populationTrend) while a sibling above threshold appears", () => {
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
                populationTrend: -0.05, // well past POPULATION_COLLAPSE_TREND_THRESHOLD (≈0.0078) in magnitude, negative = shrinking
                populationChange: -5,
                population: 100,
              }),
            ],
            // Never assessed: developed, owned, but the population processor has not run on it yet —
            // every absent-not-zero field left untouched.
            [neverAssessed, developedPatch(pid)],
          ]),
        ),
      );

      const populationCollapse = category("population_collapse");
      const ids = populationCollapse.instances.map((i) => i.systemId);
      expect(ids).toContain(assessed);
      expect(ids).not.toContain(neverAssessed);
    });

    it("raises the alert for a well-fed world losing population to unrest alone — not gated on famine", () => {
      // The whole point of the trend gate: Abandonment Rule 2 fires on below-floor population alone,
      // famine or not, so a world with a healthy supply band but a declining trend must still surface.
      const world = seatWorld();
      const pid = world.player!.controlledFactionId;
      const [target] = spareSystemIds(world, 1);
      setWorld(
        withSystems(
          world,
          new Map([
            [
              target,
              developedPatch(pid, {
                supplyBand: "rationing",
                provision: 0.9,
                populationTrend: -0.05,
                populationChange: -5,
                population: 100,
              }),
            ],
          ]),
        ),
      );

      const ids = category("population_collapse").instances.map((i) => i.systemId);
      expect(ids).toContain(target);
    });

    it("does not raise the alert for a GROWING world, however fast — the sign is the whole gate, not just the magnitude", () => {
      // The regression this test exists to catch: a signed comparison inverted (e.g. `>=
      // +threshold` instead of `<= -threshold`) fires on thriving worlds and stays silent on dying
      // ones. A positive populationTrend of the same magnitude the shrinking tests use must never
      // qualify, however far past the threshold's magnitude it sits.
      const world = seatWorld();
      const pid = world.player!.controlledFactionId;
      const [target] = spareSystemIds(world, 1);
      setWorld(
        withSystems(
          world,
          new Map([
            [
              target,
              developedPatch(pid, {
                populationTrend: 0.05, // growing, well past the threshold's magnitude
                populationChange: 5,
                population: 100,
              }),
            ],
          ]),
        ),
      );

      const ids = category("population_collapse").instances.map((i) => i.systemId);
      expect(ids).not.toContain(target);
    });

    it("does not raise the alert for a famine world whose trend hasn't crossed the threshold — the old non-shrinking branch is a deliberate demotion", () => {
      const world = seatWorld();
      const pid = world.player!.controlledFactionId;
      const [target] = spareSystemIds(world, 1);
      setWorld(
        withSystems(
          world,
          new Map([
            [
              target,
              developedPatch(pid, {
                supplyBand: "famine",
                provision: 0.1,
                populationTrend: -0.001, // below POPULATION_COLLAPSE_TREND_THRESHOLD in magnitude
                populationChange: 0,
                population: 100,
              }),
            ],
          ]),
        ),
      );

      const ids = category("population_collapse").instances.map((i) => i.systemId);
      expect(ids).not.toContain(target);
    });

    it("reports the time-to-abandonment countdown off populationChange", () => {
      const world = seatWorld();
      const pid = world.player!.controlledFactionId;
      const [shrinking] = spareSystemIds(world, 1);
      setWorld(
        withSystems(
          world,
          new Map([
            [
              shrinking,
              developedPatch(pid, {
                population: 100,
                populationTrend: -0.05, // gates entry (negative = shrinking)
                populationChange: -5, // k = 0.05/cycle -> ln(100)/0.05 — drives the countdown
              }),
            ],
          ]),
        ),
      );

      const populationCollapse = category("population_collapse");
      expect(populationCollapse.instances.map((i) => i.systemId)).toEqual([shrinking]);
      // countdown = ln(100)/0.05 ≈ 92.1 cycles = 2210.48 ticks = 552.62 days = 1.535 years (360
      // days/year) — rounded to the nearest tenth of a year by formatDuration's years branch.
      expect(populationCollapse.instances[0].measure).toBe("≈1.5 years to abandonment");
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

    it("sorts the most suppressed world first — ascending strikeMultiplier, worst first", () => {
      const world = seatWorld();
      const pid = world.player!.controlledFactionId;
      // Authored deliberately in the OPPOSITE order to the expected sort: a constant sortKey would
      // leave them in this array order and read mildest-first.
      const [milder, worse] = spareSystemIds(world, 2);
      setWorld(
        withSystems(
          world,
          new Map([
            [milder, developedPatch(pid, { unrest: 0.7 })],
            [worse, developedPatch(pid, { unrest: 0.95 })],
          ]),
        ),
      );

      // Premise, measured not assumed: more unrest really is more suppression on this scale, so the
      // expected order below is not an artefact of two equal multipliers.
      const worseMultiplier = strikeMultiplier(0.95, STRIKE_PARAMS);
      expect(worseMultiplier).toBeLessThan(strikeMultiplier(0.7, STRIKE_PARAMS));

      const strike = category("strike");
      expect(strike.instances.map((i) => i.systemId)).toEqual([worse, milder]);
      expect(strike.instances[0].measure).toBe(`production at ${Math.round(worseMultiplier * 100)}%`);
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

    it("sorts the deepest grievance first — the sortKey is negated, so a dropped minus sign inverts it", () => {
      const world = seatWorld();
      const pid = world.player!.controlledFactionId;
      // Authored shallowest-first so a constant sortKey (or an un-negated one) reads mildest-first.
      const [shallow, deep] = spareSystemIds(world, 2);
      setWorld(
        withSystems(
          world,
          new Map([
            // grievance 0.8 − 0.7 = 0.1
            [shallow, developedPatch(pid, { provision: 0.7, provisionExpectation: 0.8, unrest: 0.1 })],
            // grievance 0.9 − 0.3 = 0.6 — six times deeper
            [deep, developedPatch(pid, { provision: 0.3, provisionExpectation: 0.9, unrest: 0.1 })],
          ]),
        ),
      );

      const unrestRising = category("unrest_rising");
      expect(unrestRising.instances.map((i) => i.systemId)).toEqual([deep, shallow]);
      expect(unrestRising.instances[0].measure).toBe("30% Provisioned, expects 90%");
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

    it("sorts the most over-capacity world first — the sortKey is negated, so a dropped minus sign inverts it", () => {
      const world = seatWorld();
      const pid = world.player!.controlledFactionId;
      // Authored mildest-first so a constant (or un-negated) sortKey reads mildest-first too.
      const [milder, worse] = spareSystemIds(world, 2);
      setWorld(
        withSystems(
          world,
          new Map([
            [milder, developedPatch(pid, { population: 110, popCap: 100 })], // 110% of housing
            [worse, developedPatch(pid, { population: 200, popCap: 100 })], // 200% of housing
          ]),
        ),
      );

      const overcrowded = category("overcrowded");
      expect(overcrowded.instances.map((i) => i.systemId)).toEqual([worse, milder]);
      expect(overcrowded.instances[0].measure).toBe("200% of housing");
    });
  });

  describe("No housing headroom", () => {
    // Proves (6): no_housing_headroom fires only for genuinely people-land-full systems — a system
    // the OLD shared-general bound would have flagged (queued factory exhausts industry land, but
    // people land still has room) no longer alerts, now that housing bills to people land alone.
    it("a queued FACTORY (not housing) that exhausts industry land no longer touches this read", () => {
      // Historically a committed factory (queued, non-housing) reduced the OLD shared general
      // bound and could flag this category even with free people land. The build rule now bills
      // housing to people land only, so an industry-land-exhausted queue no longer folds into
      // this read: 3 landed housing levels leave people-land (habitable) headroom = 5 - 3 = 2
      // (>= 1), regardless of how much industry land the queued metals levels claim.
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
              peopleLand: 5,
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
          ...withTarget.constructionProjects.filter((p) => p.kind === "lane_upgrade" || p.systemId !== target),
          queuedFactory,
        ],
      };
      setWorld(withFixture);

      // Still Overcrowded (61 > 60, persisted popCap) — but people land alone has real headroom
      // (5 - 3 = 2 >= 1), so this system does not read "no housing headroom" any more, even
      // though the queued metals levels leave zero industry land free.
      expect(category("overcrowded").instances.map((i) => i.systemId)).toContain(target);
      expect(category("no_housing_headroom").instances.map((i) => i.systemId)).not.toContain(target);
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
              peopleLand: 5,
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
          ...withTarget.constructionProjects.filter((p) => p.kind === "lane_upgrade" || p.systemId !== target),
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
              peopleLand: 5,
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

    it("sorts the most over-cap world first — the sortKey is negated, so a dropped minus sign inverts it", () => {
      const world = seatWorld();
      const pid = world.player!.controlledFactionId;
      // Authored mildest-first so a constant (or un-negated) sortKey reads mildest-first too.
      const [milder, worse] = spareSystemIds(world, 2);
      const withTargets = withSystems(
        world,
        new Map([
          // Both: 5 landed housing levels on peopleLand 5 exhaust headroom outright
          // (min(5 − 5, 100 − 5) = 0), so both satisfy the category's third conjunct with no queue
          // fold needed, and neither has a housing level standing in its queue.
          [milder, developedPatch(pid, { population: 61, popCap: 60, peopleLand: 5 })],
          [worse, developedPatch(pid, { population: 100, popCap: 60, peopleLand: 5 })],
        ]),
      );
      setWorld(
        withBuildings(withTargets, [milder, worse], [
          { systemId: milder, buildingType: HOUSING_TYPE, count: 5 },
          { systemId: worse, buildingType: HOUSING_TYPE, count: 5 },
        ]),
      );

      const noHousing = category("no_housing_headroom");
      expect(noHousing.instances.map((i) => i.systemId)).toEqual([worse, milder]);
      expect(noHousing.instances[0].measure).toBe("40 over cap, no room to build");
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
      // 1.0 cycles = 24 ticks = 6 days (TICKS_PER_DAY = 4) — under formatDuration's 45-day whole-days
      // branch.
      expect(stockFalling.instances[0].measure).toBe("food empties in ≈6 days");
    });

    it("excludes a row carrying stock but no stockChange — never assessed is not a countdown", () => {
      const world = seatWorld();
      const pid = world.player!.controlledFactionId;
      const [target] = spareSystemIds(world, 1);
      const withTarget = withSystems(world, new Map([[target, developedPatch(pid)]]));
      // Absent, not zero, and not rare: world-gen never writes `stockChange` (lib/world/gen.ts),
      // so this is the state EVERY market row is in on a freshly generated world and on any save
      // written before the field existed — until an economy cycle has run. `stock / -undefined` is
      // NaN, and NaN fails every comparison below it, so an absent reading that reached the divide
      // would leak an instance measured "empties in NaN cycles".
      setWorld(withMarketRows(withTarget, [marketRow(target, "food", { stock: 50 })]));

      // The COUNT, not membership: a NaN sortKey sorts unpredictably, so `not.toContain` on the
      // instance list could pass by accident while the leak sat elsewhere in it.
      expect(category("survival_stock_falling").count).toBe(0);

      // Same row, same system, with a real reading: 50 / 25 = 2 cycles, inside the threshold. The
      // exclusion above is therefore the absent field, not a fixture the category never walked.
      setWorld(withMarketRows(withTarget, [marketRow(target, "food", { stock: 50, stockChange: -25 })]));
      const assessed = category("survival_stock_falling");
      expect(assessed.count).toBe(1);
      expect(assessed.instances[0].systemId).toBe(target);
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
        marketRow(target, "food", { unservedShortfall: 5 }),
        marketRow(target, "ore", { unservedShortfall: 20 }),
        marketRow(target, "metals", { unservedShortfall: 8 }),
        // A row with no unservedShortfall never contributes — a merely funding-bound deficit
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

    it("excludes a row with no shortfall and one whose shortfall is 0 — absence-or-zero is servable, never demandRate", () => {
      const world = seatWorld();
      const pid = world.player!.controlledFactionId;
      const [absent, zeroed] = spareSystemIds(world, 2);
      const withTargets = withSystems(
        world,
        new Map([
          [absent, developedPatch(pid)],
          [zeroed, developedPatch(pid)],
        ]),
      );
      const withFixture = withMarketRows(withTargets, [
        // No unservedShortfall at all: a row the logistics run never classified. Must not fall back
        // to demandRate, the read-time proxy the persisted level replaced.
        marketRow(absent, "food", { demandRate: 999 }),
        // A literal 0: the level IS the classification, and the engine never queues a deficit with a
        // non-positive shortfall, so 0 can only mean servable — never "unservable by nothing".
        marketRow(zeroed, "food", { unservedShortfall: 0, demandRate: 999 }),
      ]);
      setWorld(withFixture);

      const ids = category("demand_unservable").instances.map((i) => i.systemId);
      expect(ids).not.toContain(absent);
      expect(ids).not.toContain(zeroed);
    });
  });

  describe("Lane congested", () => {
    it("counts a lane the player can act on, sorted by blocked volume descending", () => {
      const world = seatWorld();
      const pid = world.player!.controlledFactionId;
      const [a, b, c, d] = spareSystemIds(world, 4);
      const withTargets = withSystems(
        world,
        new Map([
          [a, developedPatch(pid)],
          [b, developedPatch(pid)],
          [c, developedPatch(pid)],
          [d, developedPatch(pid)],
        ]),
      );
      setWorld(
        withLanes(withTargets, [
          lane(a, b, { blockedVolume: 3 }),
          lane(c, d, { blockedVolume: 12 }),
        ]),
      );

      const laneCongested = category("lane_congested");
      expect(laneCongested.count).toBe(2);
      // Biggest blocked volume first — the smaller lane (a|b, 3) sorts behind the bigger (c|d, 12).
      expect(laneCongested.instances.map((i) => i.laneKey)).toEqual([laneKey(c, d), laneKey(a, b)]);
      expect(laneCongested.instances[0].measure).toBe("12.0 blocked");
    });

    it("names an instance '<A name> — <B name>'", () => {
      const world = seatWorld();
      const pid = world.player!.controlledFactionId;
      const [a, b] = spareSystemIds(world, 2);
      const withTargets = withSystems(
        world,
        new Map([[a, developedPatch(pid)], [b, developedPatch(pid)]]),
      );
      const fixture = withLanes(withTargets, [lane(a, b, { blockedVolume: 5 })]);
      setWorld(fixture);

      const [aId, bId] = a < b ? [a, b] : [b, a];
      const aName = fixture.systems.find((s) => s.id === aId)!.name;
      const bName = fixture.systems.find((s) => s.id === bId)!.name;
      expect(category("lane_congested").instances[0].name).toBe(`${aName} — ${bName}`);
    });

    it("excludes a lane with no blocked volume", () => {
      const world = seatWorld();
      const pid = world.player!.controlledFactionId;
      const [a, b] = spareSystemIds(world, 2);
      const withTargets = withSystems(
        world,
        new Map([[a, developedPatch(pid)], [b, developedPatch(pid)]]),
      );
      setWorld(withLanes(withTargets, [lane(a, b, { blockedVolume: 0 })]));

      expect(category("lane_congested").instances).toHaveLength(0);
    });

    it("excludes a lane the player cannot act on — both endpoints foreign, not the investor", () => {
      const world = seatWorld();
      const pid = world.player!.controlledFactionId;
      const [a, b] = spareSystemIds(world, 2);
      const otherFaction = `not-${pid}`;
      const withTargets = withSystems(
        world,
        new Map([
          [a, { factionId: otherFaction, control: "developed" }],
          [b, { factionId: otherFaction, control: "developed" }],
        ]),
      );
      setWorld(withLanes(withTargets, [lane(a, b, { blockedVolume: 20 })]));

      const laneCongested = category("lane_congested");
      expect(laneCongested.instances).toHaveLength(0);
      // A lane the player has no stake in is never a candidate for this category's own denominator
      // either — see `LaneScopedAlertCategory`'s own docstring for why it counts only ACTIONABLE lanes.
      expect(laneCongested.denominator).toBe(0);
    });

    it("includes a lane through one held endpoint alone, even with a foreign other endpoint and no investor", () => {
      const world = seatWorld();
      const pid = world.player!.controlledFactionId;
      const [a, b] = spareSystemIds(world, 2);
      const withTargets = withSystems(
        world,
        new Map([
          [a, developedPatch(pid)],
          [b, { factionId: `not-${pid}`, control: "developed" }],
        ]),
      );
      setWorld(withLanes(withTargets, [lane(a, b, { blockedVolume: 5 })]));

      const laneCongested = category("lane_congested");
      expect(laneCongested.instances.map((i) => i.laneKey)).toEqual([laneKey(a, b)]);
      expect(laneCongested.denominator).toBe(1);
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

    it("tiebreaks WITHIN one reason by droppedRoi (bigger drop first) and never spills into the next-more-severe reason's bucket", () => {
      const world = seatWorld();
      const pid = world.player!.controlledFactionId;
      // Authored in an order that is neither the expected sort nor severity-stable: a sortKey of
      // `severity` alone would leave the three no-consumer rows in THIS order (roi 0, 1000, 1e9),
      // which is the reverse of what the tiebreak must produce.
      const [roiNone, roiMid, roiHuge, worseReason] = spareSystemIds(world, 4);
      setWorld(
        withSystems(
          world,
          new Map([
            [roiNone, developedPatch(pid, { buildBlocked: { reason: "no-consumer", droppedRoi: 0 } })],
            [roiMid, developedPatch(pid, { buildBlocked: { reason: "no-consumer", droppedRoi: 1000 } })],
            // The spill case: no-consumer is severity 3, so its worst possible key approaches 2 from
            // above without ever reaching it. 1e9 puts this row at 3 − 1e9/(1e9+1) ≈ 2.000000001.
            [roiHuge, developedPatch(pid, { buildBlocked: { reason: "no-consumer", droppedRoi: 1e9 } })],
            // …and no-input-supplier is severity 2 with droppedRoi 0, i.e. sortKey exactly 2 — the
            // best case of the next-more-severe reason, which the row above must still sort behind.
            [worseReason, developedPatch(pid, { buildBlocked: { reason: "no-input-supplier", droppedRoi: 0 } })],
          ]),
        ),
      );

      const blocked = category("build_blocked");
      expect(blocked.instances.map((i) => i.systemId)).toEqual([worseReason, roiHuge, roiMid, roiNone]);
      expect(blocked.instances[2].measure).toBe("no consumer (dropped ROI 1000.00)");
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

    it("divides idle levels by BUILT non-housing levels — 2 of 5 idle ore levels beside 5 housing levels reads 40%", () => {
      // The one fixture that pins the denominator AND the housing exclusion at once. 40% is
      // reachable only by the authored formula: 100% is what a constant denominator (or dividing by
      // idleLevelsTotal) gives, and folding housing back into both terms gives 70%.
      const world = seatWorld();
      const pid = world.player!.controlledFactionId;
      const [target] = spareSystemIds(world, 1);
      const roster = { ore: 5, [HOUSING_TYPE]: 5 };
      // Half-staffed: ore's used is 5 × labourFulfil = 2.5, so exactly 2 WHOLE levels read idle.
      const withTarget = withSystems(
        world,
        new Map([[target, developedPatch(pid, { population: 0.5 * labourDemand(roster) })]]),
      );
      setWorld(
        withBuildings(withTarget, [target], [
          { systemId: target, buildingType: "ore", count: 5 },
          { systemId: target, buildingType: HOUSING_TYPE, count: 5 },
        ]),
      );

      // Premise, measured off the panel's own readout rather than assumed: exactly 2 whole ore
      // levels are idle, and housing carries idle levels of its own that must NOT reach the figure.
      const panel = getSystemIndustry(target);
      if (panel.visibility !== "visible") throw new Error("fixture: target is not visible");
      const ore = panel.buildings.find((b) => b.buildingType === "ore")!;
      const housing = panel.buildings.find((b) => b.buildingType === HOUSING_TYPE)!;
      expect(Math.floor(ore.count - ore.used)).toBe(2);
      expect(Math.floor(housing.count - housing.used)).toBeGreaterThanOrEqual(1);

      const idle = category("industry_idle");
      expect(idle.instances.find((i) => i.systemId === target)?.measure).toBe("40% idle capacity");
    });

    it("says nothing about a system whose idle capacity is under one WHOLE level", () => {
      // The gate the "100% idle" fixture cannot reach: it is whole idle levels that make a system
      // worth naming, not any idleness at all — a system running at 95% staffing is working, and a
      // category that fired on it would name most of the empire every cycle.
      const world = seatWorld();
      const pid = world.player!.controlledFactionId;
      const [target] = spareSystemIds(world, 1);
      const roster = { ore: 5 };
      const withTarget = withSystems(
        world,
        new Map([[target, developedPatch(pid, { population: 0.95 * labourDemand(roster) })]]),
      );
      setWorld(withBuildings(withTarget, [target], [{ systemId: target, buildingType: "ore", count: 5 }]));

      // Premise: there IS real idle capacity here (used strictly below count), just less than one
      // whole level of it — without this the exclusion below could hold for the wrong reason.
      const panel = getSystemIndustry(target);
      if (panel.visibility !== "visible") throw new Error("fixture: target is not visible");
      const ore = panel.buildings.find((b) => b.buildingType === "ore")!;
      expect(ore.used).toBeLessThan(ore.count);
      expect(ore.used).toBeGreaterThan(ore.count - 1);

      expect(category("industry_idle").instances.map((i) => i.systemId)).not.toContain(target);
    });

    it("surfaces a fully staffed, freely selling producer idled only by missing recipe inputs", () => {
      // The documented reason this category goes through the full readout rather than a cheaper
      // persisted signal: the input gate is folded into `used` only inside buildIndustryReadout, so
      // an input-starved factory is invisible to every other idle signal in the game. Nothing here
      // is short of labour, skill or a buyer — only ore, which never arrives.
      const world = seatWorld();
      const pid = world.player!.controlledFactionId;
      const [target] = spareSystemIds(world, 1);
      const roster = { metals: 5, vocational_school: 1 };
      const withTarget = withSystems(
        world,
        new Map([[target, developedPatch(pid, { population: labourDemand(roster) })]]),
      );
      setWorld(
        withBuildings(withTarget, [target], [
          { systemId: target, buildingType: "metals", count: 5 },
          // Licenses the skilled work metals draws, so no skill ceiling can be the binding cause.
          { systemId: target, buildingType: "vocational_school", count: 1 },
        ]),
      );

      // Premise, read off the panel: the smelters are fully staffed and the readout names INPUTS —
      // not labour, not skill, not selling — as the binding constraint.
      const panel = getSystemIndustry(target);
      if (panel.visibility !== "visible") throw new Error("fixture: target is not visible");
      const metals = panel.buildings.find((b) => b.buildingType === "metals")!;
      expect(metals.staffedFraction).toBeCloseTo(1, 6);
      expect(metals.idleReason).toBe("inputs");

      expect(category("industry_idle").instances.map((i) => i.systemId)).toContain(target);
    });

    it("reads a market row's PERSISTED honestUseRate, not a recompute — a stored figure that lifts the brake knee takes the system out of the category", () => {
      // The two runs below differ in exactly one field. Fully staffed extractors sitting on a
      // glutted yard: with no persisted use figure the readout recomputes one, the brake knee lands
      // far below the stock and the producers stop selling, so every level reads idle. A persisted
      // use figure orders of magnitude larger puts the knee above the same stock, the producers
      // sell, and nothing is idle. A read that ignored the stored figure would report the first
      // answer in both runs.
      const world = seatWorld();
      const pid = world.player!.controlledFactionId;
      const [target] = spareSystemIds(world, 1);
      const roster = { ore: 5 };
      const withTarget = withSystems(
        world,
        new Map([[target, developedPatch(pid, { population: labourDemand(roster) })]]),
      );
      const withOre = withBuildings(withTarget, [target], [{ systemId: target, buildingType: "ore", count: 5 }]);
      const GLUT = 1e6;

      // No persisted figure: the recompute fallback runs and the brake is shut on this stock.
      setWorld(withMarketRows(withOre, [marketRow(target, "ore", { stock: GLUT, storageCapacity: GLUT * 10 })]));
      const recomputed = getSystemIndustry(target);
      if (recomputed.visibility !== "visible") throw new Error("fixture: target is not visible");
      expect(recomputed.buildings.find((b) => b.buildingType === "ore")!.idleReason).toBe("selling");
      expect(category("industry_idle").instances.map((i) => i.systemId)).toContain(target);

      // Same world, same stock, plus a persisted use figure large enough to carry the knee past it.
      clearWorld();
      setWorld(
        withMarketRows(withOre, [
          marketRow(target, "ore", { stock: GLUT, storageCapacity: GLUT * 10, honestUseRate: 1e9 }),
        ]),
      );
      const persisted = getSystemIndustry(target);
      if (persisted.visibility !== "visible") throw new Error("fixture: target is not visible");
      expect(persisted.buildings.find((b) => b.buildingType === "ore")!.idleReason).toBeUndefined();
      expect(category("industry_idle").instances.map((i) => i.systemId)).not.toContain(target);
    });

    it("reports exactly what the Industry panel's own readout says is idle — one shared context, two consumers", () => {
      // Both surfaces build a `buildIndustryReadout` context from world state, and they must build
      // the SAME one: if they diverge in any accessor (the persisted-vs-recomputed honestUseRate
      // fallback, the anchor multiplier, the funding-bound bit), the panel and the chip start
      // disagreeing about which levels are running. This walks every developed player system and
      // pins the chip's figure against the panel's own readout, recomputed here from the panel's
      // published buildings rather than from any shared helper.
      const world = seatWorld();
      const pid = world.player!.controlledFactionId;
      const [partial, unstaffed] = spareSystemIds(world, 2);
      const withTargets = withSystems(
        world,
        new Map([
          // A small population against several extractor levels — partially staffed, so the readout
          // carries real fractional `used` figures rather than a degenerate all-or-nothing one.
          [partial, developedPatch(pid, { population: 40 })],
          [unstaffed, developedPatch(pid, { population: 0 })],
        ]),
      );
      const withBuildings: World = {
        ...withTargets,
        buildings: [
          ...withTargets.buildings.filter((b) => b.systemId !== partial && b.systemId !== unstaffed),
          { systemId: partial, buildingType: "ore", count: 6, idleCycles: 0 },
          { systemId: partial, buildingType: HOUSING_TYPE, count: 3, idleCycles: 0 },
          { systemId: unstaffed, buildingType: "ore", count: 5, idleCycles: 0 },
        ],
      };
      // No `honestUseRate` on these rows, so the readout must take its recompute fallback — the one
      // accessor most likely to be written differently by two hand-rolled context assemblies.
      setWorld(withMarketRows(withBuildings, [
        marketRow(partial, "ore", { stock: 40 }),
        marketRow(unstaffed, "ore", { stock: 40 }),
      ]));

      const idle = category("industry_idle");
      expect(idle.instances.length).toBeGreaterThan(0); // premise: something is actually idle

      const developed = getWorld().systems.filter((s) => s.factionId === pid && s.control === "developed");
      expect(developed.length).toBeGreaterThan(1);
      for (const system of developed) {
        const panel = getSystemIndustry(system.id);
        if (panel.visibility !== "visible") throw new Error(`fixture: ${system.id} is not visible`);
        let builtLevels = 0;
        let idleLevels = 0;
        for (const b of panel.buildings) {
          if (b.buildingType === HOUSING_TYPE) continue;
          builtLevels += b.count;
          idleLevels += Math.max(0, Math.floor(b.count - b.used));
        }
        const expected = builtLevels > 0 && idleLevels >= 1
          ? `${Math.round((idleLevels / builtLevels) * 100)}% idle capacity`
          : undefined;
        expect(idle.instances.find((i) => i.systemId === system.id)?.measure).toBe(expected);
      }
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
          charged: { maintenance: 50, logistics: 0, construction: 0 }, // bill × the 0.5 slider in force at the settlement
          paid: { maintenance: 50, logistics: 0, construction: 0 }, // paid it in full — solvent
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
          charged: { maintenance: 100, logistics: 0, construction: 0 },
          paid: { maintenance: 50, logistics: 0, construction: 0 }, // 50 < 100 asked — insolvent
        }),
      });
      setWorld(withFixture);

      const unfunded = category("maintenance_unfunded");
      expect(unfunded.instances).toHaveLength(1);
      expect(unfunded.instances[0].systemId).toBeNull();
    });

    it("counts the faction, bare — no developed-systems denominator on a row that names no system", () => {
      // This is one faction-level row whose count is 0 or 1 by construction. Carried against the
      // shared denominator it would render "Maintenance unfunded, 1 of 253 developed systems" about
      // a settlement, which is not a share of anything — the same reason the event categories carry
      // no denominator either.
      const world = seatWorld();
      const pid = world.player!.controlledFactionId;
      // Three extra developed systems, so the shared denominator is a number visibly bigger than
      // this category's own count of 1 — the exact misreading ("1 of 4 developed systems") the bare
      // count exists to avoid.
      const withEmpire = withSystems(
        world,
        new Map(spareSystemIds(world, 3).map((id) => [id, developedPatch(pid)])),
      );
      setWorld(
        withTreasury(withEmpire, pid, {
          bands: { maintenance: 1, logistics: 1, construction: 1 },
          lastSettlement: settlement({
            maintenanceBill: 100,
            charged: { maintenance: 100, logistics: 0, construction: 0 },
            paid: { maintenance: 50, logistics: 0, construction: 0 },
          }),
        }),
      );

      const unfunded = category("maintenance_unfunded");
      expect(unfunded.unit).toBe("faction");
      expect(unfunded.count).toBe(1);
      // No denominator key at all — not a present-but-zero one a renderer would print as "1 of 0".
      expect("denominator" in unfunded).toBe(false);
      // Non-vacuous: the shared denominator this category must NOT be carrying is a real, larger
      // number on the very same read.
      const populationCollapse = category("population_collapse");
      if (populationCollapse.unit !== "developed_systems") throw new Error("Population collapse must count developed systems");
      expect(populationCollapse.denominator).toBeGreaterThan(1);
    });

    it("does not fire after the player raises the slider on a faction whose last settlement was solvent", () => {
      // The settlement is the solvent one above — charged 50 at a 0.5 slider and paid all of it —
      // but the player has since pushed maintenance to 1.0 with no settlement in between (the verb
      // writes the slider and nothing else, so `paid` is frozen at what the OLD slider asked for).
      // Reading the live slider here would charge this settlement 100 retroactively and fire a
      // critical, non-hideable alert on a solvent faction — and it would fire for taking exactly the
      // corrective action the alert asks for, indefinitely while the game is paused.
      const world = seatWorld();
      const pid = world.player!.controlledFactionId;
      const withFixture = withTreasury(world, pid, {
        bands: { maintenance: 1, logistics: 1, construction: 1 },
        lastSettlement: settlement({
          maintenanceBill: 100,
          charged: { maintenance: 50, logistics: 0, construction: 0 },
          paid: { maintenance: 50, logistics: 0, construction: 0 },
        }),
      });
      setWorld(withFixture);

      expect(category("maintenance_unfunded").instances).toHaveLength(0);
    });

    it("does not fire on a settlement written before the charge was recorded — absent reads as never assessed", () => {
      // A save from before the field existed carries `paid` and the bill but no record of what the
      // settlement asked for. Guessing from the live slider is exactly the fault above, so an
      // unrecorded charge is skipped and the faction's next settlement fills it in — even though
      // these numbers would look insolvent against a 1.0 slider.
      const world = seatWorld();
      const pid = world.player!.controlledFactionId;
      const withFixture = withTreasury(world, pid, {
        bands: { maintenance: 1, logistics: 1, construction: 1 },
        lastSettlement: settlement({
          maintenanceBill: 100,
          paid: { maintenance: 50, logistics: 0, construction: 0 },
        }),
      });
      setWorld(withFixture);

      expect(category("maintenance_unfunded").instances).toHaveLength(0);
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
        new Map([[target, candidatePatch(pid, { colonyOpportunity: { value: 100, work: 10 } })]]),
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
        new Map([[target, candidatePatch(pid, { colonyOpportunity: { value: 100, work: 10 } })]]),
      );
      setWorld(withAutomation(withTarget, { colonisation: false }));

      expect(category("colony_opportunity").instances.map((i) => i.systemId)).toContain(target);
    });

    it("excludes a player-owned system with no stored colonyOpportunity — absence-not-zero", () => {
      const world = seatWorld();
      const pid = world.player!.controlledFactionId;
      const [target] = spareSystemIds(world, 1);
      const withTarget = withSystems(world, new Map([[target, candidatePatch(pid)]]));
      setWorld(withAutomation(withTarget, { colonisation: false }));

      expect(category("colony_opportunity").instances.map((i) => i.systemId)).not.toContain(target);
    });

    it("drops the row the moment a colony-establish project opens at the system, stored signal or not", () => {
      // The stored colonyOpportunity only clears at the next planner run, but a forming colony is
      // the spec's own clearing condition — derived at read time so ordering drops the row
      // immediately and cancelling returns it, with no cycle lag either way.
      const world = seatWorld();
      const pid = world.player!.controlledFactionId;
      const [target] = spareSystemIds(world, 1);
      const withTarget = withSystems(
        world,
        new Map([[target, candidatePatch(pid, { colonyOpportunity: { value: 100, work: 10 } })]]),
      );
      const forming = withAutomation(withTarget, { colonisation: false });
      setWorld({
        ...forming,
        constructionProjects: [
          {
            kind: "colony_establish", id: "e1", origin: "player", factionId: pid,
            systemId: target, sourceSystemId: "src", seedPop: 2, housingLevels: 1,
            workTotal: 100, workDone: 0, stagedManifest: [], charterPaid: false, stalledCycles: 0,
          },
        ],
      });
      expect(category("colony_opportunity").instances.map((i) => i.systemId)).not.toContain(target);

      // Cancel (project removed) → the row is back, from the same stored signal.
      setWorld({ ...getWorld(), constructionProjects: [] });
      expect(category("colony_opportunity").instances.map((i) => i.systemId)).toContain(target);
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
      const depositCounts = emptyResourceVector();
      for (const k of RESOURCE_TYPES) depositCounts[k] = 20;
      const devRefs: DevelopmentRefs = { popRef: 150, industryRef: 12 };
      const builder = (): BuildSystemState => ({
        systemId: "B", factionId: "f1", population: 100_000, control: "developed", buildings: {},
        depositCounts, peopleLand: 0, goods: [],
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
        depositCounts: emptyResourceVector(), peopleLand: 0, goods,
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
          [lowRoi, candidatePatch(pid, { colonyOpportunity: { value: 20, work: 10 } })],
          // ROI 5
          [highRoi, candidatePatch(pid, { colonyOpportunity: { value: 50, work: 10 } })],
        ]),
      );
      setWorld(withAutomation(withFixture, { colonisation: false }));

      const colonyOpp = category("colony_opportunity");
      expect(colonyOpp.instances.map((i) => i.systemId)).toEqual([highRoi, lowRoi]);
    });

    it("counts candidates against the CONTROLLED systems total, never the developed one it is disjoint from", () => {
      // A colony candidate is a claimed, not-yet-developed system, so it is never in the developed
      // set the other system-scoped chips are a share of. Carried against that denominator the chip
      // can print more candidates than there are developed systems — "3 of 1 developed systems" —
      // because the two populations have no member in common.
      //
      // Sized so the misread is visible: four developed systems, three candidates, two of them
      // carrying a stored proposal. Nothing here can pass by coincidence — the right denominator (3)
      // is neither the wrong one (4) nor the count (2).
      const world = seatWorld();
      const pid = world.player!.controlledFactionId;
      const [devA, devB, devC, candA, candB, candC] = spareSystemIds(world, 6);
      const withFixture = withSystems(
        world,
        new Map([
          [devA, developedPatch(pid)],
          [devB, developedPatch(pid)],
          [devC, developedPatch(pid)],
          [candA, candidatePatch(pid, { colonyOpportunity: { value: 50, work: 10 } })],
          [candB, candidatePatch(pid, { colonyOpportunity: { value: 20, work: 10 } })],
          // A third candidate the planner proposed nothing for: in the denominator, not the count.
          [candC, candidatePatch(pid)],
        ]),
      );
      setWorld(withAutomation(withFixture, { colonisation: false }));

      const developedCount = getWorld().systems.filter(
        (s) => s.factionId === pid && s.control === "developed",
      ).length;

      const colonyOpp = category("colony_opportunity");
      if (colonyOpp.unit !== "controlled_systems") throw new Error("Colony opportunity must count controlled systems");
      expect(colonyOpp.count).toBe(2);
      expect(colonyOpp.denominator).toBe(3);
      // The developed total is a real, different number on this very same read — and the one this
      // category must not be carrying.
      expect(developedCount).toBe(4); // three patched here plus the faction's homeworld
      expect(colonyOpp.denominator).not.toBe(developedCount);
      const populationCollapse = category("population_collapse");
      if (populationCollapse.unit !== "developed_systems") throw new Error("Population collapse must count developed systems");
      expect(populationCollapse.denominator).toBe(developedCount);
      // What the mismatch actually breaks: a count that can exceed what it is rendered against.
      expect(colonyOpp.count).toBeLessThanOrEqual(colonyOpp.denominator);
    });
  });

  describe("Category order", () => {
    it("emits all fourteen categories, in registry tier + order", () => {
      const world = seatWorld();
      setWorld(world);

      const ids = getAlertData().categories.map((c) => c.id);
      expect(ids).toEqual([
        "population_collapse", "strike", "maintenance_unfunded",
        "deprived_worlds", "unrest_rising", "survival_stock_falling", "demand_unservable",
        "lane_congested", "overcrowded", "no_housing_headroom", "build_blocked", "industry_idle",
        "build_opportunity", "colony_opportunity",
      ]);
    });

    // The three event alert categories (crisis / disruption / windfall) are gone
    // with no replacement, so an active event — including the one type that still touches the
    // player's own economy — builds no event category at all, even while it is live.
    it("still emits exactly the fourteen categories with an active border_conflict in play — no event category is built", () => {
      const world = seatWorld();
      const pid = world.player!.controlledFactionId;
      const otherFaction = world.factions.find((f) => f.id !== pid)!.id;
      const withFixture: World = {
        ...world,
        events: [
          {
            id: "ev-border", type: "border_conflict", phase: "skirmish", systemId: null, regionId: null,
            startTick: 0, phaseStartTick: 0, phaseDuration: 50,
            metadata: { factionAId: pid, factionBId: otherFaction, expiresAtTick: 9999 },
          },
        ],
      };
      setWorld(withFixture);

      const ids = getAlertData().categories.map((c) => c.id);
      expect(ids).toHaveLength(14);
      for (const removed of ["crisis", "disruption", "windfall"]) {
        expect(ids).not.toContain(removed);
      }
    });
  });
});
