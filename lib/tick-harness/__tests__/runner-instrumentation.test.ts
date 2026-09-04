import { describe, it, expect } from "vitest";
import { foldFoundingTick, runTickHarness, computeRegionOverview } from "../runner";
import { MARKET_ROLES } from "../types";
import type { HarnessConfig, HarnessResults, MarketRole } from "../types";
import { CONSTRUCTION_INTERVAL, CYCLE_LENGTH } from "@/lib/constants/tick-cadence";
import { SNAPSHOT_INTERVAL } from "../market-analysis";
import { LOGISTICS_WARMUP_TICKS } from "../logistics-analysis";
import { TRADE_SIMULATION } from "@/lib/constants/trade-simulation";
import { generateWorld } from "@/lib/world/gen";
import { toTickSystems } from "@/lib/world/tick";
import type { GovernmentType } from "@/lib/types/game";
import type { FoundedColonyRecord, FoundingStagingTotals } from "../build-analysis";
import { BUSY, firstRunWhere } from "./runner-fixtures";

/** Small and short: this suite is about the role pin's wiring, not about economy behaviour. */
const CONFIG: HarnessConfig = { systemCount: 20, seed: 7, tickCount: 60 };

describe("runTickHarness: the role partition", () => {
  it("reports a role for every market it classified", async () => {
    const results = await runTickHarness(CONFIG);
    const entries = Object.entries(results.marketRoles);

    expect(entries.length).toBeGreaterThan(0);
    for (const [key, role] of entries) {
      expect(key).toContain("|"); // systemId|goodId
      expect(MARKET_ROLES).toContain(role);
    }
  });

  it("is unchanged when pinned to the partition the run itself produced", async () => {
    // Pinning an arm to its own fresh partition has to reproduce the unpinned report exactly,
    // or the pin is itself a change and no A/B run through it means anything.
    const unpinned = await runTickHarness(CONFIG);
    const pinned = await runTickHarness({ ...CONFIG, pinnedRoles: unpinned.marketRoles });

    expect(pinned.roleCoverLevels).toEqual(unpinned.roleCoverLevels);
  });

  it("reports the live partition even when pinned, so a pin cannot be chained into itself", async () => {
    // `marketRoles` is what THIS arm classified, never an echo of the pin — otherwise a second
    // arm pinned to the first would report the first's partition and the drift would be invisible.
    const unpinned = await runTickHarness(CONFIG);
    const allConsumer: Record<string, MarketRole> = {};
    for (const key of Object.keys(unpinned.marketRoles)) allConsumer[key] = "consumer";

    const pinned = await runTickHarness({ ...CONFIG, pinnedRoles: allConsumer });
    expect(pinned.marketRoles).toEqual(unpinned.marketRoles);
  });

  it("actually applies the pin it is given", async () => {
    // Guards the identity test above from passing vacuously: if `pinnedRoles` were dropped on the
    // floor, the identity would hold trivially and prove nothing.
    const unpinned = await runTickHarness(CONFIG);
    const allConsumer: Record<string, MarketRole> = {};
    for (const key of Object.keys(unpinned.marketRoles)) allConsumer[key] = "consumer";

    const pinned = await runTickHarness({ ...CONFIG, pinnedRoles: allConsumer });
    for (const entry of pinned.roleCoverLevels) {
      expect(entry.countByRole.exporter).toBe(0);
      expect(entry.countByRole["self-supplier"]).toBe(0);
      expect(entry.countByRole.inert).toBe(0);
      expect(entry.countByRole.consumer).toBeGreaterThan(0);
    }
    // Non-vacuous: the unpinned run really does classify markets into other roles.
    expect(unpinned.roleCoverLevels.some((e) => e.countByRole.consumer === 0)).toBe(true);
  });
});

// ── The region overview ───────────────────────────────────────────
// Every figure in it is an aggregate over the generated galaxy — a per-region count and the modal
// government across it — so the oracle is the same galaxy rebuilt from world-gen's own determinism
// and folded a DIFFERENT way (rank-then-take-first, against the runner's running-best loop).

describe("runTickHarness: the region overview", () => {
  // Seed 2 (over seed 7's archetype-table galaxy) is where the empty-region, tie-break and
  // tie-break-direction branches below are all live at once — re-derived by search, not carried
  // over from the old substrate model.
  const CONFIG: HarnessConfig = { systemCount: 20, seed: 2, tickCount: 1 };

  /** Government types per region, in the order the runner would encounter them. */
  function govsByRegion(): Map<string, GovernmentType[]> {
    const world = generateWorld({ systemCount: CONFIG.systemCount, seed: CONFIG.seed });
    const byRegion = new Map<string, GovernmentType[]>();
    for (const s of toTickSystems(world)) {
      const list = byRegion.get(s.regionId) ?? [];
      list.push(s.governmentType);
      byRegion.set(s.regionId, list);
    }
    return byRegion;
  }

  it("reports every region's system count and modal government, ties broken alphabetically", async () => {
    const results = await runTickHarness(CONFIG);
    const world = generateWorld({ systemCount: CONFIG.systemCount, seed: CONFIG.seed });
    const byRegion = govsByRegion();

    const expected = world.regions.map((r) => {
      const govs = byRegion.get(r.id) ?? [];
      const counts = new Map<GovernmentType, number>();
      for (const g of govs) counts.set(g, (counts.get(g) ?? 0) + 1);
      // Rank rather than scan: descending by count, then ascending by name. A region with no
      // systems at all has nothing to rank and keeps the "federation" default.
      const ranked = [...counts.entries()].sort(
        (a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0),
      );
      const dominant: GovernmentType = ranked.length > 0 ? ranked[0][0] : "federation";
      return { name: r.name, dominantGovernmentType: dominant, systemCount: govs.length };
    });

    expect(results.regionOverview).toEqual(expected);
  });

  it("exercises the empty region, the tie-break and its direction, on the production folding function directly", () => {
    // `generateWorld` cannot supply this fixture any more: the per-cluster placement guarantee
    // (spec `docs/active/gameplay/universe.md`) means a system count large enough to place the
    // required faction homeworlds is already large enough that every cluster gets a system, so a
    // genuinely empty region no longer occurs at any system count the game can actually generate.
    // `computeRegionOverview` is exported and pure exactly so this branch stays provable — a
    // hand-built input feeds it directly, bypassing `generateWorld` and its viability floor.
    const regions = [
      { id: "r-empty", name: "Empty Reach" }, // no entry below — the empty-region branch
      { id: "r-tie", name: "Tied Ground" }, // technocratic encountered first, cooperative second
      { id: "r-clear", name: "Clear Majority" }, // militarist, no tie
    ];
    const systemsByRegion = new Map<string, GovernmentType[]>([
      ["r-tie", ["technocratic", "cooperative"]],
      ["r-clear", ["militarist", "militarist", "corporate"]],
    ]);

    const overview = computeRegionOverview(regions, systemsByRegion);

    const byName = new Map(overview.map((r) => [r.name, r]));
    expect(byName.get("Empty Reach")).toEqual({
      name: "Empty Reach", dominantGovernmentType: "federation", systemCount: 0,
    });
    // Tie-break direction: "technocratic" was encountered first, but "cooperative" sorts first
    // alphabetically and must win — proves the break is alphabetical, not insertion-order.
    expect(byName.get("Tied Ground")).toEqual({
      name: "Tied Ground", dominantGovernmentType: "cooperative", systemCount: 2,
    });
    expect(byName.get("Clear Majority")).toEqual({
      name: "Clear Majority", dominantGovernmentType: "militarist", systemCount: 3,
    });
  });
});

// ── The whole-run collectors ─────────────────────────────────────
// Every accumulator in the loop starts empty and is appended to on its own cadence. A collector
// seeded with anything at all, or appended to on the wrong tick, moves a reported figure while
// still printing a plausible number — so the cadences are pinned as exact tick lists.

describe("runTickHarness: the periodic snapshots", () => {
  const BASE = { systemCount: 20, seed: 7 } as const;

  it("samples markets, population and treasuries on the snapshot cadence, plus a final capture", async () => {
    // 240 is NOT a multiple of SNAPSHOT_INTERVAL, so the end-of-run capture has work to do and
    // the market series carries one entry the other two do not.
    const tickCount = 240;
    expect(tickCount % SNAPSHOT_INTERVAL).not.toBe(0);
    const results = await runTickHarness({ ...BASE, tickCount });

    const periodic: number[] = [];
    for (let t = SNAPSHOT_INTERVAL; t <= tickCount; t += SNAPSHOT_INTERVAL) periodic.push(t);

    expect(results.marketSnapshots.map((s) => s.tick)).toEqual([...periodic, tickCount]);
    for (const snap of results.marketSnapshots) expect(Array.isArray(snap.markets)).toBe(true);

    expect(results.populationSnapshots.length).toBe(periodic.length);
    for (const snap of results.populationSnapshots) {
      expect(snap).toBeInstanceOf(Map);
      expect(snap.size).toBeGreaterThan(0);
    }

    expect(results.treasurySnapshots.map((s) => s.tick)).toEqual(periodic);
  });

  it("does not re-capture the final tick when it was already a snapshot tick", async () => {
    // The guard is the other half of the capture above: on a run ending exactly on the cadence,
    // appending again would duplicate the last tick and double-count it in every series read.
    const tickCount = SNAPSHOT_INTERVAL * 4;
    const results = await runTickHarness({ ...BASE, tickCount });

    const periodic: number[] = [];
    for (let t = SNAPSHOT_INTERVAL; t <= tickCount; t += SNAPSHOT_INTERVAL) periodic.push(t);
    expect(results.marketSnapshots.map((s) => s.tick)).toEqual(periodic);
  });
});

describe("runTickHarness: the tick-0 readings", () => {
  const CONFIG: HarnessConfig = { systemCount: 20, seed: 7, tickCount: 240 };

  it("totals population and buildings over the world as it stood before the first tick", async () => {
    const results = await runTickHarness(CONFIG);
    const world = generateWorld({ systemCount: CONFIG.systemCount, seed: CONFIG.seed });
    const systems = toTickSystems(world);

    const population = world.systems.reduce((sum, s) => sum + s.population, 0);
    const buildings = systems.reduce(
      (sum, s) => sum + Object.values(s.buildings).reduce((a, c) => a + c, 0),
      0,
    );
    // The runner floors each count at 0 before summing; the oracle above does not, so the two
    // agree only while world-gen emits no negative roster — assert that rather than mirroring
    // the floor and testing nothing.
    for (const s of systems) {
      for (const count of Object.values(s.buildings)) expect(count).toBeGreaterThanOrEqual(0);
    }

    expect(population).toBeGreaterThan(0);
    expect(buildings).toBeGreaterThan(0);
    expect(results.initialPopulationTotal).toBeCloseTo(population, 9);
    expect(results.initialBuildingTotal).toBe(buildings);
  });

  it("gives net growth a real tick-0 denominator, so no cohort reads a flat zero", async () => {
    // A lost start reading does not go null — every cohort's start sum collapses to 0 and the
    // whole column prints 0.0%, which reads as a galaxy that simply did not grow.
    const results = await runTickHarness(CONFIG);

    expect(results.worldCohorts.length).toBeGreaterThan(0);
    for (const cohort of results.worldCohorts) expect(cohort.netGrowthPct).not.toBeNull();
    expect(results.worldCohorts.some((c) => c.netGrowthPct !== 0)).toBe(true);
  });

  it("reports no completed events on this short a run, post-strip", async () => {
    // The only events left are the relations trio (border_conflict, pact_under_negotiation,
    // alliance_dissolved), spawned by the relations processor when a faction pair's score crosses
    // a threshold — typically hundreds of ticks in. CONFIG's 60-tick run never reaches one, so
    // eventImpacts is genuinely empty here; asserting that honestly rather than forcing an event
    // to exist. The name-vs-id fold itself (systemId resolved through the name map, never left as
    // a raw id) is pinned at unit level, where the input can be constructed directly:
    // lib/tick-harness/__tests__/event-analysis.test.ts "computeEventImpacts — names the system an
    // event happened on, rather than falling back to its id".
    const results = await runTickHarness(CONFIG);
    expect(results.eventImpacts).toEqual([]);
  });

  it("checks the money identities against the balances the factions opened on", async () => {
    // The opening balances exist nowhere in the final world — the first settlement overwrites
    // them — so a collector that loses them takes the two chain identities down with it.
    const results = await runTickHarness(CONFIG);
    expect(results.conservation.checks.length).toBeGreaterThan(0);
    expect(results.conservation.allPass).toBe(true);
  });

  it("reports its own wall-clock, measured across the run and nothing else", async () => {
    const before = performance.now();
    const results = await runTickHarness(CONFIG);
    const wall = performance.now() - before;

    expect(results.elapsedMs).toBeGreaterThan(0);
    expect(results.elapsedMs).toBeLessThanOrEqual(wall);
  });
});

// ── The per-tick instrumentation counters ────────────────────────
// `runWorldTick().instrumentation` is transient — nothing in `World` keeps it — so every counter
// below exists only because the loop folded it as the tick produced it. A dropped fold reads 0,
// which is the same number a quiet galaxy reports, and a sign-flipped fold reads negative while
// every other figure in the report stays healthy.

/**
 * One shared BUSY run. `runTickHarness` is deterministic and every test below only reads its result,
 * so re-running it per test would spend ~18s a time to reproduce the same object. This memo is only
 * visible within this file/worker — every test elsewhere that needs a BUSY-shaped run either reads
 * this file's `busyRun` indirectly (it can't — cross-file memoisation does not exist under Vitest's
 * per-file worker model) or pays for its own independent run.
 */
let busyRun: Promise<HarnessResults> | null = null;
function runBusy(): Promise<HarnessResults> {
  busyRun ??= runTickHarness(BUSY);
  return busyRun;
}

describe("runTickHarness: the per-tick instrumentation", () => {
  it("accumulates migration throughput over the cycles that resolved it", async () => {
    const results = await runBusy();
    const m = results.migrationThroughput;

    expect(m.cycleCount).toBeGreaterThan(0);
    expect(m.totalColonists).toBeGreaterThan(0);
    expect(m.totalDiffusion).toBeGreaterThan(0);
    expect(m.meanPerCycle).toBeCloseTo((m.totalColonists + m.totalDiffusion) / m.cycleCount, 9);
  }, 180_000);

  it("reports a zero denominator rather than dividing by it when no cycle ever resolves", async () => {
    // Below CYCLE_LENGTH the migration resolution never runs, so `cycleCount` stays 0. The mean
    // must read 0 — `JSON.stringify` renders NaN as null, which prints as "not measured".
    const results = await runTickHarness({ systemCount: 20, seed: 7, tickCount: CYCLE_LENGTH - 1 });
    expect(results.migrationThroughput).toEqual({
      totalColonists: 0,
      totalDiffusion: 0,
      cycleCount: 0,
      meanPerCycle: 0,
    });
  });

  it("accumulates the directed-build commitments each cycle committed", async () => {
    const results = await runBusy();
    const bursts = results.buildBurstSummary;

    expect(bursts.globalMax).toBeGreaterThan(0);
    expect(bursts.worstGood).not.toBeNull();
    expect(bursts.worstTick).not.toBeNull();
    expect(bursts.byGood.length).toBeGreaterThan(0);
    for (const entry of bursts.byGood) {
      expect(typeof entry.goodId).toBe("string");
      expect(entry.goodId.length).toBeGreaterThan(0);
      expect(Number.isFinite(entry.maxLevelsPerCycle)).toBe(true);
      expect(Number.isFinite(entry.tick)).toBe(true);
    }
  }, 180_000);

  it("resolves strike suppression per eligible pair, both halves accumulated", async () => {
    // A strike only silences a proposal once a colony's unrest crosses STRIKE_THRESHOLD (0.65,
    // lib/constants/population.ts:79). With the industry-land budget deleted this branch, the
    // galaxy never gets there: probe-backed peak unrest is 0.4755 at 10,000 ticks (BUSY's own
    // horizon), falling to 0.324 by 20,000 — an accepted calm regime (Kai, 2026-08-24), not a
    // broken wire, with a roadmap row owning re-arming strikes once adversarial mechanics ship.
    // On the current draw alignment (the events processor rolls on its own RNG stream, so every
    // shared-stream draw downstream re-rolled) no eligible pair reads suppressed on BUSY's
    // horizon: suppression was marginal here, and the re-rolled regime sits under the threshold
    // everywhere. Pinned exactly at 0, as the regime's signature — a drift in either direction is
    // a mechanics change to re-read, not noise. The accounting mechanism this
    // number depends on — a live pair actually incrementing `suppressed` — is proven where it can
    // be constructed directly, not on this dormant galaxy: lib/engine/__tests__/directed-build.test.ts
    // "planFactionProposals: strikeSuppressedProposals — per-eligible-pair suppression count" and
    // lib/tick/processors/__tests__/directed-build.test.ts "runDirectedBuildProcessor —
    // strike-suppression instrumentation (strikeSuppressedProposals)" both plant
    // `productionSuppressed: true` against live capacity and assert `suppressed` counts it.
    const results = await runBusy();
    const s = results.strikeSuppression;

    expect(s.eligible).toBeGreaterThan(0);
    expect(s.suppressed).toBe(0);
    expect(s.suppressed).toBeLessThanOrEqual(s.eligible);
    expect(s.ratePerEligible).toBeCloseTo(s.suppressed / s.eligible, 12);
  }, 120_000);
});

// ── The whole-run flow log and haul-budget ledger ─────────────────

describe("runTickHarness: the whole-run flow log", () => {
  it("takes each tick's flow rows once, as that tick produces them", async () => {
    // The world prunes its own flow log to FLOW_HISTORY_TICKS (200) ticks, which is why the run
    // accumulates its own — the two are only comparable while the run's tickCount hasn't outrun
    // the retention window since the first transfer. Rather than hardcode that tick count (it
    // shifts with the archetype/sun-class tables), search forward in small steps — small enough
    // that the first hit lands well inside the 200-tick retention floor — for the first tickCount
    // with any flow rows at all, then use that same run as ground truth for the accumulator.
    // systemCount 60, not 20: at 20 systems this seed's minor-faction count (18) claims all but 2
    // systems as homeworlds outright, and — under the habitability-seeding archetype tables, where
    // colonisability is a genuine minority rather than ~97.5% of the galaxy — the two leftover
    // systems are exactly the ones homeworld placement passed over for low habitable land, so they
    // land uncolonisable with high (here: total) probability across seeds. No amount of searching
    // forward in ticks recovers a transfer network that structurally has nowhere to grow into.
    const base = { systemCount: 60, seed: 7 } as const;
    const results = await firstRunWhere(
      base,
      (r) => r.finalWorld.flowEvents.length > 0,
      { start: 1000, step: 100, maxTickCount: 20_000 },
    );
    const { tickCount } = results.config;
    const rows = results.finalWorld.flowEvents;

    expect(rows.length).toBeGreaterThan(0);
    // Premise: nothing fell out of the retention window, or the comparison below is not one.
    const earliest = Math.min(...rows.map((r) => r.tick));
    expect(earliest).toBeGreaterThan(tickCount - TRADE_SIMULATION.FLOW_HISTORY_TICKS);

    expect(results.logisticsActivity.transferCount).toBe(rows.length);
    expect(results.logisticsActivity.totalQuantity).toBeCloseTo(
      rows.reduce((sum, r) => sum + r.quantity, 0),
      9,
    );
  }, 600_000); // measured 128s locally alone; on CI the three runner-*.test.ts files run CONCURRENTLY on 4 vCPUs, so contention roughly doubles the serial ~2.1x CI factor — headroom, not a hang allowance

  it("starts the haul-budget ledger at the logistics warm-up tick, not before", async () => {
    // The ledger accumulates budget spend only from LOGISTICS_WARMUP_TICKS onward BY CONSTRUCTION
    // (the runner gates it on `world.meta.currentTick >= LOGISTICS_WARMUP_TICKS`), so a run
    // stopped one tick short of it reads a zero spend fraction regardless of how colonisation
    // paced — as long as transfers are already flowing by then, which the flow-log test above
    // establishes happens far earlier than LOGISTICS_WARMUP_TICKS under the current tables.
    // systemCount 60 — see the flow-log test above for why 20 structurally cannot found a colony
    // on this seed under the habitability-seeding tables.
    const base = { systemCount: 60, seed: 7 } as const;
    const before = await runTickHarness({ ...base, tickCount: LOGISTICS_WARMUP_TICKS - 1 });
    expect(before.logisticsActivity.transferCount).toBeGreaterThan(0);
    expect(before.logisticsActivity.budgetSpentFrac).toBe(0);

    // The ledger opens exactly at LOGISTICS_WARMUP_TICKS but needs at least one more economy
    // cycle to post an actual spend after it opens — search forward in cycle-length steps from
    // the warm-up tick for the first nonzero spend fraction, instead of asserting it at the
    // warm-up tick itself.
    const at = await firstRunWhere(
      base,
      (r) => r.logisticsActivity.budgetSpentFrac > 0,
      { start: LOGISTICS_WARMUP_TICKS, step: CYCLE_LENGTH, maxTickCount: LOGISTICS_WARMUP_TICKS + 20 * CYCLE_LENGTH },
    );

    expect(at.logisticsActivity.budgetSpentFrac).toBeGreaterThan(0);
    // The flag census is a rate over developed-system markets, not a count of them: dropping the
    // predicate flags every market it looks at and pins the rate at 1.
    expect(at.logisticsActivity.fundingBoundFlagSetRate).toBeLessThan(1);
  }, 180_000);
});

describe("runTickHarness: strike-suppression rate", () => {
  it("reports a zero denominator rather than dividing by it when no construction cycle is ever due", async () => {
    // Below CONSTRUCTION_INTERVAL (24): the construction-cycle boundary is never crossed, so
    // directed-build never resolves and strikeSuppressedProposals never reaches the accumulator —
    // eligible stays at 0 for the whole run. The rate must read 0, not NaN.
    const results = await runTickHarness({ systemCount: 20, seed: 7, tickCount: CONSTRUCTION_INTERVAL - 1 });
    expect(results.strikeSuppression).toEqual({ suppressed: 0, eligible: 0, ratePerEligible: 0 });
  });
});

describe("runTickHarness: world cohort net growth", () => {
  it("reports non-null netGrowthPct on every cohort row for a run shorter than one SNAPSHOT_INTERVAL", async () => {
    // CONSTRUCTION_INTERVAL - 1 (23 ticks) is well under SNAPSHOT_INTERVAL (50), so
    // `populationSnapshots` never fires this run — if netGrowthPct's start reading depended on
    // that periodic mechanism, every cohort row would read null here. It doesn't: the start
    // reading is captured at true tick 0, independent of the snapshot cadence.
    const results = await runTickHarness({ systemCount: 20, seed: 7, tickCount: CONSTRUCTION_INTERVAL - 1 });

    expect(results.worldCohorts.length).toBeGreaterThan(0);
    for (const cohort of results.worldCohorts) {
      expect(cohort.netGrowthPct).not.toBeNull();
    }
  });
});

// ── Adaptive-expectation instruments: episode costs, founding trajectory, the ratchet check ──

describe("runTickHarness: episode costs, founding trajectory, the ratchet check", () => {
  it("reports well-formed episode-cost, trajectory and ratchet sections, never NaN or negative", async () => {
    const results = await runBusy();

    expect(Number.isFinite(results.episodeCosts.totalTeardownLevels)).toBe(true);
    expect(results.episodeCosts.totalTeardownLevels).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(results.episodeCosts.totalOvershootDeaths)).toBe(true);
    expect(results.episodeCosts.totalOvershootDeaths).toBeGreaterThanOrEqual(0);
    for (const c of results.episodeCosts.byCohort) {
      expect(c.teardownLevels).toBeGreaterThanOrEqual(0);
      expect(c.overshootDeaths).toBeGreaterThanOrEqual(0);
      expect(c.systemsWithTeardown).toBeLessThanOrEqual(c.n);
      expect(c.systemsWithOvershootDeath).toBeLessThanOrEqual(c.n);
    }

    // All 6 buckets are always present (even empty), spanning the whole 60-cycle window.
    expect(results.foundingTrajectory.buckets.length).toBe(6);
    results.foundingTrajectory.buckets.forEach((b, i) => {
      expect(b.bucket).toBe(i);
      expect(b.n).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(b.meanProvision)).toBe(true);
      expect(Number.isFinite(b.meanUnrest)).toBe(true);
    });

    expect(results.provisionRatchet.window).toBeGreaterThan(0);
    for (const row of results.provisionRatchet.buckets) {
      expect(row.n).toBeGreaterThan(0); // a row is only emitted for a non-empty cell
      expect(Number.isFinite(row.meanVariance)).toBe(true);
      expect(Number.isFinite(row.meanGrievance)).toBe(true);
      expect(row.meanGrievance).toBeGreaterThanOrEqual(0);
      expect(row.meanGrievance).toBeLessThanOrEqual(1);
    }
  }, 180_000);

  it("actually wires activity through — BUSY is not a run where every new section reads zero", async () => {
    // A genuinely broken wire (accumulator never fed, or the summary always empty) and a genuinely
    // quiet galaxy both print zero — this fixture confirms BUSY is not silently vacuous for the
    // sections that DO fire.
    //
    // totalTeardownLevels is deliberately pinned rather than dropped: it is a determinism pin on
    // this fixture's generated galaxy, not a stable magnitude of the game — any mechanic that
    // moves the galaxy's trajectory (routing, upkeep, adjacency, world-gen topology) legitimately
    // moves this number and the pin gets re-read, not treated as a regression. The counter's own
    // wiring — that a torn-down level actually reaches
    // `totalTeardownLevels` — is proven at unit level where it can be forced to fire:
    // lib/tick/processors/__tests__/infrastructure-decay.test.ts "infrastructure-decay processor:
    // teardown instrumentation" constructs both channels tearing a level down and asserts
    // `teardownLevelsBySystem` reports the sum, and
    // lib/tick-harness/__tests__/cohort-analysis.test.ts folds a constructed teardown map into
    // `totalTeardownLevels` and asserts the total. Together they cover both hops of the wire this
    // test cannot exercise on a dormant galaxy.
    const results = await runBusy();
    expect(results.episodeCosts.totalTeardownLevels).toBe(194);
    expect(results.foundingTrajectory.buckets[0].n).toBeGreaterThan(0); // colonies founded in-window
    expect(results.provisionRatchet.buckets.length).toBeGreaterThan(0);

    // abandonmentByCause: the sum identity holds regardless of regime, and — like
    // totalTeardownLevels above — both counts are pinned at 0 on BUSY's calm regime (measured):
    // Rule 1 (famine-collapse) and Rule 2 without a famine conjunct (decline-to-empty) both need
    // sustained unrest/shortfall this run's horizon never reaches. The counter's own wiring — that
    // an abandonment actually reaches `abandonedSystemsByCause` — is proven at unit level where it
    // can be forced to fire: lib/tick/processors/__tests__/population.test.ts "Abandonment by
    // cause" describe block tags both a famine-present and a non-famine abandonment. A future
    // nonzero reading here is real abandonment pressure, not a regression in this instrument.
    const ac = results.abandonmentByCause;
    expect(ac.total).toBe(ac.famineCollapse + ac.declineToEmpty);
    expect(ac.famineCollapse).toBe(0);
    expect(ac.declineToEmpty).toBe(0);

    // colonistDeliveryTotals: BUSY founds colonies and runs long enough for colonist delivery to
    // resolve, so the accumulated per-system totals (folded into each world cohort's
    // colonistDeliveryInflow) must be genuinely nonzero here — unlike the two calm-regime channels
    // above.
    const totalDeliveryInflow = results.worldCohorts.reduce((sum, c) => sum + c.colonistDeliveryInflow, 0);
    expect(totalDeliveryInflow).toBeGreaterThan(0);
  }, 180_000);
});

// ── foldFoundingTick ──────────────────────────────────────────────
// The order inside it is the instrument. Sweeping for new colonies before accumulating the tick's
// draws loses the founding cycle's own slice — and loses it QUIETLY, since every earlier slice
// still folds, so no aggregate goes to zero and nothing else in the harness notices.

describe("foldFoundingTick", () => {
  it("folds a draw made on the founding tick itself into the colony it founded", () => {
    const tracker = new Map<string, FoundedColonyRecord>();
    const staging = new Map<string, FoundingStagingTotals>();

    // Two earlier cycles, while the target was still `controlled` — no colony to track yet.
    foldFoundingTick([{ id: "c1", control: "controlled" }], 24, new Set(), tracker, staging, [
      { systemId: "c1", tonnage: 40, moneyCost: 12, founderCover: 0.9 },
    ]);
    foldFoundingTick([{ id: "c1", control: "controlled" }], 48, new Set(), tracker, staging, [
      { systemId: "c1", tonnage: 30, moneyCost: 9, founderCover: 0.7 },
    ]);
    expect(tracker.size).toBe(0);

    // The completing tick: the last slice is staged AND the system reads `developed`, both in this
    // one batch. Sweep before accumulating and this slice — and the deepest cover of the three —
    // is dropped, leaving a plausible 70 t / 0.7× instead of the truth.
    foldFoundingTick([{ id: "c1", control: "developed" }], 72, new Set(), tracker, staging, [
      { systemId: "c1", tonnage: 30, moneyCost: 9, founderCover: 0.4 },
    ]);

    const record = tracker.get("c1");
    expect(record?.foundedTick).toBe(72);
    expect(record?.manifestTonnage).toBeCloseTo(100, 9);
    expect(record?.foundingMoneyCost).toBeCloseTo(30, 9);
    expect(record?.founderCoverAfter).toBeCloseTo(0.4, 9);
  });
});

describe("runTickHarness: the cycle-gated samplers", () => {
  it("counts only the colonies founded in play, never the ones world-gen shipped developed", async () => {
    const results = await runBusy();
    const start = generateWorld({ systemCount: BUSY.systemCount, seed: BUSY.seed });
    const developedAtStart = toTickSystems(start).filter((s) => s.control === "developed").length;
    const developedAtEnd = toTickSystems(results.finalWorld)
      .filter((s) => s.control === "developed").length;

    expect(developedAtStart).toBeGreaterThan(0);
    expect(results.foundingStock.foundedCount).toBeGreaterThan(0);
    // Control only ever moves toward `developed`, so the colonies founded in play are exactly
    // the difference — a start set drawn from the wrong systems breaks the identity in both
    // directions (too wide a set founds nothing; too narrow a one founds the galaxy).
    expect(results.foundingStock.foundedCount).toBe(developedAtEnd - developedAtStart);
  }, 180_000);
});
