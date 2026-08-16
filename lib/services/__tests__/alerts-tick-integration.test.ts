import { describe, it, expect, afterEach } from "vitest";
import { generateWorld } from "@/lib/world/gen";
import { runWorldTick } from "@/lib/world/tick";
import { setWorld, clearWorld } from "@/lib/world/store";
import { getAlertData } from "@/lib/services/alerts";
import type { World } from "@/lib/world/types";

/**
 * The one seam nothing else covers (docs/build-plans/alert-bar.md Task 10's first Proves entry,
 * booked at review of Tasks 9/16/17): every boundary from engine to processor to adapter to
 * `WorldSystem` to read service is pinned in isolation, but nothing drives a real `runWorldTick`
 * cycle and then reads `getAlertData()` — so a composition-only wiring defect (e.g. the
 * adapter→`WorldSystem` merge silently dropping a field) would pass every existing test.
 *
 * Build opportunity is the category exercised. `WorldSystem.buildOpportunity` (Task 17) is written
 * by the real directed-build processor's planner every cycle it runs — UNCONDITIONALLY, independent
 * of `automation.build` (lib/tick/processors/directed-build.ts:481-490: "the assessment above runs
 * unconditionally... every system in `group` is visited whether or not build automation is on") — so
 * a freshly generated world with a player seat reliably produces one within a couple of construction
 * cycles, with no hand-authored fixture forcing the state. `getAlertData()`'s own gate on
 * `automation.build` (Task 9) is a READ-time gate only, so it is flipped directly on the world after
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

    // Build opportunity self-gates on automation at READ time only (alert-bar.md:113,:415-418) —
    // flipping it here does not re-run the tick, it only changes what getAlertData() reports.
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
});
