import { describe, it, expect } from "vitest";
import { computeBuildOptions } from "@/lib/engine/build-options";
import { HOUSING_TYPE, VOCATIONAL_SCHOOL_TYPE, CONSTRUCTION_CENTRE_TYPE, BUILDING_TYPES } from "@/lib/constants/industry";
import { workCostPerLevel } from "@/lib/constants/construction";
import { emptyResourceVector } from "@/lib/engine/resources";

function sys(over: Partial<Parameters<typeof computeBuildOptions>[0]> = {}) {
  return {
    population: 500, buildings: {}, slotCap: emptyResourceVector(),
    generalSpace: 10, habitableSpace: 4, ...over,
  };
}
const byType = (opts: ReturnType<typeof computeBuildOptions>, t: string) => opts.find((o) => o.buildingType === t)!;

describe("computeBuildOptions", () => {
  it("caps housing by the tighter of habitable and general space, net of committed levels", () => {
    // habitable 4 → 4 housing levels max; 2 built + 1 committed → 1 addable.
    const opts = computeBuildOptions(sys({ buildings: { [HOUSING_TYPE]: 2 } }), { [HOUSING_TYPE]: 1 });
    const h = byType(opts, HOUSING_TYPE);
    expect(h.maxLevels).toBe(1);
    expect(h.blocked).toBeNull();
    expect(h.workPerLevel).toBe(workCostPerLevel(HOUSING_TYPE));
  });

  it("hard-blocks a general-space type when no footprint remains", () => {
    const full = sys({ generalSpace: 2, buildings: { [HOUSING_TYPE]: 2 } }); // habitable 4, general full
    const c = byType(computeBuildOptions(full, {}), CONSTRUCTION_CENTRE_TYPE);
    expect(c.maxLevels).toBe(0);
    expect(c.blocked).toBe("no_space");
  });

  it("caps an extractor by its deposit slots and reports no_deposit_slots at zero", () => {
    // Pick any tier-0 type from the catalog and grant 2 slots of its resource.
    const tier0 = Object.keys(BUILDING_TYPES).find((t) => BUILDING_TYPES[t].resource !== undefined)!;
    const resource = BUILDING_TYPES[tier0].resource!;
    const slotCap = { ...emptyResourceVector(), [resource]: 2 };
    const open = byType(computeBuildOptions(sys({ slotCap }), {}), tier0);
    expect(open.maxLevels).toBe(2);
    const exhausted = byType(computeBuildOptions(sys({ slotCap, buildings: { [tier0]: 2 } }), {}), tier0);
    expect(exhausted.maxLevels).toBe(0);
    expect(exhausted.blocked).toBe("no_deposit_slots");
  });

  it("reports the labour a level adds and a degraded staffing estimate on a tight population", () => {
    // Centre draws { unskilled: 18, skill1: 7 }; population 10 cannot staff it → estStaffing < 1.
    const tight = sys({ population: 10, buildings: { [VOCATIONAL_SCHOOL_TYPE]: 1 } });
    const c = byType(computeBuildOptions(tight, {}), CONSTRUCTION_CENTRE_TYPE);
    expect(c.labourAdded).toEqual(BUILDING_TYPES[CONSTRUCTION_CENTRE_TYPE].labour);
    expect(c.estStaffing).toBeLessThan(1);
    // Housing draws nobody — always fully "staffed".
    expect(byType(computeBuildOptions(tight, {}), HOUSING_TYPE).estStaffing).toBe(1);
  });
});
