import { describe, it, expect } from "vitest";
import { runDirectedBuildProcessor } from "@/lib/tick/processors/directed-build";
import { MemoryDirectedBuildWorld } from "@/lib/tick/adapters/memory/directed-build";
import type { SystemBuildRow } from "@/lib/tick/world/directed-build-world";
import type { MarketRowForLogistics } from "@/lib/tick/world/directed-logistics-world";
import type { WorldConstructionProject } from "@/lib/world/types";
import { emptyResourceVector, unitResourceVector, RESOURCE_TYPES } from "@/lib/engine/resources";
import type { RouteCost } from "@/lib/engine/directed-logistics";
import type { ClaimCandidate, DevelopCandidate, ExpansionParams, DevelopParams } from "@/lib/engine/expansion";
import { mulberry32 } from "@/lib/engine/universe-gen";

const reachable: RouteCost = () => 1;

/** Construction params with a monotonic id minter. Big cap by default → projects land as pool allows. */
function mkConstruction(cap = 1000, throughputPerPop = 0.05) {
  let n = 0;
  return { cap, throughputPerPop, mintId: () => `proj-${n++}` };
}

// food market with a high demandRate so the band's targetStock is large — stock 1 is a deep deficit.
function foodMarket(systemId: string, stock: number): MarketRowForLogistics {
  return {
    id: `${systemId}|food`, goodId: "food", stock, basePrice: 10, anchorMult: 1,
    demandRate: 1000, priceFloor: 0.5, priceCeiling: 3.0, storageCapacity: 0,
  };
}

const INTERVAL = 4;
const DUE_TICK = 0;      // monthly pulse: every faction plans on ticks where tick % interval === 0
const NOT_DUE_TICK = 1;  // off-boundary tick: pulseShard window is empty, no faction is due

function builderSlots(n: number) {
  const slotCap = emptyResourceVector();
  for (const k of RESOURCE_TYPES) slotCap[k] = n;
  return slotCap;
}

// A: deep structural food deficit, no capacity. B: builder with arable slots + population, reachable from A.
function scenario(bFood: number, bHousing: number, slots = 20): SystemBuildRow[] {
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
      generalSpace: 100, habitableSpace: 100, markets: [],
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
      id: "e", factionId: "f1", systemId: "B", buildingType: "housing", levels: 2, workTotal: 16, workDone: 0,
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
      interval: INTERVAL, routeCost: reachable, construction: { cap: 1000, throughputPerPop: 0.0001, mintId: mkConstruction().mintId },
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
        interval: INTERVAL, routeCost: reachable, construction: { cap: 6, throughputPerPop: 0.05, mintId: mint },
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
    return w.constructionProjects.findIndex((p) => p.systemId === systemId && p.buildingType === type);
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
      id: "e", factionId: "f1", systemId: "B", buildingType: "food", levels: 2, workTotal: 24, workDone: 0,
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

const EXP_PARAMS: ExpansionParams = {
  maxClaimsPerPulse: 1, scoreFloor: 0.001, weights: { habitable: 1, diversity: 3, trait: 2, proximity: 0.5 },
};
const DEV_PARAMS: DevelopParams = {
  maxDevelopsPerPulse: 1, habitableFloor: 1, seedPop: 50, weights: { habitable: 1, diversity: 3, trait: 2, proximity: 0.5 },
};

// One developed owned system so the faction is in the shard, with no build needs.
function ownedOnly(factionId: string): SystemBuildRow {
  return {
    systemId: `${factionId}-home`, factionId, control: "developed", population: 100, unrest: 0,
    buildings: {}, yields: unitResourceVector(), slotCap: emptyResourceVector(),
    generalSpace: 0, habitableSpace: 0, markets: [],
  };
}

describe("runDirectedBuildProcessor: claim + develop phase", () => {
  it("claims the best in-reach candidate on a due tick", async () => {
    const w = new MemoryDirectedBuildWorld([ownedOnly("f1")]);
    const reachProvider = (f: string): ClaimCandidate[] =>
      f === "f1" ? [
        { systemId: "u-poor", minHops: 1, habitableSpace: 5, resourceDiversity: 0, traitQuality: 0 },
        { systemId: "u-rich", minHops: 1, habitableSpace: 200, resourceDiversity: 4, traitQuality: 0 },
      ] : [];
    await runDirectedBuildProcessor(w, { tick: DUE_TICK }, {
      interval: INTERVAL, routeCost: reachable, construction: mkConstruction(),
      claim: { reachProvider, rng: mulberry32(1), params: EXP_PARAMS },
    });
    expect(w.claims).toEqual([{ systemId: "u-rich", factionId: "f1" }]);
  });

  it("develops the best controlled candidate on a due tick", async () => {
    const w = new MemoryDirectedBuildWorld([ownedOnly("f1")]);
    const candidateProvider = (f: string): DevelopCandidate[] =>
      f === "f1" ? [{ systemId: "c1", habitableSpace: 100, resourceDiversity: 2, traitQuality: 0, sourceSystemId: "f1-home" }] : [];
    await runDirectedBuildProcessor(w, { tick: DUE_TICK }, {
      interval: INTERVAL, routeCost: reachable, construction: mkConstruction(),
      develop: { candidateProvider, params: DEV_PARAMS },
    });
    expect(w.developments).toEqual([{ systemId: "c1", sourceSystemId: "f1-home", seedPop: 50 }]);
  });

  it("claims/develops nothing off the pulse boundary", async () => {
    const w = new MemoryDirectedBuildWorld([ownedOnly("f1")]);
    await runDirectedBuildProcessor(w, { tick: NOT_DUE_TICK }, {
      interval: INTERVAL, routeCost: reachable, construction: mkConstruction(),
      claim: { reachProvider: () => [{ systemId: "u1", minHops: 1, habitableSpace: 100, resourceDiversity: 3, traitQuality: 0 }], rng: mulberry32(1), params: EXP_PARAMS },
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
