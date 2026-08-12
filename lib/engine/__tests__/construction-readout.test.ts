import { describe, it, expect } from "vitest";
import { forecastEtaCycles, forecastIndependentEtaCycles } from "@/lib/engine/construction";
import type { WorldBuildProject } from "@/lib/world/types";
import {
  computeFactionConstruction, buildingLabel, describeBuildProject, nextCycleGains, foundingCeilings,
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
    charter: CHARTER,
    supplyBySource: new Map(),
    cover: COLONISATION.FOUNDING_STOCK_COVER,
    catchUp: 1, // the reference construction cadence — cap and staging share are unscaled
    writeOffCycles: COLONISATION.FOUNDING_STALL_COMPLETE_CYCLES,
    economyScale: 1,
    ...over,
  };
}

/** A stated charter fee — the money figures below are asserted, not recomputed through the pricing. */
const CHARTER = 100;

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
    expect(describeBuildProject(CONSTRUCTION_CENTRE_TYPE)).toBe("construction · adds faction build throughput");
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

  it("reads an unpaid charter the treasury cannot cover as awaiting_charter, with no ETA to promise", () => {
    // Materials are abundant but the fee is out of reach, so the project absorbs no work at all
    // until the money is there and any ETA the pool implies would be a fiction.
    const row = readColony(
      colony({ charterPaid: false }),
      founded({ workingBalance: CHARTER - 1, supplyBySource: fromSource(supply(1000)) }),
    );
    expect(row.stalledReason).toBe("awaiting_charter");
    expect(row.etaCycles).toBeNull();
    // The rate is a pool figure too: an unpaid charter absorbs nothing, whatever the pool offers.
    expect(row.nextCycleGain).toBe(0);
  });

  it("does not call a freshly ordered colony the treasury CAN pay for stalled", () => {
    // The charter phase pays for every colony the working balance covers, in the same cycle it is
    // ordered — so an unpaid charter on a solvent faction is a step about to happen, not a stall.
    // Reading it as one would brand every player order amber for its first cycle, on the very path
    // where the order service just proved the money was there.
    const row = readColony(
      colony({ charterPaid: false }),
      founded({ workingBalance: CHARTER * 100, supplyBySource: fromSource(supply(1000)) }),
    );
    expect(row.stalledReason).toBeNull();
    expect(row.etaCycles).not.toBeNull();
    expect(row.nextCycleGain).toBeGreaterThan(0);
  });

  it("prices the charter out of the balance before the materials it leaves behind", () => {
    // The tick pays the charter first and stages from what is left. A faction holding exactly the
    // fee can therefore buy the colony but none of its first slice — reading the whole balance as
    // available to the materials too would spend the same money twice and promise a rate it has not
    // got. Its counter is running, so the live tests are consulted.
    const rows = supply(1000);
    const want = projectedManifestWant(rows, SEED_POP, COLONISATION.FOUNDING_STOCK_COVER);
    const inputs = founded({
      workingBalance: CHARTER,
      supplyBySource: fromSource(rows),
    });
    expect(foundingGoodsValue(want, 1)).toBeGreaterThan(0); // the slice really does cost something

    const row = readColony(colony({ charterPaid: false, stalledCycles: 3 }), inputs);
    expect(row.stalledReason).toBe("awaiting_funds");
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

  it("reports awaiting_materials without calling it a stall — such a colony builds at full rate", () => {
    // The achievable-want rule counts what a founder cannot spare as satisfied, so the materials
    // ceiling stays at the full cap: the project keeps absorbing its whole pool share and opens with
    // a thinner endowment. Nulling its ETA would brand the fastest-moving state as stopped.
    const row = readColony(
      colony({ stalledCycles: 3 }),
      founded({ workingBalance: 10_000_000, supplyBySource: fromSource(supply(0)) }),
    );
    expect(row.stalledReason).toBe("awaiting_materials");
    expect(row.etaCycles).not.toBeNull();
    expect(row.etaCycles).toBeGreaterThan(0);
    expect(row.nextCycleGain).toBeGreaterThan(0);
  });

  it("retires a stale counter: refunded and merely queue-parked reads as waiting on nothing", () => {
    // `stalledCycles` resets only on a staging draw, and the pool-starvation guard refuses to
    // advance it — so a colony that went broke three cycles ago, was refunded, and now just sits
    // behind higher-ROI builds carries its counter for ever. The counter opens the question; the
    // live tests answer it, and here both pass.
    const row = readColony(
      colony({ stalledCycles: 3 }),
      founded({ workingBalance: 10_000_000, supplyBySource: fromSource(supply(1000)) }),
    );
    expect(row.stalledReason).toBeNull();
    expect(row.etaCycles).not.toBeNull();
    expect(row.nextCycleGain).toBeGreaterThan(0);
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

  it("gives a money-gated colony its reason even before the counter advances", () => {
    // The ceiling prices the coming cycle from the live position and never consults the counter —
    // so a colony whose faction spent the balance since its last successful draw forecasts a
    // ceiling of 0 (no ETA) this cycle, at a counter of 0. The reason must come from the same live
    // test the ceiling ran, or the row reads "this will never finish" and "nothing is wrong with
    // it" at once.
    const row = readColony(
      colony({ stalledCycles: 0 }),
      founded({ workingBalance: 0, supplyBySource: fromSource(supply(1000)) }),
    );
    expect(row.stalledReason).toBe("awaiting_funds");
    expect(row.etaCycles).toBeNull();
    expect(row.nextCycleGain).toBe(0);
  });

  it("does not call a colony that has written off its manifest stalled", () => {
    // Past the write-off threshold the remainder is given up, the materials ceiling stops binding
    // and the project finishes on construction work alone — while its counter stays latched above
    // the threshold for ever. Reading that counter as a stall would report a permanent standstill
    // for the rest of a build that is in fact the only one still moving.
    const row = readColony(
      colony({ stalledCycles: COLONISATION.FOUNDING_STALL_COMPLETE_CYCLES }),
      founded({ workingBalance: 0, supplyBySource: fromSource(supply(0)) }),
    );
    expect(row.stalledReason).toBeNull();
    expect(row.etaCycles).not.toBeNull();
    expect(row.nextCycleGain).toBeGreaterThan(0);
  });

  it("passes the pool a gated colony cannot absorb through to the rows behind it", () => {
    // The tick holds a colony whose materials the treasury cannot buy at a ceiling of zero and funds
    // the next row from what it leaves. A forecast that funded every project at the scalar cap would
    // have the gated colony swallow the whole pool, and the build behind it would read a rate of 0
    // and an ETA it will beat by cycles — the common case, since a charter-paid colony sits in the
    // committed prefix ahead of the queue.
    const onePool: ConstructionSystemInfo[] = [
      { id: "src", name: "Vela Prime", control: "developed", population: 80, buildings: {} },
      { id: "ctrl", name: "Kepler Reach", control: "controlled", population: 0, buildings: {} },
    ];
    const gatedThenBuild: WorldConstructionProject[] = [
      colony({ stalledCycles: 3 }),
      { kind: "build", id: "behind", origin: "auto", factionId: "f1", systemId: "src",
        buildingType: "housing", levels: 1, workTotal: 100, workDone: 0 },
    ];
    const r = computeFactionConstruction(
      gatedThenBuild, onePool, { throughputPerPop: 0.05, pointsPerLevel: 5 }, 4,
      founded({ workingBalance: 0, supplyBySource: fromSource(supply(1000)) }),
    );
    expect(r.pool).toBeCloseTo(4, 6); // exactly one cap: whoever takes it, the other gets nothing

    const gated = r.all.find((row) => row.id === "c1");
    const behind = r.all.find((row) => row.id === "behind");
    if (!gated || !behind) throw new Error("fixture: expected both rows");
    expect(gated.nextCycleGain).toBe(0);
    expect(gated.etaCycles).toBeNull();
    expect(behind.nextCycleGain).toBe(4); // its full cap — the tick would fund it, so the forecast does
    expect(behind.etaCycles).toBe(25);    // 100 work ÷ 4 per cycle, undisturbed by the colony ahead
  });

  it("sizes the staging share off the cadence-scaled cap the tick paces staging on", () => {
    const rows = supply(1000);
    const want = projectedManifestWant(rows, SEED_POP, COLONISATION.FOUNDING_STOCK_COVER);
    // The fixture colony has 60 work left of 100, so one reference cycle's cap (4) buys 4% of it.
    const referenceShare = foundingGoodsValue(want, 1) * (4 / 100);
    // One and a half reference slices: comfortably over one, comfortably under two.
    const purse = (catchUp: number) =>
      founded({ workingBalance: referenceShare * 1.5, catchUp, supplyBySource: fromSource(rows) });

    // At the reference construction cadence the balance covers that slice exactly.
    expect(readColony(colony({ stalledCycles: 3 }), purse(1)).stalledReason).toBeNull();
    // Run construction half as often and each resolution builds twice as much, so it asks for twice
    // the materials and the same purse no longer covers it. Sized off the unscaled cap both arms
    // read alike and the readout quotes a slice the tick never draws.
    expect(readColony(colony({ stalledCycles: 3 }), purse(2)).stalledReason).toBe("awaiting_funds");
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

describe("construction readout — ceilings, progress and ordering", () => {
  const SEED_POP = 2;
  const systems: ConstructionSystemInfo[] = [
    { id: "src", name: "Source", control: "developed", population: 100, buildings: {} },
    { id: "ctrl", name: "Kepler Reach", control: "controlled", population: 0, buildings: {} },
    { id: "ctrl2", name: "Alpha Reach", control: "controlled", population: 0, buildings: {} },
  ];

  function colonyRow(over: Partial<WorldColonyEstablishProject> = {}): WorldColonyEstablishProject {
    return {
      kind: "colony_establish", id: "c1", origin: "auto", factionId: "f1", systemId: "ctrl",
      sourceSystemId: "src", seedPop: SEED_POP, housingLevels: 1, workTotal: 100, workDone: 40,
      stagedManifest: [], charterPaid: true, stalledCycles: 0, ...over,
    };
  }
  const from = (rows: FoundingSourceSupply[]) => new Map([["src", rows]]);

  it("holds a colony at zero absorption while its unpaid charter is out of reach, and lets it move the moment the balance reaches the fee", () => {
    // A source with nothing to spare: the achievable-want rule counts what cannot be spared as
    // satisfied, so the charter is the only thing that can hold the ceiling down here.
    const bare = supply(0);
    const unaffordable = foundingCeilings(
      [colonyRow({ charterPaid: false })],
      founded({ workingBalance: CHARTER - 1, supplyBySource: from(bare) }), 4,
    );
    expect(unaffordable.get("c1")).toBe(0);
    // Exactly the fee IS affordable — the cut is a strict "costs more than we have".
    const exactly = foundingCeilings(
      [colonyRow({ charterPaid: false })],
      founded({ workingBalance: CHARTER, supplyBySource: from(bare) }), 4,
    );
    expect(exactly.get("c1")).toBe(4);
  });

  it("stops ceilinging a colony that has written its manifest off — at the write-off cycle itself", () => {
    const inputs = founded({ workingBalance: 0, supplyBySource: from(supply(1000)), writeOffCycles: 5 });
    // One cycle short of the write-off it is still materials-gated …
    expect(foundingCeilings([colonyRow({ stalledCycles: 4 })], inputs, 4).has("c1")).toBe(true);
    // … and at the write-off cycle it runs on work alone, with no ceiling recorded at all.
    expect(foundingCeilings([colonyRow({ stalledCycles: 5 })], inputs, 4).has("c1")).toBe(false);
  });

  it("sizes this cycle's staging off the work REMAINING, so a nearly-finished founding asks for less", () => {
    // A purse that cannot buy a whole slice: the ceiling is then the fraction of the ask it covers,
    // and the ask scales with the share of the establish this cycle would build.
    const rows = supply(1000);
    const inputs = founded({ workingBalance: 1, supplyBySource: from(rows) });
    const ceilingFor = (workDone: number) =>
      foundingCeilings([colonyRow({ workDone })], inputs, 1000).get("c1") ?? 0;
    expect(ceilingFor(0)).toBeGreaterThan(0);
    expect(ceilingFor(90)).toBeGreaterThan(ceilingFor(0));
  });

  it("reads a zero-work project as zero progress rather than NaN", () => {
    const zeroWork: WorldConstructionProject = {
      kind: "build", id: "z", origin: "auto", factionId: "f1", systemId: "src",
      buildingType: "housing", levels: 1, workTotal: 0, workDone: 0,
    };
    const r = computeFactionConstruction([zeroWork], systems, { throughputPerPop: 0.05, pointsPerLevel: 5 }, 4, founded());
    expect(r.buildOut[0]!.progress).toBe(0);
  });

  it("orders the expansion list soonest-ETA-first, independent of input order", () => {
    const inputs = founded({ supplyBySource: from(supply(1000)) });
    const slowThenFast: WorldConstructionProject[] = [
      colonyRow({ id: "slow", systemId: "ctrl", workTotal: 200, workDone: 0 }),
      colonyRow({ id: "fast", systemId: "ctrl2", workTotal: 20, workDone: 0 }),
    ];
    const r = computeFactionConstruction(slowThenFast, systems, { throughputPerPop: 0.5, pointsPerLevel: 5 }, 4, inputs);
    expect(r.expansion.map((p) => p.id)).toEqual(["fast", "slow"]);
    expect(r.expansion[0]!.etaCycles).not.toBeNull();
  });
});

describe("computeFactionConstruction — fundedFront / waitingCount", () => {
  const oneSystem: ConstructionSystemInfo[] = [
    { id: "dev1", name: "Vela Prime", control: "developed", population: 80, buildings: {} },
  ];

  it("excludes a zero-gain project from the front and counts it in waitingCount", () => {
    // pool === cap (4): only the front build is funded this cycle, the back build gets 0.
    const twoBuilds: WorldConstructionProject[] = [
      { kind: "build", id: "front", origin: "auto", factionId: "f1", systemId: "dev1", buildingType: "housing", levels: 1, workTotal: 8, workDone: 0 },
      { kind: "build", id: "back", origin: "auto", factionId: "f1", systemId: "dev1", buildingType: "housing", levels: 1, workTotal: 8, workDone: 0 },
    ];
    const r = computeFactionConstruction(twoBuilds, oneSystem, { throughputPerPop: 0.05, pointsPerLevel: 5 }, 4, founded());
    expect(r.pool).toBeCloseTo(4, 6);
    expect(r.fundedFront.map((f) => f.projectId)).toEqual(["front"]);
    expect(r.waitingCount).toBe(1);
  });

  it("excludes a materials-gated colony (capFor ceiling 0) from the front, not listed at zero progress", () => {
    // Charter unpaid and unaffordable → foundingCeilings holds this colony at a ceiling of 0, so its
    // nextCycleGain is 0 even though it already has real progress (workDone 40 of 100). The build
    // behind it inherits the pool the colony was never going to consume.
    const systems: ConstructionSystemInfo[] = [
      { id: "src", name: "Vela Prime", control: "developed", population: 80, buildings: {} },
      { id: "ctrl", name: "Kepler Reach", control: "controlled", population: 0, buildings: {} },
    ];
    const gatedColony: WorldColonyEstablishProject = {
      kind: "colony_establish", id: "c1", origin: "auto", factionId: "f1", systemId: "ctrl",
      sourceSystemId: "src", seedPop: 2, housingLevels: 1, workTotal: 100, workDone: 40,
      stagedManifest: [], charterPaid: false, stalledCycles: 3,
    };
    const behindBuild: WorldConstructionProject = {
      kind: "build", id: "behind", origin: "auto", factionId: "f1", systemId: "src",
      buildingType: "housing", levels: 1, workTotal: 100, workDone: 0,
    };
    const r = computeFactionConstruction(
      [gatedColony, behindBuild], systems, { throughputPerPop: 0.05, pointsPerLevel: 5 }, 4,
      founded({ workingBalance: CHARTER - 1, supplyBySource: new Map([["src", supply(1000)]]) }),
    );
    expect(r.fundedFront.map((f) => f.projectId)).toEqual(["behind"]);
    expect(r.fundedFront.some((f) => f.projectId === "c1")).toBe(false);
    expect(r.waitingCount).toBe(1);
    // Sanity: the colony really does have nonzero progress — absence is about this cycle's gain,
    // not about progress being zero.
    const gatedRow = r.all.find((row) => row.id === "c1");
    expect(gatedRow?.progress).toBeCloseTo(0.4, 6);
  });

  it("keeps fundedFront.length + waitingCount equal to the open-project count, including a project the pool lands outright", () => {
    // "landing": remaining work (2) is less than the cap (4), so the project completes this cycle —
    // it still appears once in `projects` (a real tick would drop it, but the forecast is read over
    // the STORED queue as of now) and its gain is its remaining work, not the cap.
    const landsOutright: WorldConstructionProject = {
      kind: "build", id: "lands", origin: "auto", factionId: "f1", systemId: "dev1",
      buildingType: "housing", levels: 1, workTotal: 20, workDone: 18,
    };
    const midFront: WorldConstructionProject = {
      kind: "build", id: "mid", origin: "auto", factionId: "f1", systemId: "dev1",
      buildingType: "housing", levels: 1, workTotal: 8, workDone: 0,
    };
    const waitsAtBack: WorldConstructionProject = {
      kind: "build", id: "back", origin: "auto", factionId: "f1", systemId: "dev1",
      buildingType: "housing", levels: 1, workTotal: 8, workDone: 0,
    };
    const projects = [landsOutright, midFront, waitsAtBack];
    const r = computeFactionConstruction(projects, oneSystem, { throughputPerPop: 0.05, pointsPerLevel: 5 }, 4, founded());
    expect(r.pool).toBeCloseTo(4, 6); // exactly one cap: lands (2) + mid (2), back gets nothing
    expect(r.fundedFront.map((f) => f.projectId)).toEqual(["lands", "mid"]);
    expect(r.waitingCount).toBe(1);
    expect(r.fundedFront.length + r.waitingCount).toBe(projects.length);
  });

  it("yields an empty front and a zero waitingCount for an empty queue", () => {
    const r = computeFactionConstruction([], oneSystem, { throughputPerPop: 0.05, pointsPerLevel: 5 }, 4, founded());
    expect(r.fundedFront).toEqual([]);
    expect(r.waitingCount).toBe(0);
  });

  it("preserves queue order in the front rather than re-sorting by progress", () => {
    // Ample pool funds both in parallel this cycle (front stays queue-ordered) even though the
    // higher-progress project was inserted second.
    const lowProgressFirst: WorldConstructionProject = {
      kind: "build", id: "low", origin: "auto", factionId: "f1", systemId: "dev1",
      buildingType: "housing", levels: 1, workTotal: 20, workDone: 0,
    };
    const highProgressSecond: WorldConstructionProject = {
      kind: "build", id: "high", origin: "auto", factionId: "f1", systemId: "dev1",
      buildingType: "housing", levels: 1, workTotal: 20, workDone: 16,
    };
    const ampleSystem: ConstructionSystemInfo[] = [
      { id: "dev1", name: "Vela Prime", control: "developed", population: 400, buildings: {} },
    ];
    const r = computeFactionConstruction(
      [lowProgressFirst, highProgressSecond], ampleSystem,
      { throughputPerPop: 0.05, pointsPerLevel: 5 }, 4, founded(),
    );
    expect(r.pool).toBeGreaterThan(8); // enough to fund both at full cap this cycle
    expect(r.fundedFront.map((f) => f.projectId)).toEqual(["low", "high"]);
  });

  it("produces an empty front while waitingCount still counts every open project when the pool is zero", () => {
    const twoBuilds: WorldConstructionProject[] = [
      { kind: "build", id: "a", origin: "auto", factionId: "f1", systemId: "dev1", buildingType: "housing", levels: 1, workTotal: 8, workDone: 0 },
      { kind: "build", id: "b", origin: "auto", factionId: "f1", systemId: "dev1", buildingType: "housing", levels: 1, workTotal: 8, workDone: 0 },
    ];
    // throughputPerPop 0 zeroes the pool regardless of population.
    const r = computeFactionConstruction(twoBuilds, oneSystem, { throughputPerPop: 0, pointsPerLevel: 0 }, 4, founded());
    expect(r.pool).toBe(0);
    expect(r.fundedFront).toEqual([]);
    expect(r.waitingCount).toBe(2);
  });

  it("labels a build row with type and level count, and a colony row as Establish Colony", () => {
    const build: WorldConstructionProject = {
      kind: "build", id: "hb", origin: "auto", factionId: "f1", systemId: "dev1",
      buildingType: "housing", levels: 3, workTotal: 8, workDone: 0,
    };
    const r = computeFactionConstruction([build], oneSystem, { throughputPerPop: 0.05, pointsPerLevel: 5 }, 4, founded());
    expect(r.fundedFront[0]?.label).toBe("Housing ×3");
  });
});
