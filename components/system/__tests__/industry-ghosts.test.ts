import { describe, it, expect } from "vitest";
import { classifyGhosts } from "@/components/system/industry-ghosts";
import {
  HOUSING_TYPE, CONSTRUCTION_CENTRE_TYPE, COMPLEX_TYPES, BUILDING_TYPES,
} from "@/lib/constants/industry";
import type { ConstructionProjectRow } from "@/lib/engine/construction-readout";

function buildRow(buildingType: string, origin: "auto" | "player" = "auto"): ConstructionProjectRow {
  return {
    kind: "build", id: `p-${buildingType}`, systemId: "s1", systemName: "Alpha", origin,
    buildingType, buildingLabel: buildingType, levels: 2, detail: "", progress: 0.25,
    workDone: 5, workTotal: 20, etaPulses: 3, nextPulseGain: 2,
  };
}

describe("classifyGhosts", () => {
  it("routes extractors to the deposit group with their resource, others to their ledger group", () => {
    const tier0 = Object.keys(BUILDING_TYPES).find((t) => BUILDING_TYPES[t].resource !== undefined)!;
    const complex = COMPLEX_TYPES[0];
    const ghosts = classifyGhosts([
      buildRow(tier0), buildRow(HOUSING_TYPE, "player"),
      buildRow(CONSTRUCTION_CENTRE_TYPE), buildRow(complex),
    ]);
    expect(ghosts.get("deposit")?.[0]?.resource).toBe(BUILDING_TYPES[tier0].resource);
    expect(ghosts.get("Housing")?.[0]?.origin).toBe("player");
    expect(ghosts.get("Support")?.[0]?.buildingType).toBe(CONSTRUCTION_CENTRE_TYPE);
    expect(ghosts.get("Specialisation")?.[0]?.buildingType).toBe(complex);
  });

  it("excludes colony rows — they belong to the undeveloped surface, not the ledger", () => {
    const colony: ConstructionProjectRow = {
      kind: "colony_establish", id: "c1", systemId: "s1", systemName: "Alpha", origin: "player",
      sourceSystemId: "s0", sourceSystemName: "Home", seedPop: 100, housingLevels: 1,
      progress: 0.5, workDone: 10, workTotal: 20, etaPulses: 2, nextPulseGain: 2,
    };
    expect(classifyGhosts([colony]).size).toBe(0);
  });
});
