import { describe, it, expect } from "vitest";
import { runTickHarness } from "../runner";
import type { HarnessConfig } from "../types";
import { LOGISTICS_WARMUP_TICKS } from "../logistics-analysis";

describe("runTickHarness: logistics instruments", () => {
  it("wires the budget ledger and flow counters end to end", async () => {
    // A silent wiring break reads 0.000 on every new counter — exactly the healthy-looking
    // value an ample budget produces — so the guard is a live run asserting non-zero.
    // LOGISTICS_WARMUP_TICKS + 200 (eight cycles): past the tick where ledger accumulation starts,
    // with cycles to spare on a world that transfers well before then. systemCount 60, not 20 — see
    // the flow-log test's comment for why 20 structurally cannot found a colony on this seed under
    // the habitability-seeding tables.
    const results = await runTickHarness({
      systemCount: 60, seed: 7, tickCount: LOGISTICS_WARMUP_TICKS + 200,
    });
    const lg = results.logisticsActivity;
    expect(lg.transferCount).toBeGreaterThan(0);
    expect(lg.budgetSpentFrac).toBeGreaterThan(0);
    expect(lg.flowRowsPerReferenceCycle).toBeGreaterThanOrEqual(1);
  }, 60_000);

  it("wires the third-arm drawBrakeCeiling pin through to a measurable divergence", async () => {
    // A silently dropped wire is invisible on every OTHER counter — both arms would just run the
    // live game twice and agree everywhere — so the guard has to be a same-seed A/B. The pin
    // reaches only the draw figure, whose one reader is the matcher's severity weight, and
    // severity does nothing but ORDER the deficit queue. Donor pools are held per good, and the
    // haul budget goes barely 0.2% spent at this scale, so reordering two deficits of DIFFERENT
    // goods changes nothing at all: the divergence needs two systems of the same faction short of
    // the SAME good in one cycle, competing for one donor's drawable.
    //
    // Faction count barely moves with galaxy size (8 majors plus a √N-interpolated dozen minors), so
    // systems-per-faction is what supplies that competition — and the systems a faction holds are
    // almost all colonised in play, which is why both the galaxy size and the horizon matter.
    // Since the build rule separated housing land from industry land, industry land is far freer
    // galaxy-wide, so the 120-system/13,000-tick fixture that used to bind (18.2 of 116,536 hauled)
    // is now bit-identical on both arms out to 16,000 ticks — donor contention needs more
    // systems-per-faction to reappear. Measured on this seed: 120 systems stays bit-identical
    // through 20,000 and 26,000 ticks too (diff only reappears there at 45,086 of 90.3M — too late
    // to be the cheap fixture); 200 systems first shows a diff at 13,000 (533 of 8.6M, too close to
    // the old dropped-wire zero to trust) and is solidly bound by 20,000 (268,365 of 38.2M hauled,
    // 0.70% of the total — comfortably outside any float-precision coincidence).
    const config: HarnessConfig = { systemCount: 200, seed: 7, tickCount: 20_000 };
    const live = await runTickHarness(config);
    const pinned = await runTickHarness({ ...config, drawBrakeCeiling: "anchor" });
    expect(live.logisticsActivity.transferCount).toBeGreaterThan(0);
    expect(pinned.logisticsActivity.totalQuantity).not.toBeCloseTo(live.logisticsActivity.totalQuantity, 6);
  }, 600_000); // measured ~138s locally alone (two full harness runs); on CI the three runner files contend on 4 vCPUs — headroom covers serial CI factor plus contention
});
