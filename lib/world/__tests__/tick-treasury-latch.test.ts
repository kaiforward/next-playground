import { describe, it, expect } from "vitest";
import { generateWorld } from "../gen";
import { runWorldTick } from "../tick";
import type { World, WorldSystem } from "../types";
import type { TickCadence } from "@/lib/constants/tick-cadence";

/**
 * The treasury's two contact surfaces with the rest of a tick.
 *
 * Reading OUT: last settlement's funding latch is read at tick start and turned into per-system
 * maintenance and tax-pressure effects the economy, decay and population stages consume. If the latch
 * silently fails to be built, every faction runs as if fully funded — a galaxy that looks healthy
 * because insolvency stopped costing anything.
 *
 * Writing IN: settlement bills and taxes only the systems a faction actually holds and runs. A
 * settlement that swept in border claims or unowned rocks would pay every faction for territory
 * nobody lives on.
 */

const NEVER = 1_000_000;
const CYCLE_ONLY: TickCadence = { cycle: 1, construction: NEVER, logistics: NEVER };

const balanceSheet = (world: World): string =>
  world.treasuries.map((t) => `${t.factionId}:${t.balance.toFixed(8)}`).join("|");

/**
 * Take an unclaimed rock, give it a real developed system's population and industry, and apply
 * `patch` to its ownership/control. Both bills a settlement can raise — head tax on staffed labour
 * and maintenance on standing build work — are building-derived, so the roster is what makes this
 * system worth money to whoever counts it.
 */
function withPatchedRock(base: World, patch: Partial<WorldSystem>): World {
  const rock = base.systems.find((s) => s.control === "unclaimed");
  const donor = base.systems.find((s) => s.control === "developed");
  if (!rock || !donor) throw new Error("fixture premise: the generated galaxy lacks an unclaimed rock or a developed donor");
  return {
    ...base,
    meta: { ...base.meta, currentTick: 0 },
    systems: base.systems.map((s) => (s.id === rock.id ? { ...s, ...patch } : s)),
    buildings: [
      ...base.buildings,
      ...base.buildings.filter((b) => b.systemId === donor.id).map((b) => ({ ...b, systemId: rock.id })),
    ],
  };
}

describe("runWorldTick — what a treasury settlement is allowed to count", () => {
  const base = generateWorld({ systemCount: 60, seed: 7 });
  const factionId = base.factions[0].id;

  it("bills and taxes nothing for a populated CONTROLLED claim", async () => {
    // A controlled system is owned but not running: no market, no production, nobody employed. Head
    // tax on it would pay a faction for a flag on a rock.
    const untouched = await runWorldTick({ ...base, meta: { ...base.meta, currentTick: 0 } }, { cadence: CYCLE_ONLY });
    const withClaim = await runWorldTick(
      withPatchedRock(base, { factionId, control: "controlled", population: 1000 }),
      { cadence: CYCLE_ONLY },
    );
    expect(withClaim.events.processors).toContain("treasury"); // premise: a settlement actually ran
    expect(balanceSheet(withClaim.world)).toBe(balanceSheet(untouched.world));
  });

  it("bills and taxes nothing for a populated system no faction owns", async () => {
    const untouched = await runWorldTick({ ...base, meta: { ...base.meta, currentTick: 0 } }, { cadence: CYCLE_ONLY });
    const withOrphan = await runWorldTick(
      withPatchedRock(base, { factionId: null, control: "developed", population: 1000 }),
      { cadence: CYCLE_ONLY },
    );
    expect(balanceSheet(withOrphan.world)).toBe(balanceSheet(untouched.world));
  });
});

describe("runWorldTick — the funding latch read at tick start", () => {
  const base = generateWorld({ systemCount: 60, seed: 7 });
  const faction = base.factions[0];

  function withMaintenanceFunding(maintenance: number): World {
    return {
      ...base,
      meta: { ...base.meta, currentTick: 0 },
      treasuries: base.treasuries.map((t) =>
        t.factionId === faction.id ? { ...t, funded: { ...t.funded, maintenance } } : t,
      ),
    };
  }

  it("costs an unfunded faction real output on the cycle its economy resolves", async () => {
    // The latch is built only when a consuming stage resolves this tick. Fail to build it and the
    // maintenance malus never reaches the economy: an insolvent faction produces exactly as much as a
    // solvent one, and the whole maintenance band stops mattering.
    const held = base.systems.find((s) => s.factionId === faction.id && s.control === "developed");
    if (!held) throw new Error("fixture premise: the faction holds no developed system");
    const stockAt = (world: World) =>
      world.markets.filter((m) => m.systemId === held.id).reduce((n, m) => n + m.stock, 0);

    const funded = (await runWorldTick(withMaintenanceFunding(1), { cadence: CYCLE_ONLY })).world;
    const starved = (await runWorldTick(withMaintenanceFunding(0), { cadence: CYCLE_ONLY })).world;

    expect(stockAt(starved)).toBeLessThan(stockAt(funded));
  });

  it("runs a cycle for a faction that has no treasury row at all", async () => {
    // Latch lookups are per-faction and can miss. A miss must leave that faction's systems on the
    // default effects, not push `undefined` into the malus and unrest maths.
    const orphaned: World = {
      ...base,
      meta: { ...base.meta, currentTick: 0 },
      treasuries: base.treasuries.filter((t) => t.factionId !== faction.id),
    };
    expect(orphaned.systems.some((s) => s.factionId === faction.id)).toBe(true); // premise: it still holds systems

    const after = (await runWorldTick(orphaned, { cadence: CYCLE_ONLY })).world;

    for (const s of after.systems) {
      expect(Number.isFinite(s.unrest)).toBe(true);
      expect(Number.isFinite(s.population)).toBe(true);
      expect(Number.isFinite(s.collapseDebt ?? 0)).toBe(true);
    }
    for (const m of after.markets) expect(Number.isFinite(m.stock)).toBe(true);
    expect(after.treasuries.some((t) => t.factionId === faction.id)).toBe(false);
  });
});
