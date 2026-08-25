/**
 * The tick's worked-deposit write path: a tier-0 extractor count change (a landed build, a decay
 * shed, or an abandonment wipe) refolds the affected system's worked-prefix yield/eff vectors, and
 * those vectors survive the tick→world merge onto the `yield*`/`eff*` columns.
 *
 * The failure these guard is the silent no-op named in the spec: a refold that never reaches the
 * merged world leaves production reading generation-frozen columns while every row-level assertion
 * passes. So every count-change assertion here reads the MERGED WORLD's columns after a real
 * `runWorldTick`, never the transient tick row.
 *
 * The fixture replaces one system's bodies with a two-body field whose ground values are far apart
 * (a rich single ore slot on a full-modifier world, nine poor slots on a 0.6-modifier one), so a
 * count change of one crosses a body boundary and moves BOTH columns by an amount no rounding could
 * produce.
 */
import { describe, it, expect } from "vitest";
import { generateWorld } from "../gen";
import { runWorldTick, toTickSystems, refoldWorkedYields } from "../tick";
import { rebuildWorkedYieldColumns } from "../save";
import { workedYieldVectors, slottedBodiesBySystem, type SlottedBody } from "@/lib/engine/worked-deposits";
import { countColumns, effColumns, effOf, makeResourceVector, yieldColumns, yieldsOf } from "@/lib/engine/resources";
import { RICH_TYPE, POOR_TYPE, craftedBodies, craftedSlots } from "./worked-yield-fixture";
import { HOUSING_TYPE } from "@/lib/constants/industry";
import { BODY_ARCHETYPES } from "@/lib/constants/bodies";
import type { TickCadence } from "@/lib/constants/tick-cadence";
import type { World, WorldBuildProject, WorldSystem } from "../types";

/** A construction cadence far outside any test horizon — directed-build never resolves. */
const NEVER = 1_000_000;

/** Every stage resolves on every tick, so one `runWorldTick` call is one full cycle. */
const EVERY_TICK: TickCadence = { cycle: 1, construction: 1, logistics: 1 };

const ORE = "ore";

/**
 * Replace `systemId`'s bodies and building roster, and stamp its yield/eff columns with the fold
 * that matches the roster — so the world enters the tick with CORRECT columns and any post-tick
 * movement is the refold, never a stale-column repair.
 */
function craftWorld(
  base: World,
  systemId: string,
  buildings: Record<string, number>,
  systemOverrides: Partial<WorldSystem> = {},
): World {
  const worked = workedYieldVectors(craftedSlots(systemId), buildings);
  return {
    ...base,
    bodies: [...base.bodies.filter((b) => b.systemId !== systemId), ...craftedBodies(systemId)],
    systems: base.systems.map((s) =>
      s.id === systemId
        ? {
            ...s,
            ...countColumns(makeResourceVector({ ore: 10 })),
            ...yieldColumns(worked.yieldMult),
            ...effColumns(worked.eff),
            peopleLand: 5_000,
            ...systemOverrides,
          }
        : s,
    ),
    buildings: [
      ...base.buildings.filter((b) => b.systemId !== systemId),
      ...Object.entries(buildings).map(([buildingType, count]) => ({
        systemId, buildingType, count, idleCycles: 0,
      })),
    ],
  };
}

/** A faction that is not the player-controlled one — its builds run regardless of the automation switch. */
function autonomousFaction(world: World) {
  const faction = world.factions.find((f) => f.id !== world.player?.controlledFactionId);
  expect(faction).toBeDefined();
  if (!faction) throw new Error("no autonomous faction");
  return faction;
}

function oreCount(world: World, systemId: string): number {
  return world.buildings.find((b) => b.systemId === systemId && b.buildingType === ORE)?.count ?? 0;
}

function systemRow(world: World, systemId: string): WorldSystem {
  const row = world.systems.find((s) => s.id === systemId);
  if (!row) throw new Error(`system ${systemId} missing`);
  return row;
}

describe("worked-deposit refold — the tick write path", () => {
  it("the fixture's two bodies really do straddle a boundary (premise)", () => {
    expect(BODY_ARCHETYPES[RICH_TYPE].techLocked).toBe(false);
    expect(BODY_ARCHETYPES[POOR_TYPE].techLocked).toBe(false);
    const slots = craftedSlots("s");
    const one = workedYieldVectors(slots, { [ORE]: 1 });
    const two = workedYieldVectors(slots, { [ORE]: 2 });
    expect(one.eff.ore).not.toBe(two.eff.ore);
    expect(one.yieldMult.ore).not.toBe(two.yieldMult.ore);
  });

  it("a landed tier-0 build crossing a body boundary moves the MERGED world's yield/eff columns that same tick", async () => {
    const base = generateWorld({ systemCount: 60, seed: 7 });
    const faction = autonomousFaction(base);
    const systemId = faction.homeworldId;
    const crafted = craftWorld(base, systemId, { [ORE]: 1, [HOUSING_TYPE]: 40 });
    const project: WorldBuildProject = {
      id: "test-ore-build", kind: "build", factionId: faction.id, systemId, origin: "player",
      // A hair of work: the faction's per-cycle construction pool completes it on the first
      // construction cycle, so the landing and the refold happen on the tick under assertion.
      workTotal: 0.000_1, workDone: 0, buildingType: ORE, levels: 1,
    };
    const world: World = { ...crafted, constructionProjects: [...crafted.constructionProjects, project] };

    const before = systemRow(world, systemId);
    const { world: after } = await runWorldTick(world, { cadence: EVERY_TICK });

    const landed = oreCount(after, systemId);
    expect(landed).toBeGreaterThan(1); // premise: the build actually landed this tick
    const expected = workedYieldVectors(craftedSlots(systemId), { [ORE]: landed });
    const row = systemRow(after, systemId);
    expect(effOf(row).ore).toBe(expected.eff.ore);
    expect(yieldsOf(row).ore).toBe(expected.yieldMult.ore);
    // And it MOVED — the merge carried a value the pre-tick columns did not hold.
    expect(effOf(row).ore).not.toBe(effOf(before).ore);
    expect(yieldsOf(row).ore).not.toBe(yieldsOf(before).ore);
  });

  it("a decay shed moves the merged world's columns downward the same way", async () => {
    const base = generateWorld({ systemCount: 60, seed: 7 });
    const faction = autonomousFaction(base);
    const systemId = faction.homeworldId;
    // Unrest at the ceiling with the collapse debt already nearly whole: the catastrophic decay
    // channel sheds exactly one level this cycle. Construction funding is zeroed galaxy-wide so
    // nothing can land a level back on the same tick and mask the direction.
    const crafted = craftWorld(base, systemId, { [ORE]: 2, [HOUSING_TYPE]: 40 }, {
      unrest: 1, collapseDebt: 0.99,
    });
    const world: World = {
      ...crafted,
      constructionProjects: [],
      treasuries: crafted.treasuries.map((t) => ({
        ...t,
        bands: { ...t.bands, construction: 0 },
        funded: { ...t.funded, construction: 0 },
      })),
    };

    const before = systemRow(world, systemId);
    const { world: after } = await runWorldTick(world, { cadence: EVERY_TICK });

    const remaining = oreCount(after, systemId);
    expect(remaining).toBe(1); // premise: exactly one extractor level was shed
    const expected = workedYieldVectors(craftedSlots(systemId), { [ORE]: remaining });
    const row = systemRow(after, systemId);
    expect(effOf(row).ore).toBe(expected.eff.ore);
    expect(yieldsOf(row).ore).toBe(expected.yieldMult.ore);
    expect(effOf(row).ore).not.toBe(effOf(before).ore);
    // Shedding drops the WORST ground first, so the surviving prefix reads richer, never poorer.
    expect(yieldsOf(row).ore).toBeGreaterThan(yieldsOf(before).ore);
  });

  it("a housing-only build changes neither column — even where the stored columns disagree with the fold", async () => {
    // The columns are stamped to a value the fold would NOT produce (the pooled reading a
    // pre-change save carries). Only an extractor count change may recompute them; a housing build
    // must leave even a disagreeing column exactly as it found it, or the trigger is "any build"
    // rather than "a tier-0 count moved".
    const base = generateWorld({ systemCount: 60, seed: 7 });
    const faction = autonomousFaction(base);
    const systemId = faction.homeworldId;
    const stale = makeResourceVector({
      gas: 0.31, minerals: 0.32, ore: 0.33, biomass: 0.34, arable: 0.35, water: 0.36, radioactive: 0.37,
    });
    const crafted = craftWorld(base, systemId, { [ORE]: 1, [HOUSING_TYPE]: 40 }, {
      ...yieldColumns(stale), ...effColumns(stale),
    });
    const project: WorldBuildProject = {
      id: "test-housing-build", kind: "build", factionId: faction.id, systemId, origin: "player",
      workTotal: 0.000_1, workDone: 0, buildingType: HOUSING_TYPE, levels: 1,
    };
    const world: World = { ...crafted, constructionProjects: [...crafted.constructionProjects, project] };

    const before = systemRow(world, systemId);
    const { world: after } = await runWorldTick(world, { cadence: EVERY_TICK });

    const row = systemRow(after, systemId);
    const housingAfter =
      after.buildings.find((b) => b.systemId === systemId && b.buildingType === HOUSING_TYPE)?.count ?? 0;
    expect(housingAfter).toBeGreaterThan(40); // premise: the housing level landed
    expect(oreCount(after, systemId)).toBe(oreCount(world, systemId)); // and no extractor moved
    expect(effOf(row)).toEqual(effOf(before));
    expect(yieldsOf(row)).toEqual(yieldsOf(before));
    expect(yieldsOf(row)).toEqual(stale); // the stamped disagreement survived untouched
  });

  it("an abandonment wipe folds the MERGED world's columns to the n=0 best-slot reading — the same reading the load hook would independently compute", async () => {
    // Same death-march technique tick.test.ts's own abandonment fixture uses (total famine, no
    // rescue path, unrest driven to the ceiling) — driven here on the two-body rich/poor fixture so
    // the post-abandonment fold is exact-checkable, not just "moved".
    const base = generateWorld({ systemCount: 60, seed: 7 });
    const faction = autonomousFaction(base);
    const systemId = faction.homeworldId;
    const crafted = craftWorld(base, systemId, { [ORE]: 2, [HOUSING_TYPE]: 40 }, {
      unrest: 0.9, population: 1.02, popCap: 20,
    });
    let world: World = {
      ...crafted,
      constructionProjects: [],
      // Cut every rescue path so decline runs uncontested: no logistics haul in or out, and the
      // system's own market emptied so the famine gate is total.
      connections: crafted.connections.filter((c) => c.fromId !== systemId && c.toId !== systemId),
      markets: crafted.markets.map((m) => (m.systemId === systemId ? { ...m, stock: 0 } : m)),
    };

    const KILL_CADENCE: TickCadence = { cycle: 1, logistics: 1, construction: NEVER };
    let abandoned = false;
    for (let i = 0; i < 3000 && !abandoned; i++) {
      world = (await runWorldTick(world, { cadence: KILL_CADENCE })).world;
      abandoned = systemRow(world, systemId).control !== "developed";
    }
    expect(abandoned).toBe(true); // non-vacuous: the fixture actually reaches the death line
    expect(oreCount(world, systemId)).toBe(0); // premise: the wipe really did clear the extractor

    const row = systemRow(world, systemId);
    // n = 0 on every resource: the wipe cleared `buildings` to `{}`.
    const expected = workedYieldVectors(craftedSlots(systemId), {});
    expect(effOf(row).ore).toBe(expected.eff.ore);
    expect(yieldsOf(row).ore).toBe(expected.yieldMult.ore);

    // And it agrees with the load hook's independent computation over the same (post-abandonment)
    // world — the tick's refold and the load hook are two call sites of the same fold, and must
    // never disagree on a wiped system.
    const rebuilt = rebuildWorkedYieldColumns(world);
    const rebuiltRow = systemRow(rebuilt, systemId);
    expect(effOf(row).ore).toBe(effOf(rebuiltRow).ore);
    expect(yieldsOf(row).ore).toBe(yieldsOf(rebuiltRow).ore);
  }, 30_000);

  it("a tick with no tier-0 count change leaves EVERY system's yield/eff columns byte-identical", async () => {
    const base = generateWorld({ systemCount: 60, seed: 7 });
    const { world: after } = await runWorldTick(base);

    // Premise: nothing built or shed on this tick, so any column movement would be pure churn.
    expect(after.buildings).toEqual(base.buildings);
    for (const before of base.systems) {
      const row = systemRow(after, before.id);
      expect(yieldsOf(row)).toEqual(yieldsOf(before));
      expect(effOf(row)).toEqual(effOf(before));
    }
  });

  it("refolding leaves a system outside the candidate set referentially identical, and a candidate whose fold is unchanged too", () => {
    const base = generateWorld({ systemCount: 60, seed: 7 });
    const faction = autonomousFaction(base);
    const systemId = faction.homeworldId;
    const world = craftWorld(base, systemId, { [ORE]: 2, [HOUSING_TYPE]: 40 });
    const rows = toTickSystems(world);
    const bodies = slottedBodiesBySystem(world.bodies);

    const refolded = refoldWorkedYields(rows, new Set([systemId]), bodies);
    for (const [i, row] of rows.entries()) {
      // The candidate's own fold matches the columns it already carries (craftWorld stamped them),
      // so even IT keeps its identity — the refold writes only where a value actually moved. This
      // covers every system, in or out of the one-element candidate set — a system outside it never
      // reaches the fold at all (see `refoldWorkedYields`'s own candidate-set guard), so its identity
      // is `.map`'s pass-through, not a coincidence.
      expect(refolded[i]).toBe(row);
    }
    // The merge-level claim (no churn reaches the merged world on a no-op tick) has its own test
    // above ("a tick with no tier-0 count change leaves EVERY system's yield/eff columns
    // byte-identical") — this test stays scoped to `refoldWorkedYields` itself.
  });

  it("a candidate with no entry in the bodies map keeps its identity — the body-less guard, distinct from a system outside the candidate set", () => {
    const base = generateWorld({ systemCount: 60, seed: 7 });
    const faction = autonomousFaction(base);
    const systemId = faction.homeworldId;
    const world = craftWorld(base, systemId, { [ORE]: 2, [HOUSING_TYPE]: 40 });
    const rows = toTickSystems(world);
    // An empty bodies map: `systemId` IS in the candidate set below, but has no entry here — the
    // guard this test targets (`bodies === undefined`) is a different code path from the
    // candidate-set membership check the sibling test above exercises.
    const emptyBodies = new Map<string, SlottedBody[]>();

    const refolded = refoldWorkedYields(rows, new Set([systemId]), emptyBodies);
    const target = rows.find((r) => r.id === systemId);
    const targetIndex = rows.findIndex((r) => r.id === systemId);
    expect(target).toBeDefined();
    expect(refolded[targetIndex]).toBe(target);
  });
});
