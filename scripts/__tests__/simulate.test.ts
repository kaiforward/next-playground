import { describe, expect, it } from "vitest";
import { formatTable, formatTierZeroIdle } from "../simulate";
import { minimalHarnessResults } from "@/lib/tick-harness/__tests__/harness-results-fixture";
import type { TierZeroIdleSummary } from "@/lib/tick-harness/build-analysis";

/**
 * The tier-0 idle-levels metric belongs in the harness's PRINTED text report, not only in the
 * returned `HarnessResults` object — `formatTierZeroIdle` is the printed-report piece pulled out
 * for that reason.
 */
describe("formatTierZeroIdle", () => {
  it("renders both cohorts' idle-level counts and their systems-affected denominators", () => {
    const summary: TierZeroIdleSummary = {
      homeworld: { systemCount: 3, idleLevels: 2, systemsWithIdleTier0: 1 },
      colony: { systemCount: 10, idleLevels: 0, systemsWithIdleTier0: 0 },
    };
    const lines = formatTierZeroIdle(summary).join("\n");
    expect(lines).toContain("Tier-0 Idle Levels");
    expect(lines).toContain("homeworld: 2 idle levels over 1 of 3 systems");
    expect(lines).toContain("colony: 0 idle levels over 0 of 10 systems");
  });

  it("prints zero, not a blank or NaN line, for an all-zero summary", () => {
    const summary: TierZeroIdleSummary = {
      homeworld: { systemCount: 0, idleLevels: 0, systemsWithIdleTier0: 0 },
      colony: { systemCount: 0, idleLevels: 0, systemsWithIdleTier0: 0 },
    };
    const lines = formatTierZeroIdle(summary);
    expect(lines.join("\n")).not.toMatch(/NaN/);
    expect(lines.some((l) => l.includes("0 idle levels over 0 of 0 systems"))).toBe(true);
  });
});

describe("formatTable", () => {
  it("includes the tier-0 idle-levels reading in the printed report text — proves the metric reaches the actual report, not just formatTierZeroIdle in isolation", () => {
    const results = minimalHarnessResults();
    results.tierZeroIdle = {
      homeworld: { systemCount: 4, idleLevels: 3, systemsWithIdleTier0: 2 },
      colony: { systemCount: 9, idleLevels: 0, systemsWithIdleTier0: 0 },
    };
    const table = formatTable(results);
    expect(table).toContain("Tier-0 Idle Levels");
    expect(table).toContain("homeworld: 3 idle levels over 2 of 4 systems");
    expect(table).toContain("colony: 0 idle levels over 0 of 9 systems");
  });
});
