import { describe, it, expect } from "vitest";
import { foldFoundingTick, runTickHarness } from "../runner";
import { MARKET_ROLES } from "../types";
import type { HarnessConfig, MarketRole } from "../types";
import { CONSTRUCTION_INTERVAL } from "@/lib/constants/tick-cadence";
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

describe("runTickHarness: strike-suppression rate", () => {
  it("reports a zero denominator rather than dividing by it when no construction cycle is ever due", async () => {
    // Below CONSTRUCTION_INTERVAL (24): the construction-cycle boundary is never crossed, so
    // directed-build never resolves and strikeSuppressedProposals never reaches the accumulator —
    // eligible stays at 0 for the whole run. The rate must read 0, not NaN.
    const results = await runTickHarness({ systemCount: 20, seed: 7, tickCount: CONSTRUCTION_INTERVAL - 1 });
    expect(results.strikeSuppression).toEqual({ suppressed: 0, eligible: 0, ratePerEligible: 0 });
  });
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
    // live game twice and agree everywhere — so the guard has to be a same-seed A/B. The pin only
    // reaches the draw figure's brake, which only ever moves an outcome by reordering which of two
    // COMPETING deficits a budget-limited cycle services first — a small 20-system/800-tick world
    // never happens to raise that competition (verified: byte-identical logistics activity), so
    // this needs a bigger, longer run for the reordering to actually bite. Measured non-zero on
    // every seed tried at this scale.
    const config: HarnessConfig = { systemCount: 60, seed: 7, tickCount: 3000 };
    const live = await runTickHarness(config);
    const pinned = await runTickHarness({ ...config, drawBrakeCeiling: "anchor" });
    expect(live.logisticsActivity.transferCount).toBeGreaterThan(0);
    expect(pinned.logisticsActivity.totalQuantity).not.toBeCloseTo(live.logisticsActivity.totalQuantity, 6);
  }, 60_000);
});
