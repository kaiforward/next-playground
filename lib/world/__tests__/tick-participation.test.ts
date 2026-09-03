import { describe, it, expect } from "vitest";
import { generateWorld } from "../gen";
import { runWorldTick } from "../tick";
import type { World } from "../types";
import type { TickCadence } from "@/lib/constants/tick-cadence";

/**
 * Who takes part in a cycle-start resolution, and what a tick does with a row it cannot route.
 *
 * The participation set (developed systems only) is built once and shared by migration and
 * directed-logistics. Widening it does not crash anything — it quietly lets people diffuse into a
 * system nobody lives on yet — so it needs an assertion about who was EXCLUDED, not just that the
 * tick produced numbers.
 */

const NEVER = 1_000_000;
const CYCLE_ONLY: TickCadence = { cycle: 1, construction: NEVER, logistics: NEVER };
const NOTHING_RESOLVES: TickCadence = { cycle: NEVER, construction: NEVER, logistics: NEVER };

/**
 * One faction holding two connected developed systems (one nearly full, one nearly empty) plus a
 * connected CONTROLLED system with nobody on it — the system a widened participation set would let
 * people diffuse into.
 */
function migrationFixture(options: { sameFaction: boolean }) {
  const base = generateWorld({ systemCount: 60, seed: 7 });
  const factionId = base.factions[0].id;
  const crowded = base.systems.find((s) => s.factionId === factionId && s.control === "developed");
  // factionId !== null is load-bearing: a null-owned "developed" system is a real state
  // elsewhere in the codebase (see tick-treasury-latch.test.ts's patched rock) — without this
  // guard, `roomy` could land on an unowned developed system and this fixture would end up
  // testing unowned-target exclusion instead of the cross-faction border it's named for.
  const roomy = base.systems.find(
    (s) => s.control === "developed" && s.factionId !== null && s.factionId !== factionId,
  );
  const borderland = base.systems.find((s) => s.control === "unclaimed");
  if (!crowded || !roomy || !borderland) throw new Error("fixture premise: the generated galaxy lacks the three system kinds");

  const world: World = {
    ...base,
    meta: { ...base.meta, currentTick: 0 },
    systems: base.systems.map((s) => {
      if (s.id === crowded.id) return { ...s, population: s.popCap * 0.99 };
      if (s.id === roomy.id) {
        return options.sameFaction ? { ...s, factionId, population: 10 } : { ...s, population: 10 };
      }
      if (s.id === borderland.id) return { ...s, factionId, control: "controlled" as const, population: 0 };
      return s;
    }),
    connections: [
      ...base.connections,
      { fromId: crowded.id, toId: roomy.id, fuelCost: 1 },
      { fromId: roomy.id, toId: crowded.id, fuelCost: 1 },
      { fromId: crowded.id, toId: borderland.id, fuelCost: 1 },
      { fromId: borderland.id, toId: crowded.id, fuelCost: 1 },
    ],
  };
  return { world, crowdedId: crowded.id, roomyId: roomy.id, borderlandId: borderland.id };
}

/**
 * Premise for the galaxy-wide zero-diffusion assertion in the border test below: it only
 * proves border exclusion if no OTHER same-faction developed<->developed edge with a
 * population gradient exists anywhere in the generated galaxy — otherwise a galaxy-wide zero
 * could mask a broken border alongside an offsetting confound, or a nonzero total could come
 * from a source unrelated to the border pair under test. True today because generation gives
 * each faction exactly one developed system (its homeworld), so no natural same-faction
 * developed pair can exist; asserted explicitly so a worldgen change that adds a second
 * per-faction developed system fails loudly on this premise instead of as a mystery diffusion
 * regression.
 */
function assertNoConfoundingSameFactionGradient(world: World) {
  const byId = new Map(world.systems.map((s) => [s.id, s]));
  for (const c of world.connections) {
    const a = byId.get(c.fromId);
    const b = byId.get(c.toId);
    if (!a || !b) continue;
    if (a.control !== "developed" || b.control !== "developed") continue;
    if (!a.factionId || a.factionId !== b.factionId) continue;
    if (Math.abs(a.population - b.population) < 1e-6) continue;
    throw new Error(
      `fixture premise: a same-faction developed pair (${a.id} pop ${a.population} vs ` +
        `${b.id} pop ${b.population}) has a population gradient outside the engineered border ` +
        `pair — the galaxy-wide diffusion===0 assertion no longer isolates border exclusion`,
    );
  }
}

describe("runWorldTick — the cycle's participation set", () => {
  it("diffuses population along a same-faction developed edge", async () => {
    const { world } = migrationFixture({ sameFaction: true });
    const result = await runWorldTick(world, { cadence: CYCLE_ONLY });
    expect(result.instrumentation.migrationMoved?.diffusion ?? 0).toBeGreaterThan(0);
  });

  it("diffuses nobody across a faction border, however steep the gradient across it", async () => {
    // The identical pair of systems as the test above — a crowded one linked to a near-empty one —
    // differing only in who owns the far end. Migration rides FACTION-BOUNDED open edges: people move
    // within a realm, never across a border, no matter how much room is on the other side.
    const { world } = migrationFixture({ sameFaction: false });
    assertNoConfoundingSameFactionGradient(world);
    const result = await runWorldTick(world, { cadence: CYCLE_ONLY });
    expect(result.instrumentation.migrationMoved?.diffusion ?? 0).toBe(0);
  });

  it("moves nobody into a CONTROLLED system, however connected and empty it is", async () => {
    // A controlled system is a border claim, not a place anyone lives: nothing produces or is
    // consumed there and it holds no market rows. People diffusing in would be living on nothing.
    const { world, borderlandId } = migrationFixture({ sameFaction: true });
    const result = await runWorldTick(world, { cadence: CYCLE_ONLY });
    const borderland = result.world.systems.find((s) => s.id === borderlandId);
    expect(borderland?.control).toBe("controlled"); // premise: still not developed
    expect(borderland?.population).toBe(0);
  });
});

describe("runWorldTick — rows the tick cannot route or persist", () => {
  it("drops a building row that has decayed to zero levels rather than persisting it", async () => {
    // `World.buildings` is one row per (system, buildingType) that EXISTS. A zero-level row that
    // survived would give the system a phantom building for every later roster read.
    const base = generateWorld({ systemCount: 40, seed: 7 });
    const emptied = base.buildings[0];
    const world: World = {
      ...base,
      meta: { ...base.meta, currentTick: 0 },
      buildings: base.buildings.map((b) => (b === emptied ? { ...b, count: 0 } : b)),
    };

    const after = (await runWorldTick(world, { cadence: NOTHING_RESOLVES })).world;

    expect(
      after.buildings.some(
        (b) => b.systemId === emptied.systemId && b.buildingType === emptied.buildingType,
      ),
    ).toBe(false);
    // Premise guard: the rest of that system's roster is untouched, so the drop is the zero and not
    // the whole system falling out.
    expect(after.buildings.some((b) => b.systemId === emptied.systemId)).toBe(true);
    for (const b of after.buildings) expect(b.count).toBeGreaterThan(0);
  });

  it("survives a developed system with no connections at all", async () => {
    // The hop map is built from the connection list, so an unconnected system has no entry in it —
    // and it is still a full participant in the cycle. Every lookup into that map has to tolerate the
    // miss rather than assume every system is in there.
    const base = generateWorld({ systemCount: 60, seed: 7 });
    const marooned = base.systems.find((s) => s.control === "developed");
    if (!marooned) throw new Error("fixture premise: no developed system");
    const world: World = {
      ...base,
      meta: { ...base.meta, currentTick: 0 },
      connections: base.connections.filter(
        (c) => c.fromId !== marooned.id && c.toId !== marooned.id,
      ),
    };
    expect(world.connections.length).toBeLessThan(base.connections.length); // premise: it was connected

    const after = (await runWorldTick(world, { cadence: CYCLE_ONLY })).world;

    expect(after.systems.find((s) => s.id === marooned.id)?.control).toBe("developed");
    for (const s of after.systems) expect(Number.isFinite(s.population)).toBe(true);
    for (const m of after.markets) expect(Number.isFinite(m.stock)).toBe(true);
  });
});
