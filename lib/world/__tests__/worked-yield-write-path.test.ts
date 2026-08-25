/**
 * The tick's worked-deposit write path: a tier-0 extractor count change (a landed build, a decay
 * shed) refolds the affected system's worked-prefix yield/eff vectors, and those vectors survive
 * the tick→world merge onto the `yield*`/`eff*` columns.
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
import { runWorldTick, toTickSystems, refoldWorkedYields, slottedBodiesBySystem } from "../tick";
import { workedYieldVectors, type SlottedBody } from "@/lib/engine/worked-deposits";
import {
  countColumns, depositCountsOf, effColumns, effOf, makeResourceVector, qualColumns, qualityOf,
  yieldColumns, yieldsOf,
} from "@/lib/engine/resources";
import { HOUSING_TYPE } from "@/lib/constants/industry";
import { BODY_ARCHETYPES } from "@/lib/constants/bodies";
import type { TickCadence } from "@/lib/constants/tick-cadence";
import type { World, WorldBody, WorldBuildProject, WorldSystem } from "../types";

/** Every stage resolves on every tick, so one `runWorldTick` call is one full cycle. */
const EVERY_TICK: TickCadence = { cycle: 1, construction: 1, logistics: 1 };

const ORE = "ore";
/** extractionModifier 1.0 — the rich body's class. */
const RICH_TYPE = "temperate_world";
/** extractionModifier 0.6 — the poor body's class. */
const POOR_TYPE = "frozen_world";

function craftedBodies(systemId: string): WorldBody[] {
  return [
    {
      id: `${systemId}-rich`, systemId, bodyType: RICH_TYPE, size: 1, peopleLand: 5_000,
      ...countColumns(makeResourceVector({ ore: 1 })),
      ...qualColumns(makeResourceVector({ ore: 2 })),
    },
    {
      id: `${systemId}-poor`, systemId, bodyType: POOR_TYPE, size: 1, peopleLand: 0,
      ...countColumns(makeResourceVector({ ore: 9 })),
      ...qualColumns(makeResourceVector({ ore: 0.5 })),
    },
  ];
}

function craftedSlots(systemId: string): SlottedBody[] {
  return craftedBodies(systemId).map((b) => ({
    bodyType: b.bodyType, counts: depositCountsOf(b), quality: qualityOf(b),
  }));
}

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
      // so even IT keeps its identity — the refold writes only where a value actually moved.
      expect(refolded[i]).toBe(row);
    }

    // A system untouched by the refold reaches the merged world byte-identical. (The merge itself
    // rebuilds every row it has a tick row for — reference equality is not on offer there, only
    // value identity, which is what "no churn" means at the world level.)
    const other = base.systems.find((s) => s.id !== systemId);
    expect(other).toBeDefined();
    if (!other) return;
    expect(yieldsOf(other)).toEqual(yieldsOf(systemRow(world, other.id)));
  });
});
