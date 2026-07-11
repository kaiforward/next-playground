import { describe, it, expect } from "vitest";
import { forecastEtaPulses } from "@/lib/engine/construction";
import type { WorldBuildProject } from "@/lib/world/types";
import {
  computeFactionConstruction, buildingLabel, describeBuildProject,
  type ConstructionSystemInfo,
} from "@/lib/engine/construction-readout";
import type { WorldConstructionProject } from "@/lib/world/types";

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

describe("buildingLabel / describeBuildProject", () => {
  it("labels the non-good building types and falls back to the good name", () => {
    expect(buildingLabel("housing")).toBe("Housing");
    expect(buildingLabel("vocational_school")).toBe("Vocational School");
    expect(describeBuildProject("housing")).toContain("population capacity");
    expect(describeBuildProject("vocational_school")).toContain("technician");
  });
});

describe("computeFactionConstruction", () => {
  const systems: ConstructionSystemInfo[] = [
    { id: "dev1", name: "Vela Prime", control: "developed", population: 100 },
    { id: "dev2", name: "Corvus Gate", control: "developed", population: 50 },
    { id: "ctrl", name: "Kepler Reach", control: "controlled", population: 0 },
  ];
  const projects: WorldConstructionProject[] = [
    { kind: "colony_establish", id: "c1", factionId: "f1", systemId: "ctrl", sourceSystemId: "dev1", seedPop: 340, housingLevels: 3, workTotal: 100, workDone: 62 },
    { kind: "build", id: "b1", factionId: "f1", systemId: "dev1", buildingType: "housing", levels: 4, workTotal: 40, workDone: 32 },
  ];

  it("pools only economically-active systems and splits expansion vs build-out", () => {
    const r = computeFactionConstruction(projects, systems, 0.05, 4);
    expect(r.pool).toBeCloseTo((100 + 50) * 0.05, 6); // controlled pop 0 contributes nothing
    expect(r.expandCount).toBe(1);
    expect(r.buildCount).toBe(1);
    expect(r.expansion[0].kind).toBe("colony_establish");
    expect(r.expansion[0].sourceSystemName).toBe("Vela Prime");
    expect(r.expansion[0].systemName).toBe("Kepler Reach");
    expect(r.expansion[0].progress).toBeCloseTo(0.62, 6);
    expect(r.buildOut[0].buildingLabel).toBe("Housing");
    expect(r.buildOut[0].progress).toBeCloseTo(0.8, 6);
    expect(r.buildOut[0].etaPulses === null || typeof r.buildOut[0].etaPulses === "number").toBe(true);
  });
});
