import { describe, it, expect } from "vitest";
import { runTickHarness } from "../runner";
import type { HarnessConfig } from "../types";
import { CONSTRUCTION_INTERVAL } from "@/lib/constants/tick-cadence";
import { BUSY, firstRunWhere } from "./runner-fixtures";

// ── The cycle-gated samplers ─────────────────────────────────────

describe("runTickHarness: the cycle-gated samplers", () => {
  it("holds each colony's opening reading until its first economy cycle", async () => {
    // Colonies land on the construction cadence and are read on the economy one, so a run that
    // stops part-way through a cycle leaves the colonies founded since the last boundary still
    // waiting — `sampledCount` BELOW `foundedCount` is the whole signature of the gate. A sampler
    // that fired on any other tick would have read every one of them, and read them before the
    // cycle that writes their satisfaction had ever run.
    // The tick a run has to stop on to land mid-cycle moves with the archetype/sun-class tables
    // (colonisation pacing is a function of them, not a constant this suite owns — see
    // `firstRunWhere` above), so search forward for the first tickCount where at least one colony
    // has founded and been sampled but at least one other founded colony has not yet met its first
    // economy cycle, rather than hardcode the boundary tick.
    // Under the recut habitability tables the earliest two-colony window (one sampled, one still
    // waiting) lands at tick 5,260 — the pre-5,000 prefix never satisfies the condition, so starting
    // the search there wastes ~50 no-op harness runs and blows the timeout below. Start just ahead
    // of that dead prefix instead of at the first colony's own opening tick (~4,128).
    const results = await firstRunWhere(
      { systemCount: 60, seed: 7 },
      (r) =>
        r.foundingStock.foundedCount > 0 &&
        r.foundingStock.sampledCount > 0 &&
        r.foundingStock.sampledCount < r.foundingStock.foundedCount,
      { start: 5_000, step: 20, maxTickCount: 6_000 },
    );
    const stock = results.foundingStock;

    expect(stock.foundedCount).toBeGreaterThan(0);
    expect(stock.sampledCount).toBeGreaterThan(0);
    expect(stock.sampledCount).toBeLessThan(stock.foundedCount);
    // And what it read is a colony that has lived a cycle, not one still holding its manifest.
    expect(stock.meanOpeningSatisfaction).toBeGreaterThan(0.5);
    expect(stock.openingDeprivedCount).toBeLessThan(stock.sampledCount / 2);
  }, 600_000); // measured 99s locally alone; on CI the three runner-*.test.ts files run CONCURRENTLY on 4 vCPUs, so contention roughly doubles the serial ~2.1x CI factor — headroom, not a hang allowance

  it("takes the demand-hunting flip as a per-cycle observation", async () => {
    // flipRate's denominator is decided readings, and a reading is taken once per economy cycle.
    // Sampled every tick instead, the same reversals divide by CYCLE_LENGTH times as many
    // readings and the rate would collapse by an order of magnitude — this test's whole point is
    // that a per-tick sampler cannot land in the band asserted below, not the rate's own magnitude.
    //
    // Under the construction-cost site ranking (which concentrates tier-1+ production into hubs),
    // the rate settles quickly with horizon — probe-backed at ECONOMY_SCALE=1: 0.00144 (12,000
    // ticks), 0.00255 (16,000), 0.00254 (20,000), 0.00256 (24,000). Read at a fixed 20,000 — BUSY's
    // own horizon plus 10,000 — and pin the measured band: above 0.0015 (a per-tick sampler
    // diluted by CYCLE_LENGTH would read ~0.0001 and can never clear it — the sampling-cadence
    // discrimination this test exists for) and below 0.0035 (comfortably above the settled rate;
    // drifting past it means demand-hunting pressure has shifted regime again and the band needs
    // re-deriving).
    const results = await runTickHarness({
      systemCount: BUSY.systemCount,
      seed: BUSY.seed,
      tickCount: BUSY.tickCount + 10_000,
    });
    expect(results.demandHunting.flipRate).toBeGreaterThan(0.0015);
    expect(results.demandHunting.flipRate).toBeLessThan(0.0035);
  }, 180_000);
});

describe("runTickHarness: founding instruments", () => {
  // Every figure below is the harness's own wiring, not the economy's behaviour: a break in any of
  // it reads as a plausible number (0 stalls looks like a healthy galaxy; a concurrency mean off by
  // the cadence looks like a busier one), so each is asserted as a structural identity rather than
  // a magnitude nobody could recognise as wrong. 240 ticks is ten construction cycles on a small
  // world — long enough that colonies are committed, staged from and held up. systemCount 60, not
  // 20: at 20 this seed's minor-faction count claims all but 2 systems outright, and under the
  // habitability-seeding tables the 2 leftover systems (passed over by homeworld placement for low
  // habitable land) land uncolonisable — no colony_establish project is ever committed to sample.
  const CONFIG: HarnessConfig = { systemCount: 60, seed: 7, tickCount: 240 };

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
  }, 60_000);

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
    // Post-strip, the only events left are the relations trio, spawned by faction-pair scores
    // crossing thresholds — typically hundreds of ticks in. This 240-tick CONFIG never reaches
    // one, so no founder system is ever under an active event and the count is genuinely 0 —
    // structurally unreachable on this fixture, not a broken wire. Re-anchor to a longer/differently-
    // seeded run once a run is found where a founder system sits under a relations event; do not
    // delete the attribution check. The attribution's own wiring — that a stall recorded while its
    // source system is on the event board actually reaches `materialsShortUnderEvent`, and one that
    // isn't does not — is proven at unit level where it can be forced to fire:
    // lib/tick-harness/__tests__/build-analysis.test.ts "founding lifecycle — stall attribution >
    // keeps the three causes apart, and counts a materials shortfall as neither" constructs both a
    // materials-shortfall stall recorded under an event and one recorded without, and asserts the
    // counter reads only the former.
    expect(stalls.materialsShortUnderEvent).toBe(0);
    expect(stalls.materialsShortUnderEvent).toBeLessThanOrEqual(stalls.materialsShort);
  }, 60_000);

  it("collects the founder cohort from the manifests actually staged, and settles cleanly", async () => {
    const results = await runTickHarness(CONFIG);
    // A source that can spare nothing stages nothing and is no founder however many colonies name
    // it — so a non-empty cohort is evidence the manifest stream was read, not merely that colonies
    // were committed.
    expect(results.founderCohort.founder.systemCount).toBeGreaterThan(0);
    // Every faction-cycle folded into the money bars is a real settlement, not a seeded placeholder.
    expect(results.foundingEra.invalidRows).toBe(0);
  }, 60_000);
});
