import { describe, it, expect, vi, afterEach } from "vitest";

async function resolveAtScale(scale: string) {
  vi.resetModules();
  vi.stubEnv("ECONOMY_SCALE", scale);
  const { resolveConstants } = await import("@/lib/engine/simulator/constants");
  return resolveConstants();
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("ECONOMY_SCALE simulator pressure", () => {
  it("scales bot starting credits and the sim flow budget by S", async () => {
    const base = await resolveAtScale("1");
    const x10 = await resolveAtScale("10");

    expect(x10.bots.startingCredits).toBeCloseTo(base.bots.startingCredits * 10);
    expect(x10.tradeFlow.flowBudget).toBeCloseTo(base.tradeFlow.flowBudget * 10);
  });
});
