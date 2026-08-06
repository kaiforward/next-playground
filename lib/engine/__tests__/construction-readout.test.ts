import { describe, it, expect } from "vitest";
import { forecastEtaCycles, forecastIndependentEtaCycles } from "@/lib/engine/construction";
import type { WorldBuildProject } from "@/lib/world/types";
import {
  computeFactionConstruction, buildingLabel, describeBuildProject, nextCycleGains,
  type ConstructionSystemInfo, type FoundingReadoutInputs,
} from "@/lib/engine/construction-readout";
import {
  foundingGoodsValue, projectedManifestWant, type FoundingSourceSupply,
} from "@/lib/engine/founding-cost";
import type { WorldColonyEstablishProject, WorldConstructionProject } from "@/lib/world/types";
import { COLONISATION } from "@/lib/constants/colonisation";
import {
  RESEARCH_INSTITUTE_TYPE, COMPLEX_BY_TYPE, HEAVY_INDUSTRY_COMPLEX, CONSTRUCTION_CENTRE_TYPE, VOCATIONAL_SCHOOL_TYPE,
} from "@/lib/constants/industry";
import { GOODS } from "@/lib/constants/goods";

function build(id: string, workTotal: number, workDone: number): WorldBuildProject {
  return { kind: "build", id, origin: "auto", factionId: "f1", systemId: "s1", buildingType: "housing", levels: 1, workTotal, workDone };
}

/** A faction with money and a source that can spare anything — the "nothing is holding it up" case. */
function founded(over: Partial<FoundingReadoutInputs> = {}): FoundingReadoutInputs {
  return {
    workingBalance: 1_000_000,
    supplyBySource: new Map(),
    cover: COLONISATION.FOUNDING_STOCK_COVER,
    economyScale: 1,
    ...over,
  };
}

/** A source's rows, all of them drawable up to `sparable` (0 = it can spare nothing). */
function supply(sparable: number, goodIds = ["water", "food"]): FoundingSourceSupply[] {
  return goodIds.map((goodId) => ({ goodId, sparable }));
}

describe("forecastEtaCycles", () => {
  it("funds front-first: the head project lands before the tail", () => {
    // cap 4, pool 4 → only 4 points/cycle, all to the head until it lands.
    const eta = forecastEtaCycles([build("a", 8, 0), build("b", 8, 0)], 4, 4);
    expect(eta).toEqual([2, 4]);
  });

  it("spreads leftover pool across parallel fronts", () => {
    // cap 4, pool 8 → 4 to each per cycle; both land on cycle 2.
    const eta = forecastEtaCycles([build("a", 8, 0), build("b", 8, 0)], 8, 4);
    expect(eta).toEqual([2, 2]);
  });

  it("returns null (stalled) for every project when the pool is zero", () => {
    expect(forecastEtaCycles([build("a", 8, 0)], 0, 4)).toEqual([null]);
  });

  it("returns null past the guard cap without spinning", () => {
    // Huge work, tiny pool that still funds → guard trims it to stalled at maxCycles.
    expect(forecastEtaCycles([build("a", 100000, 0)], 1, 4, 5)).toEqual([null]);
  });
});

describe("forecastIndependentEtaCycles", () => {
  it("matches forecastEtaCycles called once per hypothetical (no cross-hypothetical interference)", () => {
    // Two committed rows drain most of the pool for several cycles; two hypotheticals of DIFFERENT
    // sizes probe "what if I ordered just this one" — each should land exactly where a solo
    // forecastEtaCycles([...committed, thatOneHypothetical]) call would land it, not queued behind
    // the other hypothetical (they never actually compete for the same pool-share).
    const committed = [build("c1", 20, 0), build("c2", 20, 0)];
    const hypA = build("hA", 12, 0);
    const hypB = build("hB", 4, 0);
    const pool = 6;
    const cap = 4;

    const [etaA, etaB] = forecastIndependentEtaCycles(committed, [hypA, hypB], pool, cap);
    const soloA = forecastEtaCycles([...committed, hypA], pool, cap);
    const soloB = forecastEtaCycles([...committed, hypB], pool, cap);
    expect(etaA).toBe(soloA[soloA.length - 1]);
    expect(etaB).toBe(soloB[soloB.length - 1]);
    // Sanity: with only cap 4 and pool 6, the committed pair alone doesn't exhaust the pool every
    // cycle (leftover 2/cycle while both are open), so both hypotheticals actually get funded before
    // either committed row lands — proving they aren't silently starved by being "hoisted".
    expect(etaA).not.toBeNull();
    expect(etaB).not.toBeNull();
  });

  it("returns null for every hypothetical when the pool is zero", () => {
    expect(forecastIndependentEtaCycles([build("c1", 8, 0)], [build("h", 8, 0)], 0, 4)).toEqual([null]);
  });

  it("lands a zero-work hypothetical on cycle 1 regardless of the committed queue", () => {
    const committed = [build("c1", 1000, 0)];
    const zeroWork = build("h", 0, 0);
    expect(forecastIndependentEtaCycles(committed, [zeroWork], 4, 4)).toEqual([1]);
  });

  it("returns an empty array for an empty hypothetical list", () => {
    expect(forecastIndependentEtaCycles([build("c1", 8, 0)], [], 4, 4)).toEqual([]);
  });
});

describe("nextCycleGains", () => {
  it("funds front-first: the head project takes the whole pool, the tail waits", () => {
    expect(nextCycleGains([build("a", 8, 0), build("b", 8, 0)], 4, 4)).toEqual([4, 0]);
  });

  it("spreads leftover pool across parallel fronts", () => {
    expect(nextCycleGains([build("a", 8, 0), build("b", 8, 0)], 8, 4)).toEqual([4, 4]);
  });

  it("is pool-limited: front gets its full cap, tail gets only what's left", () => {
    expect(nextCycleGains([build("a", 8, 0), build("b", 8, 0)], 6, 4)).toEqual([4, 2]);
  });

  it("caps a near-complete project at its remaining work, not the full cap", () => {
    expect(nextCycleGains([build("a", 20, 18)], 4, 4)).toEqual([2]);
  });

  it("returns 0 for every project when the pool is zero", () => {
    expect(nextCycleGains([build("a", 8, 0)], 0, 4)).toEqual([0]);
  });
});

describe("buildingLabel / describeBuildProject", () => {
  it("labels the three named building types", () => {
    expect(buildingLabel("housing")).toBe("Housing");
    expect(buildingLabel("vocational_school")).toBe("Vocational School");
    expect(buildingLabel(RESEARCH_INSTITUTE_TYPE)).toBe("Research Institute");
    expect(describeBuildProject("housing")).toContain("population capacity");
    expect(describeBuildProject("vocational_school")).toContain("technician");
    expect(describeBuildProject(RESEARCH_INSTITUTE_TYPE)).toContain("engineer");
  });

  it("labels a specialisation complex from its family", () => {
    const label = COMPLEX_BY_TYPE[HEAVY_INDUSTRY_COMPLEX].label;
    expect(buildingLabel(HEAVY_INDUSTRY_COMPLEX)).toBe(label);
    expect(describeBuildProject(HEAVY_INDUSTRY_COMPLEX)).toBe(`specialisation · anchors ${label} yield`);
  });

  it("falls back to the good name for a plain good type", () => {
    expect(buildingLabel("ore")).toBe(GOODS.ore.name);
    expect(describeBuildProject("ore")).toBe(`industry · produces ${GOODS.ore.name}`);
  });

  it("falls back to the raw type id when it is neither academy, complex, nor good", () => {
    expect(buildingLabel("mystery_structure")).toBe("mystery_structure");
    expect(describeBuildProject("mystery_structure")).toBe("industry · produces mystery_structure");
  });
});

describe("computeFactionConstruction", () => {
  const systems: ConstructionSystemInfo[] = [
    { id: "dev1", name: "Vela Prime", control: "developed", population: 100, buildings: {} },
    { id: "dev2", name: "Corvus Gate", control: "developed", population: 50, buildings: {} },
    { id: "ctrl", name: "Kepler Reach", control: "controlled", population: 0, buildings: {} },
  ];
  const projects: WorldConstructionProject[] = [
    { kind: "colony_establish", id: "c1", origin: "auto", factionId: "f1", systemId: "ctrl", sourceSystemId: "dev1", seedPop: 340, housingLevels: 3, workTotal: 100, workDone: 62, stagedManifest: [], charterPaid: true, stalledCycles: 0 },
    { kind: "build", id: "b1", origin: "auto", factionId: "f1", systemId: "dev1", buildingType: "housing", levels: 4, workTotal: 40, workDone: 32 },
  ];

  it("pools only economically-active systems and splits expansion vs build-out", () => {
    const r = computeFactionConstruction(projects, systems, { throughputPerPop: 0.05, pointsPerLevel: 5 }, 4, founded());
    expect(r.pool).toBeCloseTo((100 + 50) * 0.05, 6); // controlled pop 0 contributes nothing
    expect(r.expandCount).toBe(1);
    expect(r.buildCount).toBe(1);
    expect(r.expansion[0].kind).toBe("colony_establish");
    expect(r.expansion[0].sourceSystemName).toBe("Vela Prime");
    expect(r.expansion[0].systemName).toBe("Kepler Reach");
    expect(r.expansion[0].progress).toBeCloseTo(0.62, 6);
    expect(r.buildOut[0].buildingLabel).toBe("Housing");
    expect(r.buildOut[0].progress).toBeCloseTo(0.8, 6);
    expect(r.buildOut[0].etaCycles === null || typeof r.buildOut[0].etaCycles === "number").toBe(true);
  });

  it("attaches nextCycleGain: a funded front row gets its cap, a starved back row gets 0", () => {
    // Single developed system sized so pool === cap: only the front build can be funded this cycle.
    const oneSystem: ConstructionSystemInfo[] = [
      { id: "dev1", name: "Vela Prime", control: "developed", population: 80, buildings: {} },
    ];
    const twoBuilds: WorldConstructionProject[] = [
      { kind: "build", id: "front", origin: "auto", factionId: "f1", systemId: "dev1", buildingType: "housing", levels: 1, workTotal: 8, workDone: 0 },
      { kind: "build", id: "back", origin: "auto", factionId: "f1", systemId: "dev1", buildingType: "housing", levels: 1, workTotal: 8, workDone: 0 },
    ];
    const r = computeFactionConstruction(twoBuilds, oneSystem, { throughputPerPop: 0.05, pointsPerLevel: 5 }, 4, founded());
    expect(r.pool).toBeCloseTo(4, 6);
    const front = r.all.find((p) => p.id === "front");
    const back = r.all.find((p) => p.id === "back");
    if (!front || !back) throw new Error("fixture: expected both rows");
    expect(front.nextCycleGain).toBe(4); // its full cap
    expect(back.nextCycleGain).toBe(0); // pool exhausted by the front — waiting
  });

  it("orders buildOut soonest-ETA-first, independent of input order", () => {
    // Ample pool (> cap × count) funds both projects in parallel each cycle, so ETA is purely
    // remaining-work ÷ cap — "slow" (16 work) lands later than "fast" (8 work) regardless of which
    // comes first in the input queue.
    const oneSystem: ConstructionSystemInfo[] = [
      { id: "s1", name: "Only System", control: "developed", population: 400, buildings: {} },
    ];
    const slowThenFast: WorldConstructionProject[] = [build("slow", 16, 0), build("fast", 8, 0)];
    const r = computeFactionConstruction(slowThenFast, oneSystem, { throughputPerPop: 0.05, pointsPerLevel: 5 }, 4, founded());
    expect(r.pool).toBeCloseTo(20, 6);
    expect(r.buildOut.map((p) => p.id)).toEqual(["fast", "slow"]);
  });

  it("falls back to systemName when ETAs tie (an all-stalled, pool-zero faction)", () => {
    const twoNamedSystems: ConstructionSystemInfo[] = [
      { id: "sysZ", name: "Zeta System", control: "developed", population: 10, buildings: {} },
      { id: "sysA", name: "Alpha System", control: "developed", population: 10, buildings: {} },
    ];
    // Same-kind projects on differently-named systems, inserted in reverse-alphabetical order.
    const zetaThenAlpha: WorldConstructionProject[] = [
      { kind: "build", id: "pZ", origin: "auto", factionId: "f1", systemId: "sysZ", buildingType: "housing", levels: 1, workTotal: 8, workDone: 0 },
      { kind: "build", id: "pA", origin: "auto", factionId: "f1", systemId: "sysA", buildingType: "housing", levels: 1, workTotal: 8, workDone: 0 },
    ];
    // throughputPerPop 0 zeroes the pool regardless of population — every project stalls (etaCycles null).
    const r = computeFactionConstruction(zetaThenAlpha, twoNamedSystems, { throughputPerPop: 0, pointsPerLevel: 0 }, 4, founded());
    expect(r.pool).toBe(0);
    expect(r.buildOut.every((p) => p.etaCycles === null)).toBe(true);
    expect(r.buildOut.map((p) => p.systemName)).toEqual(["Alpha System", "Zeta System"]);
  });

  it("splits the pool into base and centre components", () => {
    const systems = [
      { id: "s1", name: "Alpha", control: "developed" as const, population: 200,
        buildings: { [CONSTRUCTION_CENTRE_TYPE]: 1, [VOCATIONAL_SCHOOL_TYPE]: 1 } },
    ];
    const r = computeFactionConstruction([], systems, { throughputPerPop: 0.05, pointsPerLevel: 5 }, 4, founded());
    expect(r.poolCentres).toBeCloseTo(5);          // fully staffed centre
    expect(r.poolBase).toBeCloseTo((200 - 7) * 0.05); // its technicians left the base
    expect(r.pool).toBeCloseTo(r.poolBase + r.poolCentres);
  });

  it("labels a centre build project", () => {
    expect(buildingLabel(CONSTRUCTION_CENTRE_TYPE)).toBe("Construction Centre");
    expect(describeBuildProject(CONSTRUCTION_CENTRE_TYPE)).toContain("construction");
  });

  it("carries each project's origin through to its row", () => {
    const originProjects: WorldConstructionProject[] = [
      { kind: "build", id: "a", factionId: "f1", systemId: "dev1", origin: "auto",
        buildingType: "housing", levels: 1, workTotal: 10, workDone: 0 },
      { kind: "build", id: "b", factionId: "f1", systemId: "dev1", origin: "player",
        buildingType: "housing", levels: 1, workTotal: 10, workDone: 0 },
    ];
    const r = computeFactionConstruction(originProjects, systems, { throughputPerPop: 0.05, pointsPerLevel: 5 }, 4, founded());
    expect(r.all.map((row) => row.origin)).toEqual(["auto", "player"]);
    expect(r.all.every((row) => row.kind === "build" && row.buildingType === "housing")).toBe(true);
  });
});

describe("computeFactionConstruction — why a founding is stuck", () => {
  // A source with pool to spare (20/cycle against a cap of 4), so nothing a colony waits on here is
  // ever the construction pool: every stall below is priced, and every finite ETA is a real forecast.
  const systems: ConstructionSystemInfo[] = [
    { id: "src", name: "Vela Prime", control: "developed", population: 400, buildings: {} },
    { id: "ctrl", name: "Kepler Reach", control: "controlled", population: 0, buildings: {} },
  ];
  const SEED_POP = 2;

  function colony(over: Partial<WorldColonyEstablishProject> = {}): WorldColonyEstablishProject {
    return {
      kind: "colony_establish", id: "c1", origin: "auto", factionId: "f1", systemId: "ctrl",
      sourceSystemId: "src", seedPop: SEED_POP, housingLevels: 1, workTotal: 100, workDone: 40,
      stagedManifest: [], charterPaid: true, stalledCycles: 0, ...over,
    };
  }

  function readColony(p: WorldColonyEstablishProject, founding: FoundingReadoutInputs) {
    const r = computeFactionConstruction(
      [p], systems, { throughputPerPop: 0.05, pointsPerLevel: 5 }, 4, founding,
    );
    const row = r.expansion[0];
    if (row === undefined) throw new Error("fixture: expected one colony row");
    return row;
  }

  const fromSource = (rows: FoundingSourceSupply[]) => new Map([["src", rows]]);

  it("reads an unpaid charter as awaiting_charter, with no ETA to promise", () => {
    // Money and materials are both abundant — only the charter is outstanding, and until it is paid
    // the project absorbs no work at all, so any ETA the pool implies would be a fiction.
    const row = readColony(
      colony({ charterPaid: false }),
      founded({ supplyBySource: fromSource(supply(1000)) }),
    );
    expect(row.stalledReason).toBe("awaiting_charter");
    expect(row.etaCycles).toBeNull();
    // The rate is a pool figure too: an unpaid charter absorbs nothing, whatever the pool offers.
    expect(row.nextCycleGain).toBe(0);
  });

  it("reads a colony that nothing is holding up as unstalled, with a finite ETA", () => {
    const row = readColony(colony(), founded({ supplyBySource: fromSource(supply(1000)) }));
    expect(row.stalledReason).toBeNull();
    expect(row.etaCycles).not.toBeNull();
    expect(row.etaCycles).toBeGreaterThan(0);
    expect(row.nextCycleGain).toBeGreaterThan(0);
  });

  it("reads a stall the working balance cannot pay for as awaiting_funds", () => {
    const row = readColony(
      colony({ stalledCycles: 3 }),
      founded({ workingBalance: 0, supplyBySource: fromSource(supply(1000)) }),
    );
    expect(row.stalledReason).toBe("awaiting_funds");
    expect(row.etaCycles).toBeNull();
  });

  it("reads a stall at a source with nothing to spare as awaiting_materials, however rich the faction", () => {
    const row = readColony(
      colony({ stalledCycles: 3 }),
      founded({ workingBalance: 10_000_000, supplyBySource: fromSource(supply(0)) }),
    );
    expect(row.stalledReason).toBe("awaiting_materials");
    expect(row.etaCycles).toBeNull();
  });

  it("does not call a colony merely out-competed for the pool stalled", () => {
    // The counter only advances on a MATERIALS or MONEY stall; a cycle the construction pool never
    // reached leaves it at 0. Such a colony's story is a long ETA, not a reason it cannot proceed —
    // reading "awaiting funds" off a penniless faction that was never asked to pay would be a lie.
    const row = readColony(
      colony({ stalledCycles: 0 }),
      founded({ workingBalance: 0, supplyBySource: fromSource(supply(0)) }),
    );
    expect(row.stalledReason).toBeNull();
    expect(row.etaCycles).not.toBeNull();
  });

  it("reports the staged share of the manifest, weighted by what the goods cost", () => {
    const cover = COLONISATION.FOUNDING_STOCK_COVER;
    const rows = supply(1000);
    const want = projectedManifestWant(rows, SEED_POP, cover);
    const waterOnly = want.filter((l) => l.goodId === "water");
    const inputs = founded({ supplyBySource: fromSource(rows) });

    expect(readColony(colony(), inputs).stagedFraction).toBe(0);
    expect(readColony(colony({ stagedManifest: want }), inputs).stagedFraction).toBeCloseTo(1, 6);

    // One of the two goods carried in full is NOT half the manifest — water and food cost different
    // money, and the share is what has been bought, not how many lines are ticked off.
    const partial = readColony(colony({ stagedManifest: waterOnly }), inputs).stagedFraction;
    expect(partial).toBeCloseTo(
      foundingGoodsValue(waterOnly, 1) / foundingGoodsValue(want, 1), 6,
    );
    expect(partial).toBeGreaterThan(0);
    expect(partial).toBeLessThan(1);
  });
});
