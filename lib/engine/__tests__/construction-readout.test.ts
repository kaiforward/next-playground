import { describe, it, expect } from "vitest";
import { forecastEtaPulses } from "@/lib/engine/construction";
import type { WorldBuildProject } from "@/lib/world/types";

function build(id: string, workTotal: number, workDone: number): WorldBuildProject {
  return { kind: "build", id, factionId: "f1", systemId: "s1", buildingType: "housing", levels: 1, workTotal, workDone };
}

describe("forecastEtaPulses", () => {
  it("funds front-first: the head project lands before the tail", () => {
    // cap 4, pool 4 → only 4 points/pulse, all to the head until it lands.
    const eta = forecastEtaPulses([build("a", 8, 0), build("b", 8, 0)], 4, 4);
    expect(eta).toEqual([2, 4]);
  });

  it("spreads leftover pool across parallel fronts", () => {
    // cap 4, pool 8 → 4 to each per pulse; both land on pulse 2.
    const eta = forecastEtaPulses([build("a", 8, 0), build("b", 8, 0)], 8, 4);
    expect(eta).toEqual([2, 2]);
  });

  it("returns null (stalled) for every project when the pool is zero", () => {
    expect(forecastEtaPulses([build("a", 8, 0)], 0, 4)).toEqual([null]);
  });

  it("returns null past the guard cap without spinning", () => {
    // Huge work, tiny pool that still funds → guard trims it to stalled at maxPulses.
    expect(forecastEtaPulses([build("a", 100000, 0)], 1, 4, 5)).toEqual([null]);
  });
});
