import { describe, it, expect, afterEach } from "vitest";
import { generateWorld } from "@/lib/world/gen";
import { runWorldTick } from "@/lib/world/tick";
import { setWorld, clearWorld } from "@/lib/world/store";
import { getAlertData } from "@/lib/services/alerts";
import type { World } from "@/lib/world/types";

/**
 * The one seam nothing else covers: every boundary from engine to processor to adapter to
 * `WorldSystem` to read service is pinned in isolation, but nothing else drives a real `runWorldTick`
 * cycle and then reads `getAlertData()` — so a composition-only wiring defect (e.g. the
 * adapter→`WorldSystem` merge silently dropping a field) would pass every existing test.
 *
 * Build opportunity is the category exercised in full — named system, named figure.
 * `populationChange`, `populationTrend` and `stockChange` — the persisted signals Population
 * collapse and Survival stock falling rest on — get the weaker but still load-bearing check the
 * same run can afford: that a real tick chain leaves them on world state at all. `WorldSystem.buildOpportunity` is written
 * by the real directed-build processor's planner every cycle it runs — UNCONDITIONALLY, independent
 * of `automation.build` (lib/tick/processors/directed-build.ts:481-490: "the assessment above runs
 * unconditionally... every system in `group` is visited whether or not build automation is on") — so
 * a freshly generated world with a player seat reliably produces one within a couple of construction
 * cycles, with no hand-authored fixture forcing the state. `getAlertData()`'s own gate on
 * `automation.build` is a READ-time gate only, so it is flipped directly on the world after
 * the real tick chain has already written the figure, rather than run through another cycle.
 *
 * `systemCount: 100, seed: 42` with a player seat is deterministic — reconfirmed against a second,
 * independent generation+tick run of the same parameters before this test was written: after 48
 * ticks (two `CYCLE_LENGTH` cycles) the player's homeworld — the only system it has developed this
 * early — always carries `{ score: 896.2535334655045, goodId: "water" }`.
 */
describe("getAlertData reads state a real runWorldTick chain actually produced", () => {
  afterEach(() => {
    clearWorld();
  });

  it("names the system and figure Build opportunity's real tick chain wrote to WorldSystem.buildOpportunity", async () => {
    let world: World = generateWorld({
      systemCount: 100,
      seed: 42,
      playerFaction: { name: "Integration Seat", governmentType: "federation", doctrine: "mercantile" },
    });
    const pid = world.player!.controlledFactionId;
    const homeId = world.factions.find((f) => f.id === pid)!.homeworldId;

    for (let i = 0; i < 48; i++) {
      world = (await runWorldTick(world)).world;
    }

    const homeSystem = world.systems.find((s) => s.id === homeId)!;
    // This IS the seam under test: WorldSystem.buildOpportunity only carries a reading if the
    // adapter→WorldSystem merge (lib/world/tick.ts's mergeSystemsIntoWorld) actually copied it over
    // from the tick-computed system. A wiring defect there — the planner still scores the
    // opportunity internally, but the merge drops it — fails exactly here.
    expect(homeSystem.buildOpportunity).toBeDefined();
    const { score, goodId } = homeSystem.buildOpportunity!;

    // Build opportunity self-gates on automation at READ time only — flipping it here does not
    // re-run the tick, it only changes what getAlertData() reports.
    world = {
      ...world,
      player: { ...world.player!, automation: { ...world.player!.automation, build: false } },
    };
    setWorld(world);

    const developedCount = world.systems.filter(
      (s) => s.factionId === pid && s.control === "developed",
    ).length;

    const category = getAlertData().categories.find((c) => c.id === "build_opportunity");
    if (!category) throw new Error("build_opportunity missing from getAlertData()");

    if (category.unit !== "developed_systems") {
      throw new Error("build_opportunity counts systems, so it must carry the developed-systems denominator");
    }
    expect(category.denominator).toBe(developedCount);
    expect(category.count).toBe(1);
    expect(category.instances).toHaveLength(1);
    expect(category.instances[0].systemId).toBe(homeId);
    // The row's measure names the REAL persisted figure, not a re-derivation — this is what proves
    // the read service is showing what THIS run's tick chain actually left in WorldSystem, rather
    // than merely returning a well-formed shape.
    expect(category.instances[0].measure).toContain(goodId);
    expect(category.instances[0].measure).toContain(score.toFixed(2));
  }, 30_000);

  it("leaves populationChange, populationTrend on a developed player system and stockChange on a market row — the signals behind Population collapse and Survival stock falling", async () => {
    // Population collapse's gate (`populationTrend`) and countdown (`populationChange`), Survival
    // stock falling's whole condition, and the two categories that depend on them read
    // `WorldSystem.populationChange`/`populationTrend` and `WorldMarket.stockChange`. All are written
    // every economy cycle for every visited system, so a processor that stopped writing any one of
    // them would leave its categories permanently silent in the shipped game — a failure no
    // fixture-fed service test can see, because the fixture supplies the field itself. This asserts
    // only that a REAL tick chain leaves them there; what the categories do with them is pinned in
    // alerts.test.ts.
    let world: World = generateWorld({
      systemCount: 100,
      seed: 42,
      playerFaction: { name: "Integration Seat", governmentType: "federation", doctrine: "mercantile" },
    });
    const pid = world.player!.controlledFactionId;

    for (let i = 0; i < 48; i++) {
      world = (await runWorldTick(world)).world;
    }

    const developed = world.systems.filter((s) => s.factionId === pid && s.control === "developed");
    expect(developed.length).toBeGreaterThan(0); // premise: there is a player empire to assess

    const assessed = developed.filter((s) => s.populationChange !== undefined);
    expect(assessed.map((s) => s.id).length).toBeGreaterThan(0);
    for (const s of assessed) expect(Number.isFinite(s.populationChange)).toBe(true);

    const trendAssessed = developed.filter((s) => s.populationTrend !== undefined);
    expect(trendAssessed.map((s) => s.id).length).toBeGreaterThan(0);
    for (const s of trendAssessed) expect(Number.isFinite(s.populationTrend)).toBe(true);

    const developedIds = new Set(developed.map((s) => s.id));
    const withStockChange = world.markets.filter(
      (m) => developedIds.has(m.systemId) && m.stockChange !== undefined,
    );
    expect(withStockChange.map((m) => `${m.systemId}|${m.goodId}`).length).toBeGreaterThan(0);
    for (const m of withStockChange) expect(Number.isFinite(m.stockChange)).toBe(true);
  }, 30_000);

  it("populationTrend's sign agrees with the direction a system's population actually moved across the run", async () => {
    // Crosses the exact seam a sign-inverted write (or a sign-inverted read) would break and a
    // fixture-fed unit test cannot see, because a fixture supplies both sides of the comparison
    // itself. This does NOT pin exact sign agreement for every system on every run — an EMA lags a
    // direction reversal, and a colony-founding donor's exclusion can genuinely diverge the trend
    // from the system's own raw net change for the cycle it founds. It also does not exercise the
    // decline side: at 48 ticks (first colony completes ~tick 4,128 at default scale —
    // docs/active/gameplay/colonisation.md) every faction's homeworld is still in its calm early
    // growth phase, so this fixture never produces a genuinely shrinking developed system to check
    // the other sign against. What it DOES pin, robustly, per the brief's own fallback: a system
    // whose population demonstrably GREW across the window does not carry a negative trend — the
    // exact case a naively-inverted comparison (this file's own regression) gets backwards.
    //
    // Every faction's homeworld, not just the player's — scoping to the player alone would leave
    // exactly one developed system this early, a much weaker non-vacuity guarantee.
    let world: World = generateWorld({
      systemCount: 100,
      seed: 42,
      playerFaction: { name: "Integration Seat", governmentType: "federation", doctrine: "mercantile" },
    });
    const startPopulationById = new Map(world.systems.map((s) => [s.id, s.population]));

    for (let i = 0; i < 48; i++) {
      world = (await runWorldTick(world)).world;
    }

    const assessed = world.systems.filter(
      (s) => s.control === "developed" && s.populationTrend !== undefined,
    );
    expect(assessed.length).toBeGreaterThan(0); // premise: something was actually assessed this run

    let grew = 0;
    for (const s of assessed) {
      const startPopulation = startPopulationById.get(s.id);
      if (startPopulation === undefined) continue; // a system that didn't exist as this shape at start
      const netChange = s.population - startPopulation;
      const trend = s.populationTrend;
      if (trend === undefined) continue; // narrowed by the filter above; guards the type only
      if (netChange > 0) {
        grew++;
        expect(trend, `system ${s.id} grew (${startPopulation} -> ${s.population}) but trend was ${trend}`)
          .toBeGreaterThanOrEqual(0);
      }
    }
    // Non-vacuous: real growth actually happened across this fixture, not zero systems agreeing on
    // an empty set.
    expect(grew).toBeGreaterThan(0);
  }, 30_000);
});
