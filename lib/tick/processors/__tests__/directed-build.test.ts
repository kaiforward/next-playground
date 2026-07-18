import { describe, it, expect } from "vitest";
import { runDirectedBuildProcessor } from "@/lib/tick/processors/directed-build";
import { MemoryDirectedBuildWorld } from "@/lib/tick/adapters/memory/directed-build";
import type { SystemBuildRow } from "@/lib/tick/world/directed-build-world";
import type { MarketRowForLogistics } from "@/lib/tick/world/directed-logistics-world";
import type { WorldConstructionProject } from "@/lib/world/types";
import { emptyResourceVector, unitResourceVector, RESOURCE_TYPES } from "@/lib/engine/resources";
import type { RouteCost } from "@/lib/engine/directed-logistics";
import type { ClaimCandidate, ExpansionParams } from "@/lib/engine/expansion";
import type { ColonyEstablishCandidate, ColonyEstablishParams } from "@/lib/engine/directed-build";
import { COLONISATION } from "@/lib/constants/colonisation";
import { EXPANSION } from "@/lib/constants/expansion";
import { CONSTRUCTION } from "@/lib/constants/construction";
import { HOUSING_TYPE, POP_CENTRE_DENSITY, CONSTRUCTION_CENTRE_TYPE } from "@/lib/constants/industry";
import { REFERENCE_INTERVAL } from "@/lib/constants/tick-cadence";
import { mulberry32 } from "@/lib/engine/universe-gen";

const reachable: RouteCost = () => 1;

/** Construction params with a monotonic id minter. Big cap by default → projects land as pool allows. */
function mkConstruction(
  cap = 1000,
  throughputPerPop = 0.05,
  floorBase: number = CONSTRUCTION.POOL_FLOOR_BASE,
  floorKnee: number = CONSTRUCTION.FLOOR_DEV_KNEE,
) {
  let n = 0;
  return {
    cap, throughputPerPop, floorBase, floorKnee,
    pointsPerLevel: CONSTRUCTION.POINTS_PER_LEVEL,
    paybackHorizon: CONSTRUCTION.PAYBACK_HORIZON,
    backlogWindow: CONSTRUCTION.BACKLOG_WINDOW,
    mintId: () => `proj-${n++}`,
  };
}

// food market with a high demandRate so the band's targetStock is large — stock 1 is a deep deficit.
function foodMarket(systemId: string, stock: number): MarketRowForLogistics {
  return {
    id: `${systemId}|food`, goodId: "food", stock, anchorMult: 1,
    demandRate: 1000, storageCapacity: 0,
  };
}

// Reference interval → catchUpFactor 1, so the shipped-magnitude assertions below are unscaled.
const INTERVAL = REFERENCE_INTERVAL;
const DUE_TICK = 0;      // monthly pulse: every faction plans on ticks where tick % interval === 0
const NOT_DUE_TICK = 1;  // off-boundary tick: pulseShard window is empty, no faction is due

function builderSlots(n: number) {
  const slotCap = emptyResourceVector();
  for (const k of RESOURCE_TYPES) slotCap[k] = n;
  return slotCap;
}

// A: deep structural food deficit, no capacity. B: builder with arable slots + population, reachable from A.
// generalSpace defaults to habitableSpace (100) so housing's habitable-capped headroom also exhausts B's
// general space, matching every pre-existing call site; the centre tests below widen it so a centre can
// still site itself once housing has claimed its habitable-bounded share.
function scenario(bFood: number, bHousing: number, slots = 20, generalSpace = 100): SystemBuildRow[] {
  return [
    {
      systemId: "A", factionId: "f1", control: "unclaimed", population: 100, unrest: 0, buildings: {},
      yields: unitResourceVector(), slotCap: emptyResourceVector(),
      generalSpace: 0, habitableSpace: 0, markets: [foodMarket("A", 1)],
    },
    {
      systemId: "B", factionId: "f1", control: "developed", population: 5000, unrest: 0,
      buildings: { food: bFood, housing: bHousing },
      yields: unitResourceVector(), slotCap: builderSlots(slots),
      generalSpace, habitableSpace: 100, markets: [],
    },
  ];
}

function countOf(w: MemoryDirectedBuildWorld, systemId: string, type: string): number {
  const u = w.buildingUpdates.find((x) => x.systemId === systemId && x.buildingType === type);
  return u?.count ?? 0;
}

describe("runDirectedBuildProcessor — committed construction", () => {
  it("commits construction projects for the faction on a due tick", async () => {
    const w = new MemoryDirectedBuildWorld(scenario(0, 0));
    // A tiny cap so no project completes this pulse — the queue holds the funded, in-flight work.
    await runDirectedBuildProcessor(w, { tick: DUE_TICK }, { interval: INTERVAL, routeCost: reachable, construction: mkConstruction(4) });
    expect(w.constructionProjects.length).toBeGreaterThan(0);
    expect(w.constructionProjects.every((p) => p.factionId === "f1")).toBe(true);
    // The pool funded the front of the queue (workDone advanced) but nothing has landed yet.
    expect(w.constructionProjects.some((p) => p.workDone > 0)).toBe(true);
    expect(w.buildingUpdates).toHaveLength(0);
  });

  it("lands whole integer levels once a project's work completes", async () => {
    const w = new MemoryDirectedBuildWorld(scenario(0, 0));
    // A generous pool (throughput 1/pop) completes the committed projects this pulse.
    await runDirectedBuildProcessor(w, { tick: DUE_TICK }, { interval: INTERVAL, routeCost: reachable, construction: mkConstruction(1000, 1) });
    const housing = countOf(w, "B", "housing");
    expect(housing).toBeGreaterThan(0);
    expect(Number.isInteger(housing)).toBe(true);
    // Writes are absolute new counts (current 0 + landed), only at the builder B.
    expect(w.buildingUpdates.every((u) => u.systemId === "B" && Number.isInteger(u.count))).toBe(true);
  });

  it("funds existing open projects front-first, advancing workDone (persists deltas)", async () => {
    const existing: WorldConstructionProject = {
      id: "e", kind: "build", origin: "auto", factionId: "f1", systemId: "B", buildingType: "housing", levels: 2, workTotal: 16, workDone: 0,
    };
    const w = new MemoryDirectedBuildWorld(scenario(0, 0), [existing]);
    await runDirectedBuildProcessor(w, { tick: DUE_TICK }, { interval: INTERVAL, routeCost: reachable, construction: mkConstruction(4) });
    // Front of the queue is the pre-existing project; the per-build cap (4) advances it by exactly 4.
    const e = w.constructionProjects.find((p) => p.id === "e");
    expect(e?.workDone).toBe(4);
  });

  it("does not land anything when the pool is below a level's work cost (throughput-paced)", async () => {
    const w = new MemoryDirectedBuildWorld(scenario(0, 0));
    // pool = 5000 × 0.0001 = 0.5 construction points — far below any level's work cost; cap is generous.
    await runDirectedBuildProcessor(w, { tick: DUE_TICK }, {
      interval: INTERVAL, routeCost: reachable,
      construction: mkConstruction(1000, 0.0001),
    });
    expect(w.buildingUpdates).toHaveLength(0);          // nothing landed
    expect(w.constructionProjects.length).toBeGreaterThan(0); // but the work is committed
  });

  it("commits and funds nothing on an off-boundary tick (monthly pulse)", async () => {
    const w = new MemoryDirectedBuildWorld(scenario(0, 0));
    await runDirectedBuildProcessor(w, { tick: NOT_DUE_TICK }, { interval: INTERVAL, routeCost: reachable, construction: mkConstruction() });
    expect(w.buildingUpdates).toHaveLength(0);
    expect(w.constructionProjects).toHaveLength(0);
  });

  it("commits nothing when there is nothing to build (no deficit, no housing headroom)", async () => {
    const balanced: SystemBuildRow[] = [{
      systemId: "A", factionId: "f1", control: "developed", population: 0, unrest: 0, buildings: {},
      yields: unitResourceVector(), slotCap: builderSlots(10), generalSpace: 0, habitableSpace: 0,
      markets: [foodMarket("A", 1)], // population 0 → no consumption → no rate deficit; no habitable land → no housing
    }];
    const w = new MemoryDirectedBuildWorld(balanced);
    await runDirectedBuildProcessor(w, { tick: DUE_TICK }, { interval: INTERVAL, routeCost: reachable, construction: mkConstruction() });
    expect(w.buildingUpdates).toHaveLength(0);
    expect(w.constructionProjects).toHaveLength(0);
  });

  it("accumulates a whole level across several pulses (committed and timed, not one-shot)", async () => {
    // A fed (no unmet goods) and calm developed system with room for a few housing levels. A small
    // pool + cap fund a slice each pulse, so the level lands only after several pulses of work.
    const base: SystemBuildRow = {
      systemId: "B", factionId: "f1", control: "developed", population: 300, unrest: 0,
      buildings: {}, yields: unitResourceVector(), slotCap: emptyResourceVector(),
      generalSpace: 10, habitableSpace: 3, markets: [],
    };
    let rows: SystemBuildRow[] = [base];
    let projects: WorldConstructionProject[] = [];
    const mint = mkConstruction().mintId;
    let landedAtPulse = -1;
    for (let pulse = 0; pulse < 10; pulse++) {
      const w = new MemoryDirectedBuildWorld(rows, projects);
      await runDirectedBuildProcessor(w, { tick: DUE_TICK }, {
        interval: INTERVAL, routeCost: reachable,
        construction: { ...mkConstruction(6), mintId: mint },
      });
      rows = rows.map((r) => {
        const buildings = { ...r.buildings };
        for (const u of w.buildingUpdates) if (u.systemId === r.systemId) buildings[u.buildingType] = u.count;
        return { ...r, buildings };
      });
      projects = w.constructionProjects;
      if ((rows[0].buildings.housing ?? 0) > 0 && landedAtPulse < 0) landedAtPulse = pulse;
    }
    const housing = rows[0].buildings.housing ?? 0;
    expect(housing).toBeGreaterThan(0);
    expect(Number.isInteger(housing)).toBe(true);
    // It did NOT land on the first pulse — the work cost spanned several pulses (throughput-paced).
    expect(landedAtPulse).toBeGreaterThan(0);
  });
});

describe("runDirectedBuildProcessor — value-order funding", () => {
  // The queue is [in-flight, ...new proposals in funding order]; with a tiny cap nothing lands, so
  // w.constructionProjects preserves that order and we can assert priority by index.
  function idx(w: MemoryDirectedBuildWorld, systemId: string, type: string): number {
    return w.constructionProjects.findIndex((p) => p.kind === "build" && p.systemId === systemId && p.buildingType === type);
  }

  it("funds housing ahead of industry at the same builder (proactive substrate leads)", async () => {
    // scenario(0,0): A has a deep food deficit, B is a developed builder with habitable land →
    // B gets both a housing proposal and a food industry proposal. Housing must sort first.
    const w = new MemoryDirectedBuildWorld(scenario(0, 0));
    await runDirectedBuildProcessor(w, { tick: DUE_TICK }, { interval: INTERVAL, routeCost: reachable, construction: mkConstruction(4) });
    const housingIdx = idx(w, "B", "housing");
    const foodIdx = idx(w, "B", "food");
    expect(housingIdx).toBeGreaterThanOrEqual(0);
    expect(foodIdx).toBeGreaterThanOrEqual(0);
    expect(housingIdx).toBeLessThan(foodIdx);
  });

  it("keeps in-flight projects ahead of newly proposed work", async () => {
    const existing: WorldConstructionProject = {
      id: "e", kind: "build", origin: "auto", factionId: "f1", systemId: "B", buildingType: "food", levels: 2, workTotal: 24, workDone: 0,
    };
    const w = new MemoryDirectedBuildWorld(scenario(0, 0), [existing]);
    await runDirectedBuildProcessor(w, { tick: DUE_TICK }, { interval: INTERVAL, routeCost: reachable, construction: mkConstruction(4) });
    // The pre-existing project is at the front of the queue → it absorbs the (single-cap) pool first.
    expect(w.constructionProjects[0]?.id).toBe("e");
    expect(w.constructionProjects[0]?.workDone).toBe(4);
  });

  it("funds competing industry by descending bundle-ROI through the full pipeline (beats the systemId tiebreak)", async () => {
    // Two isolated builder→deficit pairs, each builder reaching exactly one deficit. Builder "B2" serves
    // a huge food deficit (capacity-bound → ROI at the per-unit ceiling); builder "B1" serves a trickle
    // (one overshoot level → far lower ROI). The systemId tiebreak alone would fund "B1" first (lexically
    // before "B2"), so asserting B2's food is minted AHEAD of B1's proves descending-ROI ordering — not
    // the tiebreak — survives the full processor path (planFactionProposals → orderProposals → gate-first
    // expand → fundQueue). The single-industry shipped tests can't exercise this cross-bundle ordering.
    const rows: SystemBuildRow[] = [
      {
        systemId: "A1", factionId: "f1", control: "unclaimed", population: 10, unrest: 0, buildings: {},
        yields: unitResourceVector(), slotCap: emptyResourceVector(),
        generalSpace: 0, habitableSpace: 0, markets: [foodMarket("A1", 1)],
      },
      {
        systemId: "A2", factionId: "f1", control: "unclaimed", population: 100000, unrest: 0, buildings: {},
        yields: unitResourceVector(), slotCap: emptyResourceVector(),
        generalSpace: 0, habitableSpace: 0, markets: [foodMarket("A2", 1)],
      },
      {
        systemId: "B1", factionId: "f1", control: "developed", population: 5000, unrest: 0, buildings: {},
        yields: unitResourceVector(), slotCap: builderSlots(20), generalSpace: 100, habitableSpace: 100, markets: [],
      },
      {
        systemId: "B2", factionId: "f1", control: "developed", population: 5000, unrest: 0, buildings: {},
        yields: unitResourceVector(), slotCap: builderSlots(20), generalSpace: 100, habitableSpace: 100, markets: [],
      },
    ];
    // B1 reaches only the shallow A1; B2 only the deep A2 (cross pairs unreachable) — so each food bundle
    // carries a cleanly different ROI instead of both builders chasing the deeper deficit.
    const isolatedRoute: RouteCost = (from, to) => {
      if (from === to) return 0;
      const pair = [from, to].sort().join("|");
      if (pair === "A1|B1" || pair === "A2|B2") return 1;
      return null;
    };
    // Tiny cap so nothing lands — constructionProjects preserves the funded queue order.
    const w = new MemoryDirectedBuildWorld(rows);
    await runDirectedBuildProcessor(w, { tick: DUE_TICK }, { interval: INTERVAL, routeCost: isolatedRoute, construction: mkConstruction(4) });
    const deepIdx = idx(w, "B2", "food");    // capacity-bound, high ROI
    const shallowIdx = idx(w, "B1", "food"); // one overshoot level, low ROI
    expect(deepIdx).toBeGreaterThanOrEqual(0);
    expect(shallowIdx).toBeGreaterThanOrEqual(0);
    expect(deepIdx).toBeLessThan(shallowIdx); // ROI-desc overrides the "B1" < "B2" tiebreak
  });
});

describe("construction centres", () => {
  it("commits a centre project when the backlog runs beyond the frontier", async () => {
    // Deficit scenario with the pool throttled so committed work vastly outruns what BACKLOG_WINDOW
    // pulses can drain (tiny throughputPerPop → deep starved backlog → a centre is proposed), and a
    // SMALL cap so the pool spreads across parallel fronts — the high-ROI centre must actually
    // receive work this pulse, because persist-if-funded drops a workless centre (next test). B's
    // general space is widened past its habitable cap (1000 vs the default 100) so a centre can still
    // site itself once housing has claimed its habitable-bounded 100-unit share.
    const w = new MemoryDirectedBuildWorld(scenario(0, 0, 20, 1000));
    await runDirectedBuildProcessor(w, { tick: DUE_TICK }, {
      interval: INTERVAL, routeCost: reachable,
      construction: mkConstruction(2, 0.001),
    });
    const centres = w.constructionProjects.filter(
      (p) => p.kind === "build" && p.buildingType === CONSTRUCTION_CENTRE_TYPE,
    );
    expect(centres.length).toBe(1); // planCentreProposal commits at most one centre per pulse
    // The high-ROI centre proposal actually receives work this pulse (persist-if-funded next test
    // proves the converse) — not merely committed.
    expect(centres.some((p) => p.workDone > 0)).toBe(true);
  });

  it("drops an unfunded centre project instead of persisting it (persist-if-funded)", async () => {
    // Same starved world (same widened general space, so siting still succeeds), pool ≈ 0: the centre
    // proposal is committed but receives no work, so it must NOT appear in the persisted open set.
    const w = new MemoryDirectedBuildWorld(scenario(0, 0, 20, 1000));
    await runDirectedBuildProcessor(w, { tick: DUE_TICK }, {
      interval: INTERVAL, routeCost: reachable,
      construction: mkConstruction(1000, 0), // zero pool: nothing funds
    });
    const centres = w.constructionProjects.filter(
      (p) => p.kind === "build" && p.buildingType === CONSTRUCTION_CENTRE_TYPE,
    );
    expect(centres).toHaveLength(0);
  });

  it("prices the centre off the UNSCALED pool — the commit decision is interval-invariant", async () => {
    // A world tuned so the backlog (one 12-work food bundle; housing is already at its habitable cap,
    // so it proposes nothing) sits just above the reference-interval frontier budget
    // (poolRef.total=1 × BACKLOG_WINDOW=6 = 6 < 12) but just below what a WRONGLY-scaled budget would
    // read at catchUp=2 (1 × 2 × 6 = 12, no longer < 12) — so a regression that fed the scaled funding
    // pool into planCentreProposal (instead of the unscaled poolRef.total) would commit a centre at the
    // reference interval (24) but NOT at interval 48, while the correct unscaled valuation commits at
    // both (mirrors the non-reference-interval construction in "interval invariance" below).
    const fullyHoused = scenario(0, 100, 20, 1000);
    const committed = async (interval: number): Promise<boolean> => {
      const w = new MemoryDirectedBuildWorld(fullyHoused);
      await runDirectedBuildProcessor(w, { tick: DUE_TICK }, {
        interval, routeCost: reachable,
        construction: mkConstruction(2, 0.0002),
      });
      return w.constructionProjects.some(
        (p) => p.kind === "build" && p.buildingType === CONSTRUCTION_CENTRE_TYPE,
      );
    };
    expect(await committed(INTERVAL)).toBe(await committed(48));
    expect(await committed(INTERVAL)).toBe(true); // sanity: the invariant isn't trivially "both false"
  });
});

const EXP_PARAMS: ExpansionParams = {
  maxClaimsPerPulse: 1, scoreFloor: 0.001, weights: { habitable: 1, diversity: 3, proximity: 0.5 },
};
const COLONY_PARAMS: ColonyEstablishParams = {
  landPremium: COLONISATION.LAND_PREMIUM,
  landGeneralWeight: COLONISATION.LAND_GENERAL_WEIGHT,
  landDepositWeight: COLONISATION.LAND_DEPOSIT_WEIGHT,
  sigmaFloor: COLONISATION.SIGMA_FLOOR,
  establishWork: COLONISATION.COLONY_ESTABLISH_WORK,
  seedPop: EXPANSION.COLONY_SEED_POP,
  habitableFloor: EXPANSION.DEVELOP_HABITABLE_FLOOR,
  popCostWeight: COLONISATION.SEED_POP_COST_WEIGHT,
  minSettlerSupply: 0, // gate disabled — these cases exercise proposal/funding wiring, not founding pace
  employedLeakFraction: 0,
};

/** A developed home with housing filling all its habitable land (σ = 1) and no build deficits — so the
 *  pool funds only colonies. Population sets the throughput pool. */
function saturatedHome(population: number): SystemBuildRow {
  return {
    systemId: "home", factionId: "f1", control: "developed", population, unrest: 0,
    buildings: { [HOUSING_TYPE]: 5 },
    yields: unitResourceVector(), slotCap: emptyResourceVector(),
    generalSpace: 5, habitableSpace: 5, markets: [], // habitable fully housed (5 levels) → σ = 1, no housing headroom
  };
}

function colonyCand(systemId: string, habitableSpace = 100): ColonyEstablishCandidate {
  return { systemId, habitableSpace, generalSpace: 50, slotCap: emptyResourceVector(), sourceSystemId: "home" };
}

// One developed owned system so the faction is in the shard, with no build needs.
function ownedOnly(factionId: string): SystemBuildRow {
  return {
    systemId: `${factionId}-home`, factionId, control: "developed", population: 100, unrest: 0,
    buildings: {}, yields: unitResourceVector(), slotCap: emptyResourceVector(),
    generalSpace: 0, habitableSpace: 0, markets: [],
  };
}

describe("runDirectedBuildProcessor: claim phase", () => {
  it("claims the best in-reach candidate on a due tick", async () => {
    const w = new MemoryDirectedBuildWorld([ownedOnly("f1")]);
    const reachProvider = (f: string): ClaimCandidate[] =>
      f === "f1" ? [
        { systemId: "u-poor", minHops: 1, habitableSpace: 5, resourceDiversity: 0 },
        { systemId: "u-rich", minHops: 1, habitableSpace: 200, resourceDiversity: 4 },
      ] : [];
    await runDirectedBuildProcessor(w, { tick: DUE_TICK }, {
      interval: INTERVAL, routeCost: reachable, construction: mkConstruction(),
      claim: { reachProvider, rng: mulberry32(1), params: EXP_PARAMS },
    });
    expect(w.claims).toEqual([{ systemId: "u-rich", factionId: "f1" }]);
  });

  it("claims nothing off the pulse boundary", async () => {
    const w = new MemoryDirectedBuildWorld([ownedOnly("f1")]);
    await runDirectedBuildProcessor(w, { tick: NOT_DUE_TICK }, {
      interval: INTERVAL, routeCost: reachable, construction: mkConstruction(),
      claim: { reachProvider: () => [{ systemId: "u1", minHops: 1, habitableSpace: 100, resourceDiversity: 3 }], rng: mulberry32(1), params: EXP_PARAMS },
    });
    expect(w.claims).toHaveLength(0);
  });

  it("runs the build phase even when no claim/develop param is supplied", async () => {
    const w = new MemoryDirectedBuildWorld(scenario(0, 0));
    await runDirectedBuildProcessor(w, { tick: DUE_TICK }, { interval: INTERVAL, routeCost: reachable, construction: mkConstruction() });
    expect(w.claims).toHaveLength(0);
    expect(w.developments).toHaveLength(0);
    expect(w.constructionProjects.length).toBeGreaterThan(0); // construction still committed
  });
});

describe("runDirectedBuildProcessor: colony-establish phase", () => {
  it("does NOT develop on the pulse it is proposed — the colony-establish accrues work over pulses", async () => {
    const w = new MemoryDirectedBuildWorld([saturatedHome(1000)]);
    // A tiny cap so the establish project cannot complete this pulse.
    await runDirectedBuildProcessor(w, { tick: DUE_TICK }, {
      interval: INTERVAL, routeCost: reachable, construction: mkConstruction(4),
      develop: { candidateProvider: (f) => (f === "f1" ? [colonyCand("c1")] : []), params: COLONY_PARAMS },
    });
    expect(w.developments).toHaveLength(0); // not flipped this pulse
    const colony = w.constructionProjects.find((p) => p.kind === "colony_establish");
    expect(colony).toBeDefined();
    expect(colony!.systemId).toBe("c1");
    // establishWork exceeds the base by the bundled seed-housing's build cost (housing is paid for).
    expect(colony!.workTotal).toBeGreaterThan(COLONISATION.COLONY_ESTABLISH_WORK);
  });

  it("develops the colony once the establish project completes (seed + bundled housing landing)", async () => {
    const w = new MemoryDirectedBuildWorld([saturatedHome(1000)]);
    // A generous pool + cap completes the establish this pulse.
    await runDirectedBuildProcessor(w, { tick: DUE_TICK }, {
      interval: INTERVAL, routeCost: reachable, construction: mkConstruction(1000, 1),
      develop: { candidateProvider: (f) => (f === "f1" ? [colonyCand("c1")] : []), params: COLONY_PARAMS },
    });
    expect(w.developments).toHaveLength(1);
    const dev = w.developments[0];
    expect(dev.systemId).toBe("c1");
    expect(dev.sourceSystemId).toBe("home");
    expect(dev.seedPop).toBe(EXPANSION.COLONY_SEED_POP);
    // Viable by construction: bundled housing houses the whole seed.
    expect(dev.housingLevels).toBe(Math.ceil(dev.seedPop / POP_CENTRE_DENSITY));
    expect(dev.housingLevels * POP_CENTRE_DENSITY).toBeGreaterThanOrEqual(dev.seedPop);
    // The completed establish project is removed from the open queue.
    expect(w.constructionProjects.some((p) => p.kind === "colony_establish")).toBe(false);
  });

  it("bounds the open queue: with many candidates and a small pool, only funded colonies persist", async () => {
    const w = new MemoryDirectedBuildWorld([saturatedHome(80)]); // pool = 80 × 0.05 = 4 → one cap-worth
    const candidates = ["c1", "c2", "c3", "c4", "c5"].map((id) => colonyCand(id));
    await runDirectedBuildProcessor(w, { tick: DUE_TICK }, {
      interval: INTERVAL, routeCost: reachable, construction: mkConstruction(4),
      develop: { candidateProvider: (f) => (f === "f1" ? candidates : []), params: COLONY_PARAMS },
    });
    const openColonies = w.constructionProjects.filter((p) => p.kind === "colony_establish");
    // Front-first funding gives one colony a cap's worth; the other four get zero and are dropped.
    expect(openColonies.length).toBeLessThan(candidates.length);
    expect(openColonies.length).toBeGreaterThanOrEqual(1);
    for (const p of openColonies) expect(p.workDone).toBeGreaterThan(0);
  });

  it("develops nothing off the pulse boundary", async () => {
    const w = new MemoryDirectedBuildWorld([saturatedHome(1000)]);
    await runDirectedBuildProcessor(w, { tick: NOT_DUE_TICK }, {
      interval: INTERVAL, routeCost: reachable, construction: mkConstruction(1000, 1),
      develop: { candidateProvider: () => [colonyCand("c1")], params: COLONY_PARAMS },
    });
    expect(w.developments).toHaveLength(0);
    expect(w.constructionProjects).toHaveLength(0);
  });
});

/** A developed home saturated on housing (σ = 1, no housing headroom) but carrying a deep food deficit
 *  with spare labour + food slots — so it emits a food industry build proposal that competes with a
 *  colony in the same pool. Population sets labour; the pool is kept scarce via mkConstruction's rate. */
function homeWithFoodDeficit(population = 1000): SystemBuildRow {
  return {
    systemId: "home", factionId: "f1", control: "developed", population, unrest: 0,
    buildings: { [HOUSING_TYPE]: 5 },
    yields: unitResourceVector(), slotCap: builderSlots(20),
    generalSpace: 5, habitableSpace: 5, markets: [foodMarket("home", 1)], // habitable fully housed → σ = 1
  };
}

function colonyOf(systemId: string, habitableSpace: number, generalSpace = 0): ColonyEstablishCandidate {
  return { systemId, habitableSpace, generalSpace, slotCap: emptyResourceVector(), sourceSystemId: "home" };
}

describe("runDirectedBuildProcessor: build-vs-colony ROI arbitration (one shared pool)", () => {
  it("funds a high-ROI local build ahead of a low-value colony (colony deferred)", async () => {
    const w = new MemoryDirectedBuildWorld([homeWithFoodDeficit(1000)]);
    // pool = 1000 × 0.004 = 4 → one cap-worth; only the front of the ROI-ordered queue funds this pulse.
    await runDirectedBuildProcessor(w, { tick: DUE_TICK }, {
      interval: INTERVAL, routeCost: reachable, construction: mkConstruction(6, 0.004),
      // A barren colony (habitable 2, no deposits) scores colonyValue ≈ ROI 0.08 vs the food build's ≈ 0.25,
      // so the build out-ROIs it and takes the shared pool front-first.
      develop: { candidateProvider: (f) => (f === "f1" ? [colonyOf("c1", 2)] : []), params: COLONY_PARAMS },
    });
    // The local build wins the pool; the colony got no work and is dropped (persist-if-funded).
    expect(w.constructionProjects.some((p) => p.kind === "colony_establish")).toBe(false);
    // Proof the pool went to the build: it either landed (building update) or is in-flight with workDone > 0.
    const buildActivity =
      w.buildingUpdates.length > 0 || w.constructionProjects.some((p) => p.kind === "build" && p.workDone > 0);
    expect(buildActivity).toBe(true);
  });

  it("funds a high-value colony ahead of a low-ROI local build (build starved)", async () => {
    const w = new MemoryDirectedBuildWorld([homeWithFoodDeficit(1000)]);
    await runDirectedBuildProcessor(w, { tick: DUE_TICK }, {
      interval: INTERVAL, routeCost: reachable, construction: mkConstruction(6, 0.004),
      // Same home/deficit; only the colony's land changes — enormous habitable → colonyValue ROI ≫ the
      // build's 0.25, so the colony dominates the shared pool front-first.
      develop: { candidateProvider: (f) => (f === "f1" ? [colonyOf("c1", 1_000_000)] : []), params: COLONY_PARAMS },
    });
    const fundedColony = w.constructionProjects.find((p) => p.kind === "colony_establish");
    expect(fundedColony).toBeDefined();
    expect(fundedColony!.workDone).toBeGreaterThan(0);
    // The food build was proposed but starved of the pool this pulse (builds persist at workDone 0).
    const build = w.constructionProjects.find((p) => p.kind === "build");
    expect(build).toBeDefined();
    expect(build!.workDone).toBe(0);
  });
});

describe("runDirectedBuildProcessor — pool fairness floor", () => {
  // A fully-housed, no-industry homeworld reads development 0.316 (> FLOOR_DEV_KNEE ⇒ weaned off the
  // floor); a tiny colony reads ≈ 0 (⇒ reserves the full floor). Both hold one in-flight build, the
  // homeworld's at the front, so a small pool funds only it front-first. The floor guarantees the young
  // colony its slice — the floorBase-on-vs-off differential proves the wiring (the fund/curve primitives
  // are unit-tested in construction.test.ts). No markets + full housing ⇒ the planner proposes nothing
  // new, so funding is purely the two in-flight builds.
  const floorScenario = (): SystemBuildRow[] => [
    {
      systemId: "H", factionId: "f1", control: "developed", population: 400, unrest: 0,
      buildings: { [HOUSING_TYPE]: 20 }, yields: unitResourceVector(), slotCap: emptyResourceVector(),
      generalSpace: 0, habitableSpace: 20, markets: [],
    },
    {
      systemId: "C", factionId: "f1", control: "developed", population: 2, unrest: 0,
      buildings: { [HOUSING_TYPE]: 20 }, yields: unitResourceVector(), slotCap: emptyResourceVector(),
      generalSpace: 0, habitableSpace: 20, markets: [],
    },
  ];
  const inflight = (): WorldConstructionProject[] => [
    { id: "pH", kind: "build", origin: "auto", factionId: "f1", systemId: "H", buildingType: HOUSING_TYPE, levels: 5, workTotal: 1000, workDone: 0 },
    { id: "pC", kind: "build", origin: "auto", factionId: "f1", systemId: "C", buildingType: HOUSING_TYPE, levels: 5, workTotal: 1000, workDone: 0 },
  ];
  const colonyWorkDone = async (floorBase: number): Promise<number> => {
    const w = new MemoryDirectedBuildWorld(floorScenario(), inflight());
    await runDirectedBuildProcessor(w, { tick: DUE_TICK }, {
      interval: INTERVAL, routeCost: reachable,
      construction: mkConstruction(1000, 0.05, floorBase, CONSTRUCTION.FLOOR_DEV_KNEE),
    });
    return w.constructionProjects.find((p) => p.id === "pC")?.workDone ?? 0;
  };

  it("funds a young colony's build that front-first funding would otherwise starve", async () => {
    expect(await colonyWorkDone(0)).toBe(0); // no floor: the homeworld's front build takes the whole pool
    expect(await colonyWorkDone(CONSTRUCTION.POOL_FLOOR_BASE)).toBeGreaterThan(0); // the floor reserves its slice
  });
});

describe("runDirectedBuildProcessor — interval invariance", () => {
  const CAP = 10;

  // A developed builder with no build needs (fully housed, no markets) so the planner proposes nothing
  // new and funding is purely the in-flight queue. Ample population sets a pool far above the cap.
  const idleBuilder = (population: number): SystemBuildRow => ({
    systemId: "B", factionId: "f1", control: "developed", population, unrest: 0,
    buildings: { [HOUSING_TYPE]: 5 }, yields: unitResourceVector(), slotCap: emptyResourceVector(),
    generalSpace: 5, habitableSpace: 5, markets: [],
  });

  it("interval scaling preserves wall-clock minimum build time", async () => {
    // One in-flight project whose work is exactly 2 × the reference cap, pool ample (cap binds). At
    // interval 24 (catchUp 1) it lands after 2 pulses; at interval 12 (catchUp 0.5) the effective cap
    // halves, so it needs 4 pulses — 2×24 = 4×12 = 48 wall-clock ticks either way.
    const project = (): WorldConstructionProject => ({
      id: "e", kind: "build", origin: "auto", factionId: "f1", systemId: "B", buildingType: HOUSING_TYPE, levels: 5, workTotal: 2 * CAP, workDone: 0,
    });
    const landingPulse = async (interval: number): Promise<number> => {
      let rows: SystemBuildRow[] = [idleBuilder(5000)];
      let projects: WorldConstructionProject[] = [project()];
      for (let pulse = 1; pulse <= 8; pulse++) {
        const w = new MemoryDirectedBuildWorld(rows, projects);
        // Ample pool (throughput 1/pop) so the per-build cap is the binding constraint; floor disabled.
        await runDirectedBuildProcessor(w, { tick: 0 }, {
          interval, routeCost: reachable, construction: mkConstruction(CAP, 1, 0, CONSTRUCTION.FLOOR_DEV_KNEE),
        });
        if (w.buildingUpdates.length > 0) return pulse; // the project completed and landed this pulse
        projects = w.constructionProjects;
        rows = rows.map((r) => {
          const buildings = { ...r.buildings };
          for (const u of w.buildingUpdates) if (u.systemId === r.systemId) buildings[u.buildingType] = u.count;
          return { ...r, buildings };
        });
      }
      return -1;
    };
    expect(await landingPulse(24)).toBe(2);
    expect(await landingPulse(12)).toBe(4);
  });

  it("interval scaling preserves the parallel-front count (pool and cap scale together)", async () => {
    // Pool = 400 × 0.05 = 20 = 2 × CAP at the reference interval. Three in-flight projects whose work
    // far exceeds any pulse's funding (none lands, queue order preserved) → exactly the front two absorb
    // a cap's worth and the third is starved, at either interval (pool ÷ cap is interval-invariant).
    const inflight = (): WorldConstructionProject[] => [
      { id: "p1", kind: "build", origin: "auto", factionId: "f1", systemId: "B", buildingType: HOUSING_TYPE, levels: 9, workTotal: 1000, workDone: 0 },
      { id: "p2", kind: "build", origin: "auto", factionId: "f1", systemId: "B", buildingType: "food", levels: 9, workTotal: 1000, workDone: 0 },
      { id: "p3", kind: "build", origin: "auto", factionId: "f1", systemId: "B", buildingType: "ore", levels: 9, workTotal: 1000, workDone: 0 },
    ];
    const run = async (interval: number): Promise<{ count: number; perFront: number[] }> => {
      const w = new MemoryDirectedBuildWorld([idleBuilder(400)], inflight());
      await runDirectedBuildProcessor(w, { tick: 0 }, {
        interval, routeCost: reachable, construction: mkConstruction(CAP, 0.05, 0, CONSTRUCTION.FLOOR_DEV_KNEE),
      });
      const funded = w.constructionProjects.filter((p) => p.workDone > 0);
      return { count: funded.length, perFront: funded.map((p) => p.workDone).sort((a, b) => b - a) };
    };
    const r24 = await run(24);
    const r12 = await run(12);
    // Same number of simultaneous fronts at either interval (the invariance the count guards).
    expect(r24.count).toBe(2);
    expect(r12.count).toBe(2);
    // …and each front's per-pulse work scales with the interval — this is what actually fails if pool
    // and cap are left unscaled (the count alone stays 2 either way, so it can't catch a no-scaling bug).
    expect(r12.perFront[0]).toBeCloseTo(r24.perFront[0] / 2, 6);
  });

  it("interval scaling preserves the young-colony floor reservation (the floor scales with the interval)", async () => {
    // The pool-fairness scenario: a homeworld front build would starve the young colony's build without
    // the development-scaled pool floor. The floor slice is floorBase × catchUp, so halving the interval
    // halves the colony's rescued work — exactly like the pool and cap. This is the invariance case that
    // exercises the floor scaling: if floorBase were left unscaled, the reference-size floor would
    // over-reserve the (halved) pool at interval 12, so the colony would get MORE than half.
    const floorScenario = (): SystemBuildRow[] => [
      {
        systemId: "H", factionId: "f1", control: "developed", population: 400, unrest: 0,
        buildings: { [HOUSING_TYPE]: 20 }, yields: unitResourceVector(), slotCap: emptyResourceVector(),
        generalSpace: 0, habitableSpace: 20, markets: [],
      },
      {
        systemId: "C", factionId: "f1", control: "developed", population: 2, unrest: 0,
        buildings: { [HOUSING_TYPE]: 20 }, yields: unitResourceVector(), slotCap: emptyResourceVector(),
        generalSpace: 0, habitableSpace: 20, markets: [],
      },
    ];
    const inflight = (): WorldConstructionProject[] => [
      { id: "pH", kind: "build", origin: "auto", factionId: "f1", systemId: "H", buildingType: HOUSING_TYPE, levels: 5, workTotal: 1000, workDone: 0 },
      { id: "pC", kind: "build", origin: "auto", factionId: "f1", systemId: "C", buildingType: HOUSING_TYPE, levels: 5, workTotal: 1000, workDone: 0 },
    ];
    const colonyWorkDone = async (interval: number): Promise<number> => {
      const w = new MemoryDirectedBuildWorld(floorScenario(), inflight());
      await runDirectedBuildProcessor(w, { tick: 0 }, {
        interval, routeCost: reachable,
        construction: mkConstruction(1000, 0.05, CONSTRUCTION.POOL_FLOOR_BASE, CONSTRUCTION.FLOOR_DEV_KNEE),
      });
      return w.constructionProjects.find((p) => p.id === "pC")?.workDone ?? 0;
    };
    const c24 = await colonyWorkDone(24);
    const c12 = await colonyWorkDone(12);
    expect(c24).toBeGreaterThan(0);      // the floor rescues the colony at the reference interval
    expect(c12).toBeCloseTo(c24 / 2, 6); // …and its reserved slice scales with the interval, like pool/cap
  });
});

describe("player orders in the funding queue", () => {
  it("funds a fresh player order ahead of this pulse's new autonomic proposals", async () => {
    // Stored order is [fresh player row, committed auto row] — the WRONG-for-funding order, so
    // orderOpenProjects must actually move the committed row ahead of the fresh player row for this
    // test to pass; a processor that funded raw stored order ([...existing, ...newProjects], no
    // reorder) would flip which row gets the front-of-queue cap and which gets the pool's leftover.
    // Floor disabled (floorBase 0) so the whole pool is plain front-first, no reserved slice to confound
    // the arithmetic. cap=4, pool=5000×0.001=5: the front row absorbs a full cap (4), the second row
    // gets only the pool's leftover (1), and nothing reaches this pulse's new proposals (pool exhausted).
    const playerOrder: WorldConstructionProject = { kind: "build", id: "player-1", factionId: "f1",
      systemId: "s1", origin: "player", buildingType: "metals", levels: 1, workTotal: 20, workDone: 0 };
    const committedAuto: WorldConstructionProject = { kind: "build", id: "auto-committed", factionId: "f1",
      systemId: "s2", origin: "auto", buildingType: "metals", levels: 1, workTotal: 20, workDone: 5 };
    const w = new MemoryDirectedBuildWorld(scenario(0, 0), [playerOrder, committedAuto]);
    await runDirectedBuildProcessor(w, { tick: DUE_TICK }, {
      interval: INTERVAL, routeCost: reachable,
      construction: mkConstruction(4, 0.001, 0, CONSTRUCTION.FLOOR_DEV_KNEE),
    });
    const persistedPlayer = w.constructionProjects.find((p) => p.id === "player-1");
    const persistedAuto = w.constructionProjects.find((p) => p.id === "auto-committed");
    // The committed row was reordered to the front → it absorbs the full cap (5 + 4 = 9); the fresh
    // player row only gets the pool's leftover (1) — pinning the exact split proves which row went
    // first, not merely that both got something (either order would leave both non-zero here).
    expect(persistedAuto?.workDone).toBe(9);
    expect(persistedPlayer?.workDone).toBe(1);
    // Both pre-existing rows drained the pool before any of this pulse's new autonomic proposals: every
    // other persisted project (this pulse's new proposals for the scenario's food/housing deficit) is
    // still at workDone 0.
    const newProposals = w.constructionProjects.filter(
      (p) => p.id !== "player-1" && p.id !== "auto-committed",
    );
    expect(newProposals.length).toBeGreaterThan(0);
    expect(newProposals.every((p) => p.workDone === 0)).toBe(true);
  });

  it("never drops an unfunded player order (persist-if-funded is auto-only)", async () => {
    const playerColony: WorldConstructionProject = { kind: "colony_establish", id: "player-c1",
      factionId: "f1", systemId: "s9", origin: "player", sourceSystemId: "s1",
      seedPop: 100, housingLevels: 1, workTotal: 60, workDone: 0 };
    const w = new MemoryDirectedBuildWorld(scenario(0, 0), [playerColony]);
    await runDirectedBuildProcessor(w, { tick: DUE_TICK }, {
      interval: INTERVAL, routeCost: reachable,
      construction: { ...mkConstruction(1000, 0) }, // zero pool: nothing funds
    });
    expect(w.constructionProjects.some((p) => p.id === "player-c1")).toBe(true);
  });
});

describe("runDirectedBuildProcessor: player automation gating (proposal generation only)", () => {
  it("skips build proposal generation for the player's faction when automation.build is off", async () => {
    // Deficit scenario that WOULD propose builds; with build automation off, no new projects appear
    // for the player faction — but a pre-existing committed row still receives funding. A tiny cap (4)
    // keeps the committed row (remaining work 15) from completing in a single pulse — matching how
    // "funds existing open projects front-first" above isolates the same advance-without-landing signal.
    const inFlight: WorldConstructionProject = { kind: "build", id: "b-committed", factionId: "f1",
      systemId: "s1", origin: "auto", buildingType: "metals", levels: 1, workTotal: 20, workDone: 5 };
    const w = new MemoryDirectedBuildWorld(scenario(0, 0), [inFlight]);
    await runDirectedBuildProcessor(w, { tick: DUE_TICK }, {
      interval: INTERVAL, routeCost: reachable,
      construction: mkConstruction(4),
      player: { factionId: "f1", automation: { build: false, colonisation: true } },
    });
    expect(w.constructionProjects.every((p) => p.id === "b-committed")).toBe(true);
    expect(w.constructionProjects[0]?.workDone).toBeGreaterThan(5);
  });

  it("skips colony proposal generation when automation.colonisation is off, leaving builds alone", async () => {
    // Reuses the build-vs-colony arbitration fixture (homeWithFoodDeficit + colonyOf/COLONY_PARAMS):
    // a build deficit competes with an eligible colony candidate for the same pool. With colonisation
    // off, no colony_establish proposal is generated at all — the build proposal wins the whole pool
    // and its row persists regardless of funding (persist-if-funded only gates colonies/centres).
    const w = new MemoryDirectedBuildWorld([homeWithFoodDeficit(1000)]);
    await runDirectedBuildProcessor(w, { tick: DUE_TICK }, {
      interval: INTERVAL, routeCost: reachable,
      construction: mkConstruction(6, 0.004),
      develop: { candidateProvider: (f) => (f === "f1" ? [colonyOf("c1", 1_000_000)] : []), params: COLONY_PARAMS },
      player: { factionId: "f1", automation: { build: true, colonisation: false } },
    });
    expect(w.constructionProjects.some((p) => p.kind === "colony_establish")).toBe(false);
    expect(w.constructionProjects.some((p) => p.kind === "build")).toBe(true);
  });

  it("ignores automation entirely for non-player factions", async () => {
    const w = new MemoryDirectedBuildWorld(scenario(0, 0));
    await runDirectedBuildProcessor(w, { tick: DUE_TICK }, {
      interval: INTERVAL, routeCost: reachable,
      construction: mkConstruction(4),
      player: { factionId: "someone-else", automation: { build: false, colonisation: false } },
    });
    expect(w.constructionProjects.length).toBeGreaterThan(0); // f1 planned as usual
  });
});
