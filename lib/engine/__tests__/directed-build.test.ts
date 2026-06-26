import { describe, it, expect } from "vitest";
import { systemBuildGeneration, findStructuralDeficits, type BuildSystemState } from "@/lib/engine/directed-build";
import { DIRECTED_BUILD } from "@/lib/constants/directed-build";
import { emptyResourceVector } from "@/lib/engine/resources";
import type { RouteCost } from "@/lib/engine/directed-logistics";

describe("systemBuildGeneration", () => {
  it("scales the build budget linearly with population", () => {
    expect(systemBuildGeneration(100)).toBeCloseTo(100 * DIRECTED_BUILD.GENERATION_PER_POP);
  });

  it("never returns a negative budget", () => {
    expect(systemBuildGeneration(-50)).toBe(0);
    expect(systemBuildGeneration(0)).toBe(0);
  });
});

function buildSys(
  systemId: string,
  good: { goodId: string; stock: number; targetStock: number; demand: number },
): BuildSystemState {
  return {
    systemId, factionId: "f1", population: 100, buildings: {},
    slotCap: emptyResourceVector(), generalSpace: 0, habitableSpace: 0, goods: [good],
  };
}

const reachable: RouteCost = () => 1;
const unreachable: RouteCost = () => null;

describe("findStructuralDeficits", () => {
  it("flags a deficit as structural when no surplus of that good is reachable", () => {
    const deficit = buildSys("A", { goodId: "electronics", stock: 1, targetStock: 10, demand: 4 });
    const out = findStructuralDeficits([deficit], reachable);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ systemId: "A", goodId: "electronics", shortfall: 9, demand: 4 });
  });

  it("excludes a deficit when a reachable surplus of that good exists", () => {
    const deficit = buildSys("A", { goodId: "food", stock: 1, targetStock: 10, demand: 4 });
    const surplus = buildSys("B", { goodId: "food", stock: 100, targetStock: 50, demand: 4 });
    expect(findStructuralDeficits([deficit, surplus], reachable)).toHaveLength(0);
  });

  it("keeps a deficit structural when the only surplus is unreachable", () => {
    const deficit = buildSys("A", { goodId: "food", stock: 1, targetStock: 10, demand: 4 });
    const surplus = buildSys("B", { goodId: "food", stock: 100, targetStock: 50, demand: 4 });
    expect(findStructuralDeficits([deficit, surplus], unreachable)).toHaveLength(1);
  });

  it("does not treat a balanced or surplus market as a deficit", () => {
    const balanced = buildSys("A", { goodId: "ore", stock: 10, targetStock: 10, demand: 4 });
    expect(findStructuralDeficits([balanced], reachable)).toHaveLength(0);
  });
});
