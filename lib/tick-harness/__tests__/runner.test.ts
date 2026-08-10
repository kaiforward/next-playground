import { describe, it, expect } from "vitest";
import { foldFoundingTick, runTickHarness } from "../runner";
import { MARKET_ROLES } from "../types";
import type { HarnessConfig, MarketRole } from "../types";
import { CONSTRUCTION_INTERVAL, CYCLE_LENGTH } from "@/lib/constants/tick-cadence";
import { SNAPSHOT_INTERVAL } from "../market-analysis";
import { LOGISTICS_WARMUP_TICKS } from "../logistics-analysis";
import { TRADE_SIMULATION } from "@/lib/constants/trade-simulation";
import { generateWorld } from "@/lib/world/gen";
import { toTickSystems } from "@/lib/world/tick";
import type { GovernmentType } from "@/lib/types/game";
import type { FoundedColonyRecord, FoundingStagingTotals } from "../build-analysis";

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
  const CONFIG: HarnessConfig = { systemCount: 20, seed: 7, tickCount: 1 };

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

  it("is measured on a galaxy that exercises the empty region, the tie-break and its direction", () => {
    // The comparison above is only worth its runtime on a fixture where each branch is live: a
    // galaxy of one-government regions agrees with almost any folding rule, and would pass while
    // the tie-break ran backwards or the default leaked into every row.
    const byRegion = govsByRegion();
    const world = generateWorld({ systemCount: CONFIG.systemCount, seed: CONFIG.seed });

    let emptyRegions = 0;
    let nonDefaultDominant = 0;
    let tiesWhereOrderMatters = 0;
    for (const r of world.regions) {
      const govs = byRegion.get(r.id) ?? [];
      if (govs.length === 0) {
        emptyRegions++;
        continue;
      }
      const counts = new Map<GovernmentType, number>();
      for (const g of govs) counts.set(g, (counts.get(g) ?? 0) + 1);
      const entries = [...counts.entries()];
      const max = Math.max(...entries.map((e) => e[1]));
      const tied = entries.filter((e) => e[1] === max);
      const alphabetical = [...tied].sort((a, b) => (a[0] < b[0] ? -1 : 1))[0][0];
      if (alphabetical !== "federation") nonDefaultDominant++;
      // A tie whose winner is NOT the first type encountered — the only shape in which the
      // tie-break's existence, and its direction, are both visible.
      if (tied.length > 1 && tied[0][0] !== alphabetical) tiesWhereOrderMatters++;
    }

    expect(emptyRegions).toBeGreaterThan(0);
    expect(nonDefaultDominant).toBeGreaterThan(0);
    expect(tiesWhereOrderMatters).toBeGreaterThan(0);
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

  it("names the systems events happened on, rather than falling back to their ids", async () => {
    const results = await runTickHarness(CONFIG);
    const nameById = new Map(results.finalWorld.systems.map((s) => [s.id, s.name]));

    const located = results.eventImpacts.filter((e) => e.systemId !== null);
    expect(located.length).toBeGreaterThan(0);
    for (const impact of located) {
      expect(impact.systemName).toBe(nameById.get(impact.systemId ?? ""));
      expect(impact.systemName).not.toBe(impact.systemId);
    }
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

/** Big enough that colonies are founded, migration resolves and goods move. ~2s. */
const BUSY: HarnessConfig = { systemCount: 60, seed: 7, tickCount: 1000 };

describe("runTickHarness: the per-tick instrumentation", () => {
  it("accumulates migration throughput over the cycles that resolved it", async () => {
    const results = await runTickHarness(BUSY);
    const m = results.migrationThroughput;

    expect(m.cycleCount).toBeGreaterThan(0);
    expect(m.totalColonists).toBeGreaterThan(0);
    expect(m.totalDiffusion).toBeGreaterThan(0);
    expect(m.meanPerCycle).toBeCloseTo((m.totalColonists + m.totalDiffusion) / m.cycleCount, 9);
  }, 60_000);

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
    const results = await runTickHarness(BUSY);
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
  }, 60_000);

  it("resolves strike suppression per eligible pair, both halves accumulated", async () => {
    // 4000 ticks at 60 systems is the smallest fixture where a strike actually silences a
    // proposal (12 of 125k eligible pairs) — below it `suppressed` is 0 and the numerator's
    // wiring is untestable, because a dropped fold and a quiet galaxy print the same 0.
    const results = await runTickHarness({ systemCount: 60, seed: 7, tickCount: 4000 });
    const s = results.strikeSuppression;

    expect(s.eligible).toBeGreaterThan(0);
    expect(s.suppressed).toBeGreaterThan(0);
    expect(s.suppressed).toBeLessThanOrEqual(s.eligible);
    expect(s.ratePerEligible).toBeCloseTo(s.suppressed / s.eligible, 12);
  }, 120_000);
});

// ── The flow log and the haul-budget ledger ──────────────────────

describe("runTickHarness: the whole-run flow log", () => {
  it("takes each tick's flow rows once, as that tick produces them", async () => {
    // The world prunes its own flow log to FLOW_HISTORY_TICKS every tick, which is why the run
    // accumulates its own. 650 ticks at 20 systems is the window where the two can be compared:
    // the first transfer lands at tick 456, inside the retention tail, so the final world still
    // holds every row the run ever produced and is a ground truth for the accumulator.
    const tickCount = 650;
    const results = await runTickHarness({ systemCount: 20, seed: 7, tickCount });
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
  }, 60_000);

  it("starts the haul-budget ledger at the logistics warm-up tick, not before", async () => {
    // Transfers are already happening before the warm-up tick — so a ledger that started early
    // would read a spend fraction there, and one that started late would read none at the tick
    // it is supposed to open on. Both arms are needed: either bound alone passes vacuously.
    const base = { systemCount: 20, seed: 7 } as const;
    const before = await runTickHarness({ ...base, tickCount: LOGISTICS_WARMUP_TICKS - 1 });
    const at = await runTickHarness({ ...base, tickCount: LOGISTICS_WARMUP_TICKS });

    expect(before.logisticsActivity.transferCount).toBeGreaterThan(0);
    expect(before.logisticsActivity.budgetSpentFrac).toBe(0);
    expect(at.logisticsActivity.budgetSpentFrac).toBeGreaterThan(0);
    // The flag census is a rate over developed-system markets, not a count of them: dropping the
    // predicate flags every market it looks at and pins the rate at 1.
    expect(at.logisticsActivity.fundingBoundFlagSetRate).toBeLessThan(1);
  }, 60_000);
});

// ── The cycle-gated samplers ─────────────────────────────────────

describe("runTickHarness: the cycle-gated samplers", () => {
  it("counts only the colonies founded in play, never the ones world-gen shipped developed", async () => {
    const results = await runTickHarness(BUSY);
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
  }, 60_000);

  it("holds each colony's opening reading until its first economy cycle", async () => {
    // Colonies land on the construction cadence and are read on the economy one, so a run that
    // stops part-way through a cycle leaves the colonies founded since the last boundary still
    // waiting — `sampledCount` BELOW `foundedCount` is the whole signature of the gate. A sampler
    // that fired on any other tick would have read every one of them, and read them before the
    // cycle that writes their satisfaction had ever run.
    const results = await runTickHarness({ systemCount: 60, seed: 7, tickCount: 493 });
    const stock = results.foundingStock;

    expect(stock.foundedCount).toBeGreaterThan(0);
    expect(stock.sampledCount).toBeGreaterThan(0);
    expect(stock.sampledCount).toBeLessThan(stock.foundedCount);
    // And what it read is a colony that has lived a cycle, not one still holding its manifest.
    expect(stock.meanOpeningSatisfaction).toBeGreaterThan(0.5);
    expect(stock.openingDeprivedCount).toBeLessThan(stock.sampledCount / 2);
  }, 60_000);

  it("takes the demand-hunting flip as a per-cycle observation", async () => {
    // flipRate's denominator is decided readings, and a reading is taken once per economy cycle.
    // Sampled every tick instead, the same reversals divide by CYCLE_LENGTH times as many
    // readings and the rate collapses by an order of magnitude — the bound below is what a
    // per-tick sampler cannot clear, not a tuning value.
    const results = await runTickHarness(BUSY);
    expect(results.demandHunting.flipRate).toBeGreaterThan(0.005);
  }, 60_000);
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
    const results = await runTickHarness(BUSY);

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
  }, 60_000);

  it("actually wires activity through — BUSY is not a run where every new section reads zero", async () => {
    // A genuinely broken wire (accumulator never fed, or the summary always empty) and a genuinely
    // quiet galaxy both print zero — this fixture confirms BUSY is the former's counter-example, so
    // the "well-formed, never negative" test above cannot be passing vacuously.
    const results = await runTickHarness(BUSY);
    expect(results.episodeCosts.totalTeardownLevels).toBeGreaterThan(0);
    expect(results.foundingTrajectory.buckets[0].n).toBeGreaterThan(0); // colonies founded in-window
    expect(results.provisionRatchet.buckets.length).toBeGreaterThan(0);
  }, 60_000);
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

describe("runTickHarness: founding instruments", () => {
  // Every figure below is the harness's own wiring, not the economy's behaviour: a break in any of
  // it reads as a plausible number (0 stalls looks like a healthy galaxy; a concurrency mean off by
  // the cadence looks like a busier one), so each is asserted as a structural identity rather than
  // a magnitude nobody could recognise as wrong. 240 ticks is ten construction cycles on a small
  // world — long enough that colonies are committed, staged from and held up.
  const CONFIG: HarnessConfig = { systemCount: 20, seed: 7, tickCount: 240 };

  it("samples open colonies once per construction cycle, not once per tick", async () => {
    // The census is a per-CYCLE rate. Sampled per tick it would read the construction interval
    // times too high, and the settler gate's invariance — whose whole evidence is a concurrent
    // count — would be measured against a figure that moved with the cadence knob.
    const results = await runTickHarness(CONFIG);
    const inFlight = results.foundingLifecycle.inFlight;

    expect(inFlight.sampledCycles).toBe(Math.floor(CONFIG.tickCount / CONSTRUCTION_INTERVAL));
    expect(inFlight.max).toBeGreaterThan(0);
    expect(inFlight.maxTick).not.toBeNull();
    expect((inFlight.maxTick ?? 1) % CONSTRUCTION_INTERVAL).toBe(0); // taken on a cycle boundary
    expect(inFlight.meanPerCycle).toBeGreaterThan(0);
    expect(inFlight.meanPerCycle).toBeLessThanOrEqual(inFlight.max);
  }, 30_000);

  it("wires the founding stall board, its gate split and its event context end to end", async () => {
    const results = await runTickHarness(CONFIG);
    const stalls = results.foundingLifecycle.stalls;

    expect(stalls.observed).toBeGreaterThan(0);
    // One record per priced colony per CONSTRUCTION cycle — never one per tick, and never one for
    // something that is not a stall record at all.
    expect(stalls.observed).toBeLessThan(CONFIG.tickCount);
    expect(stalls.charter + stalls.funds + stalls.pool + stalls.unGated).toBe(stalls.observed);
    // The event board is read at the tick the shortfall happened: a founder sparing less under an
    // active event is a shortfall the design accepts, and by run end that event is long gone.
    expect(stalls.materialsShort).toBeGreaterThan(0);
    // Deliberate behaviour anchor, not a structural identity: it needs an event to land on a
    // founder system inside this run (it does, on this seed), and it is what fails if the event
    // board stops being read at the shortfall's own tick. If seed or event tuning flips it,
    // re-anchor the fixture — do not delete the attribution check.
    expect(stalls.materialsShortUnderEvent).toBeGreaterThan(0);
    expect(stalls.materialsShortUnderEvent).toBeLessThanOrEqual(stalls.materialsShort);
  }, 30_000);

  it("collects the founder cohort from the manifests actually staged, and settles cleanly", async () => {
    const results = await runTickHarness(CONFIG);
    // A source that can spare nothing stages nothing and is no founder however many colonies name
    // it — so a non-empty cohort is evidence the manifest stream was read, not merely that colonies
    // were committed.
    expect(results.founderCohort.founder.systemCount).toBeGreaterThan(0);
    // Every faction-cycle folded into the money bars is a real settlement, not a seeded placeholder.
    expect(results.foundingEra.invalidRows).toBe(0);
  }, 30_000);
});

describe("runTickHarness: logistics instruments", () => {
  it("wires the budget ledger and flow counters end to end", async () => {
    // A silent wiring break reads 0.000 on every new counter — exactly the healthy-looking
    // value an ample budget produces — so the guard is a live run asserting non-zero. 800
    // ticks: past LOGISTICS_WARMUP_TICKS (where ledger accumulation starts) with cycles to
    // spare on a small world that transfers well before then.
    const results = await runTickHarness({ systemCount: 20, seed: 7, tickCount: 800 });
    const lg = results.logisticsActivity;
    expect(lg.transferCount).toBeGreaterThan(0);
    expect(lg.budgetSpentFrac).toBeGreaterThan(0);
    expect(lg.flowRowsPerCycle).toBeGreaterThanOrEqual(1);
  }, 30_000);

  it("wires the third-arm drawBrakeCeiling pin through to a measurable divergence", async () => {
    // A silently dropped wire is invisible on every OTHER counter — both arms would just run the
    // live game twice and agree everywhere — so the guard has to be a same-seed A/B. The pin
    // reaches only the draw figure, whose one reader is the matcher's severity weight, and
    // severity does nothing but ORDER the deficit queue. Donor pools are held per good, and the
    // haul budget goes barely 0.2% spent at this scale, so reordering two deficits of DIFFERENT
    // goods changes nothing at all: the divergence needs two systems of the same faction short of
    // the SAME good in one cycle, competing for one donor's drawable.
    //
    // Faction count barely moves with galaxy size (8 majors plus a √N-interpolated dozen minors),
    // so systems-per-faction is what supplies that competition. At 60 systems a faction musters
    // three or four systems and same-good pairs essentially never swap (measured: 0 swaps at
    // 3000 ticks, still 0 at 6000 — it is structural, not a matter of running longer); at 120 the
    // same factions carry eight or nine systems each and the swaps are routine — 109 of them
    // across 7 goods on this seed, 159 and 58 on the two others tried, which is what makes the
    // divergence below an outcome rather than a coincidence.
    const config: HarnessConfig = { systemCount: 120, seed: 7, tickCount: 3000 };
    const live = await runTickHarness(config);
    const pinned = await runTickHarness({ ...config, drawBrakeCeiling: "anchor" });
    expect(live.logisticsActivity.transferCount).toBeGreaterThan(0);
    expect(pinned.logisticsActivity.totalQuantity).not.toBeCloseTo(live.logisticsActivity.totalQuantity, 6);
  }, 60_000);
});
