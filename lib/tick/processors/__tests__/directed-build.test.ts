import { describe, it, expect } from "vitest";
import { runDirectedBuildProcessor } from "@/lib/tick/processors/directed-build";
import { MemoryDirectedBuildWorld } from "@/lib/tick/adapters/memory/directed-build";
import type {
  SystemBuildRow,
  BuildBuildingUpdate,
  FoundingStagingDraw,
  FoundingStockLine,
  ProposalPersistenceUpdate,
  SystemClaim,
  SystemDevelopment,
} from "@/lib/tick/world/directed-build-world";
import type { TickProcessorResult } from "@/lib/tick/types";
import type { MarketRowForLogistics } from "@/lib/tick/world/directed-logistics-world";
import type { SystemControl, WorldColonyEstablishProject, WorldConstructionProject } from "@/lib/world/types";
import { emptyResourceVector, unitResourceVector, RESOURCE_TYPES } from "@/lib/engine/resources";
import type { RouteCost } from "@/lib/engine/directed-build";
import type { ClaimCandidate, ExpansionParams } from "@/lib/engine/expansion";
import { sizeColonyEstablish } from "@/lib/engine/directed-build";
import type { ColonyEstablishCandidate, ColonyEstablishParams } from "@/lib/engine/directed-build";
import { COLONISATION } from "@/lib/constants/colonisation";
import { EXPANSION } from "@/lib/constants/expansion";
import { CONSTRUCTION } from "@/lib/constants/construction";
import { HOUSING_TYPE, POP_CENTRE_DENSITY, CONSTRUCTION_CENTRE_TYPE, effectiveSpaceCost } from "@/lib/constants/industry";
import { REFERENCE_INTERVAL } from "@/lib/constants/tick-cadence";
import { mulberry32 } from "@/lib/engine/universe-gen";
import { surplusDrawable } from "@/lib/engine/directed-logistics";
import { consumptionRate, type CivilianDemandBasis } from "@/lib/engine/physical-economy";
import { foundingGoodsValue } from "@/lib/engine/founding-cost";
import { DIRECTED_LOGISTICS } from "@/lib/constants/directed-logistics";

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
// `proposalCycles` seeds the persisted construction clock: a structural build only emits once the
// residual has persisted PERSISTENCE_CYCLES assessments, so a single-cycle test seeds the prior one.
function foodMarket(systemId: string, stock: number, proposalCycles?: number): MarketRowForLogistics {
  return {
    id: `${systemId}|food`, goodId: "food", stock, anchorMult: 1,
    demandRate: 1000, storageCapacity: 0, proposalCycles,
  };
}

// Reference interval → catchUpFactor 1, so the shipped-magnitude assertions below are unscaled.
const INTERVAL = REFERENCE_INTERVAL;
const DUE_TICK = 0;      // cycle start: every faction plans on ticks where tick % interval === 0
const NOT_DUE_TICK = 1;  // off-boundary tick: cycleStartShard window is empty, no faction is due

function builderSlots(n: number) {
  const depositCounts = emptyResourceVector();
  for (const k of RESOURCE_TYPES) depositCounts[k] = n;
  return depositCounts;
}

// A: deep structural food deficit, no capacity. B: builder with arable slots + population, reachable from A.
// Factories, academies, complexes and construction centres bill no land at all (habitability-seeding
// deleted the industry-land budget, Task 15) — B's non-housing builds are never land-capped, so
// there is no widened-general-space knob left to expose here. `aOpts` lets the industry tests mark A
// developed (only developed systems contribute counted deficits) and seed its persisted proposal
// clock so the persistence-gated food build emits on the cycle under test; it defaults to the inert
// unclaimed A every pre-existing call site relies on.
function scenario(
  bFood: number,
  bHousing: number,
  slots = 20,
  aOpts?: { control?: SystemControl; foodCycles?: number },
): SystemBuildRow[] {
  return [
    {
      systemId: "A", factionId: "f1", control: aOpts?.control ?? "unclaimed", population: 100, buildings: {},
      yields: unitResourceVector(), extractionEff: unitResourceVector(), depositCounts: emptyResourceVector(),
 peopleLand: 0, markets: [foodMarket("A", 1, aOpts?.foodCycles)],
    },
    {
      systemId: "B", factionId: "f1", control: "developed", population: 5000,
      buildings: { food: bFood, housing: bHousing },
      yields: unitResourceVector(), extractionEff: unitResourceVector(), depositCounts: builderSlots(slots),
      peopleLand: 100, markets: [],
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
    // A tiny cap so no project completes this cycle — the queue holds the funded, in-flight work.
    await runDirectedBuildProcessor(w, { tick: DUE_TICK }, { interval: INTERVAL, routeCost: reachable, construction: mkConstruction(4) });
    expect(w.constructionProjects.length).toBeGreaterThan(0);
    expect(w.constructionProjects.every((p) => p.factionId === "f1")).toBe(true);
    // The pool funded the front of the queue (workDone advanced) but nothing has landed yet.
    expect(w.constructionProjects.some((p) => p.workDone > 0)).toBe(true);
    expect(w.buildingUpdates).toHaveLength(0);
  });

  it("lands whole integer levels once a project's work completes", async () => {
    const w = new MemoryDirectedBuildWorld(scenario(0, 0));
    // A generous pool (throughput 1/pop) completes the committed projects this cycle.
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

  it("reports work performed by the faction, equal to the work that entered the queue", async () => {
    const w = new MemoryDirectedBuildWorld(scenario(0, 0));
    // pool = 5000 × 0.05 = 250; cap = 4 (< any level's work cost, so nothing lands) →
    // absorbed must equal exactly the workDone advanced across the persisted queue.
    const result = await runDirectedBuildProcessor(w, { tick: DUE_TICK }, { interval: INTERVAL, routeCost: reachable, construction: mkConstruction(4) });
    const absorbed = result.workPerformedByFaction?.get("f1");
    const queuedWork = w.constructionProjects.reduce((acc, p) => acc + p.workDone, 0);
    expect(queuedWork).toBeGreaterThan(0);
    expect(absorbed).toBeCloseTo(queuedWork, 6);
    expect(absorbed).toBeLessThanOrEqual(5000 * 0.05);
  });

  it("plans nothing for a null-faction (independents) group and attributes no treasury work", async () => {
    // The engine skips null-faction systems at the proposal stage (only faction-owned
    // systems can be developed), so independents absorb nothing; this pins that invariant
    // and the treasury export's null-faction exclusion together — if independents ever
    // gain building, this fails and forces a conscious attribution decision.
    const w = new MemoryDirectedBuildWorld(scenario(0, 0).map((r) => ({ ...r, factionId: null, governmentType: "frontier" })));
    const result = await runDirectedBuildProcessor(w, { tick: DUE_TICK }, { interval: INTERVAL, routeCost: reachable, construction: mkConstruction(4) });
    expect(w.constructionProjects).toHaveLength(0);
    expect(w.buildingUpdates).toHaveLength(0);
    expect(result.workPerformedByFaction?.size ?? 0).toBe(0);
  });

  it("commits and funds nothing on an off-boundary tick (cycle start)", async () => {
    const w = new MemoryDirectedBuildWorld(scenario(0, 0));
    await runDirectedBuildProcessor(w, { tick: NOT_DUE_TICK }, { interval: INTERVAL, routeCost: reachable, construction: mkConstruction() });
    expect(w.buildingUpdates).toHaveLength(0);
    expect(w.constructionProjects).toHaveLength(0);
  });

  it("commits nothing when there is nothing to build (no deficit, no housing headroom)", async () => {
    const balanced: SystemBuildRow[] = [{
      systemId: "A", factionId: "f1", control: "developed", population: 0, buildings: {},
      yields: unitResourceVector(), extractionEff: unitResourceVector(), depositCounts: builderSlots(10), peopleLand: 0,
      markets: [foodMarket("A", 1)], // population 0 → no consumption → no rate deficit; no habitable land → no housing
    }];
    const w = new MemoryDirectedBuildWorld(balanced);
    await runDirectedBuildProcessor(w, { tick: DUE_TICK }, { interval: INTERVAL, routeCost: reachable, construction: mkConstruction() });
    expect(w.buildingUpdates).toHaveLength(0);
    expect(w.constructionProjects).toHaveLength(0);
  });

  it("accumulates a whole level across several cycles (committed and timed, not one-shot)", async () => {
    // A fed (no unmet goods) and calm developed system with room for a few housing levels. A small
    // pool + cap fund a slice each cycle, so the level lands only after several cycles of work.
    const base: SystemBuildRow = {
      systemId: "B", factionId: "f1", control: "developed", population: 300,
      buildings: {}, yields: unitResourceVector(), extractionEff: unitResourceVector(), depositCounts: emptyResourceVector(),
 peopleLand: 3, markets: [],
    };
    let rows: SystemBuildRow[] = [base];
    let projects: WorldConstructionProject[] = [];
    const mint = mkConstruction().mintId;
    let landedAtCycle = -1;
    for (let cycle = 0; cycle < 10; cycle++) {
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
      if ((rows[0].buildings.housing ?? 0) > 0 && landedAtCycle < 0) landedAtCycle = cycle;
    }
    const housing = rows[0].buildings.housing ?? 0;
    expect(housing).toBeGreaterThan(0);
    expect(Number.isInteger(housing)).toBe(true);
    // It did NOT land on the first cycle — the work cost spanned several cycles (throughput-paced).
    expect(landedAtCycle).toBeGreaterThan(0);
  });
});

describe("runDirectedBuildProcessor — value-order funding", () => {
  // The queue is [in-flight, ...new proposals in funding order]; with a tiny cap nothing lands, so
  // w.constructionProjects preserves that order and we can assert priority by index.
  function idx(w: MemoryDirectedBuildWorld, systemId: string, type: string): number {
    return w.constructionProjects.findIndex((p) => p.kind === "build" && p.systemId === systemId && p.buildingType === type);
  }

  it("funds housing ahead of industry at the same builder (proactive substrate leads)", async () => {
    // A is a developed food sink with a persisted proposal clock (only developed systems contribute
    // counted deficits, and the structural build is persistence-gated); B is a developed builder with
    // habitable land → B gets both a housing proposal and a food industry proposal. Housing sorts first.
    const w = new MemoryDirectedBuildWorld(scenario(0, 0, 20, { control: "developed", foodCycles: 1 }));
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
        systemId: "A1", factionId: "f1", control: "developed", population: 10, buildings: {},
        yields: unitResourceVector(), extractionEff: unitResourceVector(), depositCounts: emptyResourceVector(),
 peopleLand: 0, markets: [foodMarket("A1", 1, 1)],
      },
      {
        systemId: "A2", factionId: "f1", control: "developed", population: 100000, buildings: {},
        yields: unitResourceVector(), extractionEff: unitResourceVector(), depositCounts: emptyResourceVector(),
 peopleLand: 0, markets: [foodMarket("A2", 1, 1)],
      },
      {
        systemId: "B1", factionId: "f1", control: "developed", population: 5000, buildings: {},
        yields: unitResourceVector(), extractionEff: unitResourceVector(), depositCounts: builderSlots(20), peopleLand: 100, markets: [],
      },
      {
        systemId: "B2", factionId: "f1", control: "developed", population: 5000, buildings: {},
        yields: unitResourceVector(), extractionEff: unitResourceVector(), depositCounts: builderSlots(20), peopleLand: 100, markets: [],
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

describe("runDirectedBuildProcessor — proposal-pressure persistence (the construction clock)", () => {
  // A developed food SINK (no capacity) whose persisted proposal clock advances toward the saturating
  // PERSISTENCE_CYCLES while its structural residual survives; a covered good resets to 0. Distinct from
  // the economy's squeeze clock — this counter is written by directed-build, keyed by market id.
  const sink = (systemId: string, population: number, foodCycles?: number): SystemBuildRow => ({
    systemId, factionId: "f1", control: "developed", population,
    buildings: {}, yields: unitResourceVector(), extractionEff: unitResourceVector(), depositCounts: emptyResourceVector(),
 peopleLand: 0, markets: [foodMarket(systemId, 1, foodCycles)],
  });

  it("writes a saturating increment for a persistent deficit and a reset for a covered good", async () => {
    // A: a pop-100 sink whose residual survives (prior clock 1 → 2, capped). Z: a pop-0 sink → no demand
    // → no residual → the clock resets to 0. Both are due developed rows, so both write.
    const w = new MemoryDirectedBuildWorld([sink("A", 100, 1), sink("Z", 0, 1)]);
    await runDirectedBuildProcessor(w, { tick: DUE_TICK }, { interval: INTERVAL, routeCost: reachable, construction: mkConstruction(4) });
    expect(w.proposalCycleUpdates.get("A|food")).toBe(2); // residual persists → saturating increment
    expect(w.proposalCycleUpdates.get("Z|food")).toBe(0); // no demand → reset
    // Exactly the two assessed rows — nothing else reached the counter's write batch.
    expect(w.proposalCycleUpdates.size).toBe(2);
  });

  it("writes nothing on an off-boundary tick (the clock is cycle-cadenced)", async () => {
    const w = new MemoryDirectedBuildWorld([sink("A", 100, 1)]);
    await runDirectedBuildProcessor(w, { tick: NOT_DUE_TICK }, { interval: INTERVAL, routeCost: reachable, construction: mkConstruction(4) });
    expect(w.proposalCycleUpdates.size).toBe(0);
  });

  it("advances the clock by the interval's reference-time (catchUpFactor), not a flat step", async () => {
    // A finer cadence advances the clock a fraction of a reference cycle per resolution; a coarser one
    // advances more (and can saturate in one assessment) — so the persistence latency is the same
    // wall-clock span at any construction cadence. Both ticks are a cycle boundary for their interval.
    const fine = new MemoryDirectedBuildWorld([sink("A", 100, 0)]);
    await runDirectedBuildProcessor(fine, { tick: DUE_TICK }, { interval: 12, routeCost: reachable, construction: mkConstruction(4) });
    expect(fine.proposalCycleUpdates.get("A|food")).toBeCloseTo(0.5, 6); // catchUpFactor(12) = 0.5

    const coarse = new MemoryDirectedBuildWorld([sink("A", 100, 0)]);
    await runDirectedBuildProcessor(coarse, { tick: DUE_TICK }, { interval: 48, routeCost: reachable, construction: mkConstruction(4) });
    expect(coarse.proposalCycleUpdates.get("A|food")).toBe(2); // catchUpFactor(48) = 2 saturates in one
  });

  it("advances the clock with the player's build automation off, yet emits no proposals", async () => {
    // Build automation off gates PROPOSAL EMISSION, not the assessment: no new work is committed for the
    // faction, but the construction clock still advances at the developed sink.
    const w = new MemoryDirectedBuildWorld(scenario(0, 0, 20, { control: "developed", foodCycles: 1 }));
    await runDirectedBuildProcessor(w, { tick: DUE_TICK }, {
      interval: INTERVAL, routeCost: reachable, construction: mkConstruction(4),
      player: { factionId: "f1", automation: { build: false, colonisation: true } },
    });
    expect(w.constructionProjects).toHaveLength(0);       // emission gated off
    expect(w.proposalCycleUpdates.get("A|food")).toBe(2); // …but the clock still advanced
  });

  it("advances the build clock regardless of the colony automation switch (independent domains)", async () => {
    // Colonisation off must not touch the build-domain construction clock: build stays on, so the food
    // build still emits AND the clock advances — the colony switch is orthogonal to it.
    const w = new MemoryDirectedBuildWorld(scenario(0, 0, 20, { control: "developed", foodCycles: 1 }));
    await runDirectedBuildProcessor(w, { tick: DUE_TICK }, {
      interval: INTERVAL, routeCost: reachable, construction: mkConstruction(4),
      player: { factionId: "f1", automation: { build: true, colonisation: false } },
    });
    expect(w.proposalCycleUpdates.get("A|food")).toBe(2);
    expect(w.constructionProjects.some((p) => p.kind === "build" && p.systemId === "B" && p.buildingType === "food")).toBe(true);
  });

  it("Proves 5 — turning build automation off does not blank the Build blocked field; only proposal emission is gated", async () => {
    // C is developed with a single arable slot it has already built out — a real blocked food build,
    // whatever happens elsewhere. (A, developed with no arable deposit at all, is not: it could never
    // have hosted a food extractor, so it reports nothing — asserted below so this fixture keeps
    // saying which of the two "capacity is 0" states is the reportable one.) B has real capacity and
    // lands the food build when automation allows it. C holds no population and no market rows, so it
    // neither feeds the construction pool nor moves the deficit the other two are assessed on.
    const saturatedSlots = emptyResourceVector();
    saturatedSlots.arable = 1;
    const rows = (): SystemBuildRow[] => [
      ...scenario(0, 0, 20, { control: "developed", foodCycles: 1 }),
      {
        systemId: "C", factionId: "f1", control: "developed", population: 0,
        buildings: { food: 1 }, yields: unitResourceVector(), extractionEff: unitResourceVector(), depositCounts: { ...saturatedSlots },
 peopleLand: 0, markets: [],
      },
    ];
    const on = new MemoryDirectedBuildWorld(rows());
    await runDirectedBuildProcessor(on, { tick: DUE_TICK }, {
      interval: INTERVAL, routeCost: reachable, construction: mkConstruction(4),
      player: { factionId: "f1", automation: { build: true, colonisation: true } },
    });
    const off = new MemoryDirectedBuildWorld(rows());
    await runDirectedBuildProcessor(off, { tick: DUE_TICK }, {
      interval: INTERVAL, routeCost: reachable, construction: mkConstruction(4),
      player: { factionId: "f1", automation: { build: false, colonisation: true } },
    });

    // Proposal EMISSION differs, as the existing tests above already pin…
    expect(on.constructionProjects.some((p) => p.kind === "build" && p.systemId === "B")).toBe(true);
    expect(off.constructionProjects).toHaveLength(0);

    // …but the Build blocked assessment itself does not: same visited set, same report, on both runs.
    expect(off.buildBlockedVisitedSystemIds.slice().sort()).toEqual(on.buildBlockedVisitedSystemIds.slice().sort());
    expect(off.buildBlockedUpdates).toEqual(on.buildBlockedUpdates);
    expect(on.buildBlockedUpdates.some((u) => u.systemId === "C" && u.reason === "no-capacity")).toBe(true);
    expect(on.buildBlockedUpdates.some((u) => u.systemId === "A")).toBe(false);
  });

  it("Proves 1 — turning build automation off does not blank Build opportunity either; only proposal emission is gated", async () => {
    // Same scenario as Build blocked's own "Proves 5" directly above: B has real capacity and a
    // reachable food deficit at A, so it scores a real opportunity whether or not automation lands
    // the build.
    const on = new MemoryDirectedBuildWorld(scenario(0, 0, 20, { control: "developed", foodCycles: 1 }));
    await runDirectedBuildProcessor(on, { tick: DUE_TICK }, {
      interval: INTERVAL, routeCost: reachable, construction: mkConstruction(4),
      player: { factionId: "f1", automation: { build: true, colonisation: true } },
    });
    const off = new MemoryDirectedBuildWorld(scenario(0, 0, 20, { control: "developed", foodCycles: 1 }));
    await runDirectedBuildProcessor(off, { tick: DUE_TICK }, {
      interval: INTERVAL, routeCost: reachable, construction: mkConstruction(4),
      player: { factionId: "f1", automation: { build: false, colonisation: true } },
    });

    // Proposal EMISSION differs, as the existing tests above already pin…
    expect(on.constructionProjects.some((p) => p.kind === "build" && p.systemId === "B")).toBe(true);
    expect(off.constructionProjects).toHaveLength(0);

    // …but the Build opportunity assessment itself does not: same visited set, same report, on both runs.
    expect(off.buildOpportunityVisitedSystemIds.slice().sort()).toEqual(on.buildOpportunityVisitedSystemIds.slice().sort());
    expect(off.buildOpportunityUpdates).toEqual(on.buildOpportunityUpdates);
    expect(on.buildOpportunityUpdates.some((u) => u.systemId === "B" && u.goodId === "food")).toBe(true);
  });

  // A developed food SELF-SUPPLIER: buildings cover 1.1× demand (no capacity gap) and a persisted realised
  // rate of 0 keeps it off the exporter self-netting path — so the ONLY thing that can advance its clock is
  // the squeeze-feedback gap, isolating the two guards that suppress it.
  const rationedSelfSupplier = (extra: Partial<MarketRowForLogistics>): SystemBuildRow => ({
    systemId: "S", factionId: "f1", control: "developed", population: 20,
    buildings: { food: 10 }, yields: unitResourceVector(), extractionEff: unitResourceVector(), depositCounts: builderSlots(50), peopleLand: 0,
    markets: [{
      id: "S|food", goodId: "food", stock: 50, anchorMult: 1, demandRate: 10, storageCapacity: 0,
      squeezeCycles: 2, satisfaction: 0, realisedProductionRate: 0, proposalCycles: 1, ...extra,
    }],
  });

  it("advances the clock from a persistent squeeze when nothing blocks the feedback", async () => {
    const w = new MemoryDirectedBuildWorld([rationedSelfSupplier({})]);
    await runDirectedBuildProcessor(w, { tick: DUE_TICK }, { interval: INTERVAL, routeCost: reachable, construction: mkConstruction(4) });
    expect(w.proposalCycleUpdates.get("S|food")).toBe(2); // squeeze feedback survives → increment
  });

  it("a fresh same-tick funding-bound match blocks the squeeze-feedback advance", async () => {
    const w = new MemoryDirectedBuildWorld([rationedSelfSupplier({ logisticsFundingBound: true })]);
    await runDirectedBuildProcessor(w, { tick: DUE_TICK }, { interval: INTERVAL, routeCost: reachable, construction: mkConstruction(4) });
    expect(w.proposalCycleUpdates.get("S|food")).toBe(0); // feedback blocked, no capacity gap → reset
  });

  it("persisted production suppression blocks the construction-only feedback advance", async () => {
    const w = new MemoryDirectedBuildWorld([rationedSelfSupplier({ productionSuppressed: true })]);
    await runDirectedBuildProcessor(w, { tick: DUE_TICK }, { interval: INTERVAL, routeCost: reachable, construction: mkConstruction(4) });
    expect(w.proposalCycleUpdates.get("S|food")).toBe(0); // suppressed output is transient, not a deficit → reset
  });
});

describe("construction centres", () => {
  it("commits a centre project when the backlog runs beyond the frontier", async () => {
    // Deficit scenario with the pool throttled so committed work vastly outruns what BACKLOG_WINDOW
    // cycles can drain (tiny throughputPerPop → deep starved backlog → a centre is proposed), and a
    // SMALL cap so the pool spreads across parallel fronts — the high-ROI centre must actually
    // receive work this cycle, because persist-if-funded drops a workless centre (next test). B's
    // general space is widened past its habitable cap (1000 vs the default 100) so a centre can still
    // site itself once housing has claimed its habitable-bounded 100-unit share. A is a developed food
    // sink with a saturated proposal clock so the persistence-gated food backlog actually forms.
    const w = new MemoryDirectedBuildWorld(scenario(0, 0, 20, { control: "developed", foodCycles: 1 }));
    await runDirectedBuildProcessor(w, { tick: DUE_TICK }, {
      interval: INTERVAL, routeCost: reachable,
      construction: mkConstruction(2, 0.001),
    });
    const centres = w.constructionProjects.filter(
      (p) => p.kind === "build" && p.buildingType === CONSTRUCTION_CENTRE_TYPE,
    );
    expect(centres.length).toBe(1); // planCentreProposal commits at most one centre per cycle
    // The high-ROI centre proposal actually receives work this cycle (persist-if-funded next test
    // proves the converse) — not merely committed.
    expect(centres.some((p) => p.workDone > 0)).toBe(true);
  });

  it("drops an unfunded centre project instead of persisting it (persist-if-funded)", async () => {
    // Same starved world (same widened general space, so siting still succeeds), pool ≈ 0: the centre
    // proposal is committed but receives no work, so it must NOT appear in the persisted open set.
    const w = new MemoryDirectedBuildWorld(scenario(0, 0, 20));
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
    // A world tuned so the backlog (one 12-work ore bundle; housing is already at its habitable cap,
    // so it proposes nothing) sits just above the reference-interval frontier budget
    // (poolRef.total=0.1 × BACKLOG_WINDOW=60 = 6 < 12) but just below what a WRONGLY-scaled budget
    // would read at catchUp=2 (0.1 × 2 × 60 = 12, no longer < 12) — so a regression that fed the
    // scaled funding pool into planCentreProposal (instead of the unscaled poolRef.total) would
    // commit a centre at the reference interval (24) but NOT at interval 48, while the correct
    // unscaled valuation commits at both (mirrors the non-reference-interval construction in
    // "interval invariance" below). Ore, not food: a survival-serving backlog would now claim the
    // shared pool ahead of the centre by band alone (the survival funding band), which is a
    // different mechanism than the interval-invariant pricing this test isolates.
    const fullyHoused: SystemBuildRow[] = [
      {
        systemId: "A", factionId: "f1", control: "developed", population: 100, buildings: {},
        yields: unitResourceVector(), extractionEff: unitResourceVector(), depositCounts: emptyResourceVector(),
        peopleLand: 0, markets: [{ id: "A|ore", goodId: "ore", stock: 1, anchorMult: 1, demandRate: 1000, storageCapacity: 0, proposalCycles: 1 }],
      },
      {
        systemId: "B", factionId: "f1", control: "developed", population: 5000,
        buildings: { housing: 100 },
        yields: unitResourceVector(), extractionEff: unitResourceVector(), depositCounts: builderSlots(20),
        peopleLand: 100, markets: [],
      },
    ];
    const committed = async (interval: number): Promise<boolean> => {
      const w = new MemoryDirectedBuildWorld(fullyHoused);
      await runDirectedBuildProcessor(w, { tick: DUE_TICK }, {
        interval, routeCost: reachable,
        construction: mkConstruction(2, 0.00002),
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
  maxClaimsPerCycle: 1, scoreFloor: 0.001, weights: { habitable: 1, diversity: 3, proximity: 0.5 },
  peopleLandMax: 1000,
};
const COLONY_PARAMS: ColonyEstablishParams = {
  landPremium: COLONISATION.LAND_PREMIUM,
  landDepositWeight: COLONISATION.LAND_DEPOSIT_WEIGHT,
  sigmaFloor: COLONISATION.SIGMA_FLOOR,
  establishWork: COLONISATION.COLONY_ESTABLISH_WORK,
  seedPop: EXPANSION.COLONY_SEED_POP,
  habitableFloor: effectiveSpaceCost(HOUSING_TYPE),
  popCostWeight: COLONISATION.SEED_POP_COST_WEIGHT,
  minSettlerSupply: 0, // gate disabled — these cases exercise proposal/funding wiring, not founding pace
  employedLeakFraction: 0,
  charterMult: COLONISATION.CHARTER_FEE_SPEND_MULT,
  charterMin: COLONISATION.CHARTER_FEE_MIN,
  gateHeadroom: COLONISATION.FOUNDING_GATE_HEADROOM,
  foundingStockCover: COLONISATION.FOUNDING_STOCK_COVER,
  economyScale: 1,
};

/** A developed home with housing filling all its habitable land (σ = 1) and no build deficits — so the
 *  pool funds only colonies. Population sets the throughput pool. */
function saturatedHome(population: number): SystemBuildRow {
  return {
    systemId: "home", factionId: "f1", control: "developed", population,
    buildings: { [HOUSING_TYPE]: 5 },
    yields: unitResourceVector(), extractionEff: unitResourceVector(), depositCounts: emptyResourceVector(),
 peopleLand: 5, markets: [], // habitable fully housed (5 levels) → σ = 1, no housing headroom
  };
}

function colonyCand(systemId: string, peopleLand = 100): ColonyEstablishCandidate {
  return { systemId, peopleLand, depositCounts: emptyResourceVector(), sourceSystemId: "home" };
}

// One developed owned system so the faction is in the shard, with no build needs.
function ownedOnly(factionId: string): SystemBuildRow {
  return {
    systemId: `${factionId}-home`, factionId, control: "developed", population: 100,
    buildings: {}, yields: unitResourceVector(), extractionEff: unitResourceVector(), depositCounts: emptyResourceVector(),
 peopleLand: 0, markets: [],
  };
}

describe("runDirectedBuildProcessor: claim phase", () => {
  it("claims the best in-reach candidate on a due tick", async () => {
    const w = new MemoryDirectedBuildWorld([ownedOnly("f1")]);
    const reachProvider = (f: string): ClaimCandidate[] =>
      f === "f1" ? [
        { systemId: "u-poor", minHops: 1, peopleLand: 5, resourceDiversity: 0 },
        { systemId: "u-rich", minHops: 1, peopleLand: 200, resourceDiversity: 4 },
      ] : [];
    await runDirectedBuildProcessor(w, { tick: DUE_TICK }, {
      interval: INTERVAL, routeCost: reachable, construction: mkConstruction(),
      claim: { reachProvider, rng: mulberry32(1), params: EXP_PARAMS },
    });
    expect(w.claims).toEqual([{ systemId: "u-rich", factionId: "f1" }]);
  });

  it("claims nothing off the cycle boundary", async () => {
    const w = new MemoryDirectedBuildWorld([ownedOnly("f1")]);
    await runDirectedBuildProcessor(w, { tick: NOT_DUE_TICK }, {
      interval: INTERVAL, routeCost: reachable, construction: mkConstruction(),
      claim: { reachProvider: () => [{ systemId: "u1", minHops: 1, peopleLand: 100, resourceDiversity: 3 }], rng: mulberry32(1), params: EXP_PARAMS },
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
  it("does NOT develop on the cycle it is proposed — the colony-establish accrues work over cycles", async () => {
    const w = new MemoryDirectedBuildWorld([saturatedHome(1000)]);
    // A tiny cap so the establish project cannot complete this cycle.
    await runDirectedBuildProcessor(w, { tick: DUE_TICK }, {
      interval: INTERVAL, routeCost: reachable, construction: mkConstruction(4),
      develop: { candidateProvider: (f) => (f === "f1" ? [colonyCand("c1")] : []), params: COLONY_PARAMS },
    });
    expect(w.developments).toHaveLength(0); // not flipped this cycle
    const colony = w.constructionProjects.find((p) => p.kind === "colony_establish");
    expect(colony).toBeDefined();
    expect(colony!.systemId).toBe("c1");
    // establishWork exceeds the base by the bundled seed-housing's build cost (housing is paid for).
    expect(colony!.workTotal).toBeGreaterThan(COLONISATION.COLONY_ESTABLISH_WORK);
  });

  it("develops the colony once the establish project completes (seed + bundled housing landing)", async () => {
    const w = new MemoryDirectedBuildWorld([saturatedHome(1000)]);
    // A generous pool + cap completes the establish this cycle.
    await runDirectedBuildProcessor(w, { tick: DUE_TICK }, {
      interval: INTERVAL, routeCost: reachable, construction: mkConstruction(1000, 1),
      develop: { candidateProvider: (f) => (f === "f1" ? [colonyCand("c1")] : []), params: COLONY_PARAMS },
    });
    expect(w.developments).toHaveLength(1);
    const dev = w.developments[0];
    expect(dev.systemId).toBe("c1");
    expect(dev.sourceSystemId).toBe("home");
    expect(dev.seedPop).toBe(EXPANSION.COLONY_SEED_POP);
    // Viable by construction: bundled housing houses the whole seed and no more (the candidate's land
    // here is generous, so the whole-level habitable cap never clamps it back down).
    expect(dev.housingLevels).toBe(Math.ceil(dev.seedPop / POP_CENTRE_DENSITY));
    expect(dev.housingLevels * POP_CENTRE_DENSITY).toBeGreaterThanOrEqual(dev.seedPop);
    // The completed establish project is removed from the open queue.
    expect(w.constructionProjects.some((p) => p.kind === "colony_establish")).toBe(false);
  });

  it("bounds the open queue: with many candidates and a small pool, only funded colonies persist", async () => {
    // A Construction Centre is never land-gated (habitability-seeding deleted the industry-land
    // budget, Task 15) — it can now always find a site given any economically-active system with
    // spare labour, and `planCentreProposal`'s starved-backlog frontier is priced off the SAME
    // `ordered` queue colony proposals feed too, so a deep colony backlog alone (no build deficit
    // needed at all) is enough to price and fund a centre. That would eat this test's tiny pool
    // and starve every colony it means to isolate on, so build automation (centre siting is
    // build-domain work) is switched off while colonisation automation stays on — the same
    // isolation the sibling "player's build automation is off" test below uses, just for the
    // opposite reason (there to prove no centre slips in; here to keep one from crowding out colonies).
    const w = new MemoryDirectedBuildWorld([saturatedHome(80)]); // pool = 80 × 0.05 = 4 → one cap-worth
    const candidates = ["c1", "c2", "c3", "c4", "c5"].map((id) => colonyCand(id));
    await runDirectedBuildProcessor(w, { tick: DUE_TICK }, {
      interval: INTERVAL, routeCost: reachable, construction: mkConstruction(4),
      develop: { candidateProvider: (f) => (f === "f1" ? candidates : []), params: COLONY_PARAMS },
      player: { factionId: "f1", automation: { build: false, colonisation: true } },
    });
    const openColonies = w.constructionProjects.filter((p) => p.kind === "colony_establish");
    // Front-first funding gives one colony a cap's worth; the other four get zero and are dropped.
    expect(openColonies.length).toBeLessThan(candidates.length);
    expect(openColonies.length).toBeGreaterThanOrEqual(1);
    for (const p of openColonies) expect(p.workDone).toBeGreaterThan(0);
  });

  it("develops nothing off the cycle boundary", async () => {
    const w = new MemoryDirectedBuildWorld([saturatedHome(1000)]);
    await runDirectedBuildProcessor(w, { tick: NOT_DUE_TICK }, {
      interval: INTERVAL, routeCost: reachable, construction: mkConstruction(1000, 1),
      develop: { candidateProvider: () => [colonyCand("c1")], params: COLONY_PARAMS },
    });
    expect(w.developments).toHaveLength(0);
    expect(w.constructionProjects).toHaveLength(0);
  });

  it("Proves 1 — advances Colony opportunity's assessment with colonisation automation off, yet emits no colony proposal", async () => {
    const on = new MemoryDirectedBuildWorld([saturatedHome(1000)]);
    await runDirectedBuildProcessor(on, { tick: DUE_TICK }, {
      interval: INTERVAL, routeCost: reachable, construction: mkConstruction(4),
      develop: { candidateProvider: (f) => (f === "f1" ? [colonyCand("c1")] : []), params: COLONY_PARAMS },
      player: { factionId: "f1", automation: { build: true, colonisation: true } },
    });
    const off = new MemoryDirectedBuildWorld([saturatedHome(1000)]);
    await runDirectedBuildProcessor(off, { tick: DUE_TICK }, {
      interval: INTERVAL, routeCost: reachable, construction: mkConstruction(4),
      develop: { candidateProvider: (f) => (f === "f1" ? [colonyCand("c1")] : []), params: COLONY_PARAMS },
      player: { factionId: "f1", automation: { build: true, colonisation: false } },
    });

    // Proposal EMISSION differs…
    expect(on.constructionProjects.some((p) => p.kind === "colony_establish")).toBe(true);
    expect(off.constructionProjects.some((p) => p.kind === "colony_establish")).toBe(false);

    // …but the Colony opportunity assessment itself does not: same visited (candidate) set, same
    // terms, on both runs.
    expect(off.colonyOpportunityVisitedSystemIds.slice().sort()).toEqual(on.colonyOpportunityVisitedSystemIds.slice().sort());
    expect(off.colonyOpportunityUpdates).toEqual(on.colonyOpportunityUpdates);
    expect(on.colonyOpportunityUpdates.some((u) => u.systemId === "c1")).toBe(true);
  });

  it("maps the planner's own ROI terms onto the update — `value` the numerator, `work` the denominator, never swapped", async () => {
    // Both terms are plain numbers and interchangeable to the type checker, so swapping them
    // compiles, passes every existence check, and silently inverts the alert bar's ROI sort. `work`
    // is the one of the two that is independently computable: the establish-plus-housing
    // construction denominator the engine's own exported sizing produces from the candidate's land,
    // with nothing to do with the deficits `value` scores.
    const w = new MemoryDirectedBuildWorld([saturatedHome(1000)]);
    const habitableBySystem: Record<string, number> = { c1: 100, c2: 40 };
    await runDirectedBuildProcessor(w, { tick: DUE_TICK }, {
      interval: INTERVAL, routeCost: reachable, construction: mkConstruction(4),
      develop: {
        candidateProvider: (f) =>
          f === "f1" ? [colonyCand("c1", habitableBySystem.c1), colonyCand("c2", habitableBySystem.c2)] : [],
        params: COLONY_PARAMS,
      },
    });

    expect(w.colonyOpportunityUpdates.length).toBeGreaterThan(0);
    for (const u of w.colonyOpportunityUpdates) {
      const sizing = sizeColonyEstablish(habitableBySystem[u.systemId], COLONY_PARAMS);
      if (!sizing) throw new Error(`fixture: ${u.systemId} is not a viable colony site`);
      expect(u.work, u.systemId).toBeCloseTo(sizing.work, 9);
      // Non-vacuous on the swap: the two terms are different numbers here, so writing `value` into
      // `work` could not coincidentally satisfy the assertion above.
      expect(u.value, u.systemId).toBeGreaterThan(0);
      expect(Math.abs(u.value - sizing.work), u.systemId).toBeGreaterThan(1);
    }
  });
});

describe("runDirectedBuildProcessor: the charter", () => {
  // charterMult 0 + charterMin 100 ⇒ every charter is exactly 100, and headroom over a source with no
  // market rows adds nothing — so the money figures below are stated, not recomputed through the
  // pricing functions under test.
  const FEE = 100;
  const FLAT_FEE_PARAMS: ColonyEstablishParams = { ...COLONY_PARAMS, charterMult: 0, charterMin: FEE };

  function purse(balance: number, pendingFounding = 0) {
    return new Map([["f1", { balance, pendingFounding, maintenanceBill: 0 }]]);
  }

  it("charges one charter per colony across a multi-cycle stall, never one per cycle", async () => {
    // A faction with pool 0 (population 0): the colony it commits to gets zero work on its first
    // cycle and every cycle after. It is paid for, so it must stay on the queue — dropping it would
    // put the same candidate back in front of the planner next cycle under a fresh id, and the
    // faction would buy the same colony again.
    let projects: WorldConstructionProject[] = [];
    let committed = 0;
    const everPaid = new Set<string>();
    for (let cycle = 0; cycle < 5; cycle++) {
      const w = new MemoryDirectedBuildWorld([saturatedHome(0)], projects);
      const r = await runDirectedBuildProcessor(w, { tick: DUE_TICK }, {
        interval: INTERVAL, routeCost: reachable, construction: mkConstruction(4),
        develop: { candidateProvider: (f) => (f === "f1" ? [colonyCand("c1")] : []), params: FLAT_FEE_PARAMS },
        // Balance never settles in this test, so what has already been committed stays pending.
        treasuryByFaction: purse(10_000, committed),
      });
      committed += r.foundingDebitsByFaction?.get("f1") ?? 0;
      projects = w.constructionProjects;
      for (const p of projects) if (p.kind === "colony_establish" && p.charterPaid) everPaid.add(p.id);
    }
    expect(committed).toBe(FEE);              // bought once, not once per cycle
    expect(everPaid.size).toBe(1);            // and it is still the same project row
    expect(projects).toHaveLength(1);
    expect(projects[0].workDone).toBe(0);     // it really did stall — this is not a colony that built
  });

  it("commits no more charters in one cycle than the faction's opening balance covers", async () => {
    // Five colonies already on the queue with unpaid charters — the planner's own gate never saw
    // them, so the charter phase's running balance is the only thing standing between a faction with
    // 250 in hand and 500 of charters.
    const waiting: WorldConstructionProject[] = Array.from({ length: 5 }, (_, i) => ({
      kind: "colony_establish", id: `wait-${i}`, origin: "auto", factionId: "f1",
      systemId: `c${i}`, sourceSystemId: "home", seedPop: 2, housingLevels: 1,
      workTotal: 10_000, workDone: 1, stagedManifest: [], charterPaid: false, stalledCycles: 0,
    }));
    const w = new MemoryDirectedBuildWorld([saturatedHome(1000)], waiting);
    const r = await runDirectedBuildProcessor(w, { tick: DUE_TICK }, {
      interval: INTERVAL, routeCost: reachable, construction: mkConstruction(4),
      develop: { candidateProvider: () => [], params: FLAT_FEE_PARAMS },
      treasuryByFaction: purse(250),
    });
    const paid = w.constructionProjects.filter((p) => p.kind === "colony_establish" && p.charterPaid);
    expect(paid).toHaveLength(2);                                  // 250 buys two charters, not five
    expect(r.foundingDebitsByFaction?.get("f1")).toBe(2 * FEE);
    expect(r.foundingDebitsByFaction?.get("f1") ?? 0).toBeLessThanOrEqual(250);
  });

  it("persists a Colony opportunity for the candidate the money gate cut from founding", async () => {
    // Money for exactly one charter and two same-priced candidates: the planner commits one colony,
    // but BOTH carry the pre-gate assessment — the alert-bar signal must not shrink with the
    // treasury, or two equal sites show as one the moment the purse covers only the first.
    const w = new MemoryDirectedBuildWorld([saturatedHome(1000)]);
    await runDirectedBuildProcessor(w, { tick: DUE_TICK }, {
      interval: INTERVAL, routeCost: reachable, construction: mkConstruction(4),
      develop: {
        candidateProvider: (f) => (f === "f1" ? [colonyCand("c1"), colonyCand("c2")] : []),
        params: FLAT_FEE_PARAMS,
      },
      treasuryByFaction: purse(FEE),
    });
    expect(w.constructionProjects.filter((p) => p.kind === "colony_establish")).toHaveLength(1);
    expect(new Set(w.colonyOpportunityUpdates.map((u) => u.systemId))).toEqual(new Set(["c1", "c2"]));
  });

  it("leaves founding unpriced when the faction has no purse (the build-only path)", async () => {
    const w = new MemoryDirectedBuildWorld([saturatedHome(1000)]);
    const r = await runDirectedBuildProcessor(w, { tick: DUE_TICK }, {
      interval: INTERVAL, routeCost: reachable, construction: mkConstruction(4),
      develop: { candidateProvider: (f) => (f === "f1" ? [colonyCand("c1")] : []), params: FLAT_FEE_PARAMS },
    });
    expect(w.constructionProjects.some((p) => p.kind === "colony_establish")).toBe(true);
    expect(r.foundingDebitsByFaction?.size ?? 0).toBe(0);
  });
});

/** A developed home saturated on housing (σ = 1, no housing headroom) but carrying a deep ore deficit
 *  with spare labour + ore slots — so it emits a non-survival industry build proposal that competes
 *  with a colony in the same pool, uncontaminated by the survival funding band
 *  a food/water deficit would now add. `proposalCycles: 1` seeds the persisted clock so the
 *  persistence-gated structural residual actually forms in one assessment — food/water get this for
 *  free via the speculative floor (`SPECULATIVE_BASICS`), ore does not. Population sets labour; the
 *  pool is kept scarce via mkConstruction's rate. */
function homeWithOreDeficit(population = 1000): SystemBuildRow {
  return {
    systemId: "home", factionId: "f1", control: "developed", population,
    buildings: { [HOUSING_TYPE]: 5 },
    yields: unitResourceVector(), extractionEff: unitResourceVector(), depositCounts: builderSlots(20),
 peopleLand: 5, // habitable fully housed → σ = 1
    markets: [{ id: "home|ore", goodId: "ore", stock: 1, anchorMult: 1, demandRate: 1000, storageCapacity: 0, proposalCycles: 1 }],
  };
}

function colonyOf(systemId: string, peopleLand: number): ColonyEstablishCandidate {
  return { systemId, peopleLand, depositCounts: emptyResourceVector(), sourceSystemId: "home" };
}

describe("runDirectedBuildProcessor: build-vs-colony ROI arbitration (one shared pool)", () => {
  it("funds a high-ROI local build ahead of a low-value colony (colony deferred)", async () => {
    const w = new MemoryDirectedBuildWorld([homeWithOreDeficit(1000)]);
    // pool = 1000 × 0.004 = 4 → one cap-worth; only the front of the ROI-ordered queue funds this cycle.
    await runDirectedBuildProcessor(w, { tick: DUE_TICK }, {
      interval: INTERVAL, routeCost: reachable, construction: mkConstruction(6, 0.004),
      // A barren colony (habitable 2, no deposits) scores colonyValue ≈ ROI 0.08 vs the ore build's ≈ 0.25,
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
    const w = new MemoryDirectedBuildWorld([homeWithOreDeficit(1000)]);
    await runDirectedBuildProcessor(w, { tick: DUE_TICK }, {
      interval: INTERVAL, routeCost: reachable, construction: mkConstruction(6, 0.004),
      // Same home/deficit; only the colony's land changes — enormous habitable → colonyValue ROI ≫ the
      // build's 0.25, so the colony dominates the shared pool front-first.
      develop: { candidateProvider: (f) => (f === "f1" ? [colonyOf("c1", 1_000_000)] : []), params: COLONY_PARAMS },
    });
    const fundedColony = w.constructionProjects.find((p) => p.kind === "colony_establish");
    expect(fundedColony).toBeDefined();
    expect(fundedColony!.workDone).toBeGreaterThan(0);
    // The ore build was proposed but starved of the pool this cycle (builds persist at workDone 0).
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
      systemId: "H", factionId: "f1", control: "developed", population: 400,
      buildings: { [HOUSING_TYPE]: 20 }, yields: unitResourceVector(), extractionEff: unitResourceVector(), depositCounts: emptyResourceVector(),
 peopleLand: 20, markets: [],
    },
    {
      systemId: "C", factionId: "f1", control: "developed", population: 2,
      buildings: { [HOUSING_TYPE]: 20 }, yields: unitResourceVector(), extractionEff: unitResourceVector(), depositCounts: emptyResourceVector(),
 peopleLand: 20, markets: [],
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
    systemId: "B", factionId: "f1", control: "developed", population,
    buildings: { [HOUSING_TYPE]: 5 }, yields: unitResourceVector(), extractionEff: unitResourceVector(), depositCounts: emptyResourceVector(),
 peopleLand: 5, markets: [],
  });

  it("interval scaling preserves wall-clock minimum build time", async () => {
    // One in-flight project whose work is exactly 2 × the reference cap, pool ample (cap binds). At
    // interval 24 (catchUp 1) it lands after 2 cycles; at interval 12 (catchUp 0.5) the effective cap
    // halves, so it needs 4 cycles — 2×24 = 4×12 = 48 wall-clock ticks either way. Single-level: a
    // multi-level project here would land its first level (a real `buildingUpdates` write) the moment
    // work crosses that level's own boundary, which is a different — also correct — invariant this
    // case isn't testing.
    const project = (): WorldConstructionProject => ({
      id: "e", kind: "build", origin: "auto", factionId: "f1", systemId: "B", buildingType: HOUSING_TYPE, levels: 1, workTotal: 2 * CAP, workDone: 0,
    });
    const landingCycle = async (interval: number): Promise<number> => {
      let rows: SystemBuildRow[] = [idleBuilder(5000)];
      let projects: WorldConstructionProject[] = [project()];
      for (let cycle = 1; cycle <= 8; cycle++) {
        const w = new MemoryDirectedBuildWorld(rows, projects);
        // Ample pool (throughput 1/pop) so the per-build cap is the binding constraint; floor disabled.
        await runDirectedBuildProcessor(w, { tick: 0 }, {
          interval, routeCost: reachable, construction: mkConstruction(CAP, 1, 0, CONSTRUCTION.FLOOR_DEV_KNEE),
        });
        if (w.buildingUpdates.length > 0) return cycle; // the project completed and landed this cycle
        projects = w.constructionProjects;
        rows = rows.map((r) => {
          const buildings = { ...r.buildings };
          for (const u of w.buildingUpdates) if (u.systemId === r.systemId) buildings[u.buildingType] = u.count;
          return { ...r, buildings };
        });
      }
      return -1;
    };
    expect(await landingCycle(24)).toBe(2);
    expect(await landingCycle(12)).toBe(4);
  });

  it("interval scaling preserves the parallel-front count (pool and cap scale together)", async () => {
    // Pool = 400 × 0.05 = 20 = 2 × CAP at the reference interval. Three in-flight projects whose work
    // far exceeds any cycle's funding (none lands, queue order preserved) → exactly the front two absorb
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
    // …and each front's per-cycle work scales with the interval — this is what actually fails if pool
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
        systemId: "H", factionId: "f1", control: "developed", population: 400,
        buildings: { [HOUSING_TYPE]: 20 }, yields: unitResourceVector(), extractionEff: unitResourceVector(), depositCounts: emptyResourceVector(),
 peopleLand: 20, markets: [],
      },
      {
        systemId: "C", factionId: "f1", control: "developed", population: 2,
        buildings: { [HOUSING_TYPE]: 20 }, yields: unitResourceVector(), extractionEff: unitResourceVector(), depositCounts: emptyResourceVector(),
 peopleLand: 20, markets: [],
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
  it("funds a fresh player order ahead of this cycle's new autonomic proposals", async () => {
    // Stored order is [fresh player row, committed auto row] — the WRONG-for-funding order, so
    // orderOpenProjects must actually move the committed row ahead of the fresh player row for this
    // test to pass; a processor that funded raw stored order ([...existing, ...newProjects], no
    // reorder) would flip which row gets the front-of-queue cap and which gets the pool's leftover.
    // Floor disabled (floorBase 0) so the whole pool is plain front-first, no reserved slice to confound
    // the arithmetic. cap=4, pool=5000×0.001=5: the front row absorbs a full cap (4), the second row
    // gets only the pool's leftover (1), and nothing reaches this cycle's new proposals (pool exhausted).
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
    // Both pre-existing rows drained the pool before any of this cycle's new autonomic proposals: every
    // other persisted project (this cycle's new proposals for the scenario's food/housing deficit) is
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
      seedPop: 100, housingLevels: 1, workTotal: 60, workDone: 0,
      stagedManifest: [], charterPaid: false, stalledCycles: 0 };
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
    // keeps the committed row (remaining work 15) from completing in a single cycle — matching how
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
    // Reuses the build-vs-colony arbitration fixture (homeWithOreDeficit + colonyOf/COLONY_PARAMS):
    // a build deficit competes with an eligible colony candidate for the same pool. With colonisation
    // off, no colony_establish proposal is generated at all — the build proposal wins the whole pool
    // and its row persists regardless of funding (persist-if-funded only gates colonies/centres).
    const w = new MemoryDirectedBuildWorld([homeWithOreDeficit(1000)]);
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

describe("construction funding gate", () => {
  // One developed system, one standing player order with a huge remaining work total, a cap
  // larger than the pool → absorbed work per cycle equals the pool exactly, making the
  // funded-fraction scaling directly observable via workPerformedByFaction.
  const row = (): SystemBuildRow => ({
    systemId: "s1", factionId: "f1", control: "developed" as const,
    population: 100, buildings: {},
    yields: emptyResourceVector(), extractionEff: unitResourceVector(), depositCounts: emptyResourceVector(),
 peopleLand: 0, markets: [],
  });
  const order = (): WorldConstructionProject => ({
    kind: "build" as const, id: "p1", origin: "player" as const,
    factionId: "f1", systemId: "s1", buildingType: "ore", levels: 5,
    workTotal: 100_000, workDone: 0,
  });
  const params = (fundingByFaction?: ReadonlyMap<string, number>) => ({
    interval: 24,
    routeCost: () => null,
    construction: {
      cap: 1_000_000, throughputPerPop: 1, floorBase: 0, floorKnee: 0,
      pointsPerLevel: 0, paybackHorizon: 1, backlogWindow: 1,
      mintId: () => "new-id",
    },
    fundingByFaction,
  });

  it("scales the funded pool by the faction's funded.construction", async () => {
    // catchUpFactor(24) = 1 → full pool = 100 pop × 1/pop = 100 points.
    const full = new MemoryDirectedBuildWorld([row()], [order()]);
    const fullResult = await runDirectedBuildProcessor(full, { tick: 0 }, params());
    expect(fullResult.workPerformedByFaction?.get("f1")).toBeCloseTo(100, 6);

    const half = new MemoryDirectedBuildWorld([row()], [order()]);
    const halfResult = await runDirectedBuildProcessor(half, { tick: 0 }, params(new Map([["f1", 0.5]])));
    expect(halfResult.workPerformedByFaction?.get("f1")).toBeCloseTo(50, 6);

    // funded 0 → the queue waits: no work, and the standing player order persists untouched.
    const starved = new MemoryDirectedBuildWorld([row()], [order()]);
    const starvedResult = await runDirectedBuildProcessor(starved, { tick: 0 }, params(new Map([["f1", 0]])));
    expect(starvedResult.workPerformedByFaction?.get("f1")).toBeUndefined();
    expect(starved.constructionProjects).toHaveLength(1);
    expect(starved.constructionProjects[0].workDone).toBe(0);
  });
});

describe("runDirectedBuildProcessor — build-burst instrumentation (buildCommitmentsByGood)", () => {
  it("counts this cycle's new production-good proposal levels, keyed by good id", async () => {
    // A: developed food sink with a saturated proposal clock (persistence-gated structural build
    // actually emits). B: builder with habitable land AND slots → proposes both housing (not a good)
    // and a food industry bundle (a good) this cycle.
    const w = new MemoryDirectedBuildWorld(scenario(0, 0, 20, { control: "developed", foodCycles: 1 }));
    const result = await runDirectedBuildProcessor(w, { tick: DUE_TICK }, { interval: INTERVAL, routeCost: reachable, construction: mkConstruction(4) });
    const foodLevels = w.constructionProjects.reduce(
      (sum, p) => (p.kind === "build" && p.buildingType === "food" ? sum + p.levels : sum),
      0,
    );
    expect(foodLevels).toBeGreaterThan(0);
    expect(result.buildCommitmentsByGood?.get("food")).toBe(foodLevels);
  });

  it("excludes housing — proactive substrate is not a production good", async () => {
    // Default scenario: A is unclaimed (no structural deficit contributed), so only B's housing
    // headroom proposes anything this cycle.
    const w = new MemoryDirectedBuildWorld(scenario(0, 0));
    const result = await runDirectedBuildProcessor(w, { tick: DUE_TICK }, { interval: INTERVAL, routeCost: reachable, construction: mkConstruction(4) });
    expect(w.constructionProjects.some((p) => p.kind === "build" && p.buildingType === HOUSING_TYPE)).toBe(true);
    expect(result.buildCommitmentsByGood?.has(HOUSING_TYPE)).toBe(false);
    expect(result.buildCommitmentsByGood?.size ?? 0).toBe(0); // nothing else was proposed either
  });

  it("excludes construction-centre levels from the count", async () => {
    // Same starved-backlog fixture as the "commits a centre project" case above: a food backlog deep
    // enough that a centre is proposed alongside the ordinary food bundle.
    const w = new MemoryDirectedBuildWorld(scenario(0, 0, 20, { control: "developed", foodCycles: 1 }));
    const result = await runDirectedBuildProcessor(w, { tick: DUE_TICK }, {
      interval: INTERVAL, routeCost: reachable,
      construction: mkConstruction(2, 0.001),
    });
    const centres = w.constructionProjects.filter(
      (p) => p.kind === "build" && p.buildingType === CONSTRUCTION_CENTRE_TYPE,
    );
    expect(centres.length).toBe(1); // sanity: a centre really was proposed
    expect(result.buildCommitmentsByGood?.has(CONSTRUCTION_CENTRE_TYPE)).toBe(false);
    expect(result.buildCommitmentsByGood?.get("food")).toBeGreaterThan(0);
  });

  it("excludes colony-establish proposals — not a production-good build", async () => {
    const w = new MemoryDirectedBuildWorld([saturatedHome(1000)]);
    const result = await runDirectedBuildProcessor(w, { tick: DUE_TICK }, {
      interval: INTERVAL, routeCost: reachable, construction: mkConstruction(4),
      develop: { candidateProvider: (f) => (f === "f1" ? [colonyCand("c1")] : []), params: COLONY_PARAMS },
    });
    expect(w.constructionProjects.some((p) => p.kind === "colony_establish")).toBe(true); // sanity
    expect(result.buildCommitmentsByGood?.size ?? 0).toBe(0);
  });

  it("excludes already-open (old) work — a large in-flight project must not inflate the count", async () => {
    const rows = scenario(0, 0, 20, { control: "developed", foodCycles: 1 });

    const fresh = new MemoryDirectedBuildWorld(rows);
    const freshResult = await runDirectedBuildProcessor(fresh, { tick: DUE_TICK }, { interval: INTERVAL, routeCost: reachable, construction: mkConstruction(4) });
    const freshFood = freshResult.buildCommitmentsByGood?.get("food") ?? 0;
    expect(freshFood).toBeGreaterThan(0);

    // A pre-existing 1000-level food project already open at B, from a prior cycle.
    const oldWork: WorldConstructionProject = {
      id: "old-food", kind: "build", origin: "auto", factionId: "f1", systemId: "B",
      buildingType: "food", levels: 1000, workTotal: 1000 * 8, workDone: 0,
    };
    const withOld = new MemoryDirectedBuildWorld(rows, [oldWork]);
    const withOldResult = await runDirectedBuildProcessor(withOld, { tick: DUE_TICK }, { interval: INTERVAL, routeCost: reachable, construction: mkConstruction(4) });
    const oldFood = withOldResult.buildCommitmentsByGood?.get("food") ?? 0;
    // If the 1000 in-flight levels leaked into the count it would swamp this cycle's fresh proposal.
    // In-flight work can only shrink the fresh count (it nets against the gap), never inflate it.
    expect(oldFood).toBeLessThanOrEqual(freshFood);
  });

  it("counts a production-good level that completes (lands) within the same cycle", async () => {
    // Ample pool + cap: the food bundle proposed this cycle fully lands before the cycle ends.
    const w = new MemoryDirectedBuildWorld(scenario(0, 0, 20, { control: "developed", foodCycles: 1 }));
    const result = await runDirectedBuildProcessor(w, { tick: DUE_TICK }, { interval: INTERVAL, routeCost: reachable, construction: mkConstruction(1000, 1) });
    const landedFood = w.buildingUpdates.find((u) => u.systemId === "B" && u.buildingType === "food");
    expect(landedFood).toBeDefined(); // sanity: it actually landed this cycle, not just queued
    expect(result.buildCommitmentsByGood?.get("food")).toBe(landedFood?.count);
  });

  it("reports no build commitments when nothing is proposed", async () => {
    const balanced: SystemBuildRow[] = [{
      systemId: "A", factionId: "f1", control: "developed", population: 0, buildings: {},
      yields: unitResourceVector(), extractionEff: unitResourceVector(), depositCounts: builderSlots(10), peopleLand: 0,
      markets: [foodMarket("A", 1)], // population 0 → no consumption → no rate deficit; no habitable land → no housing
    }];
    const w = new MemoryDirectedBuildWorld(balanced);
    const result = await runDirectedBuildProcessor(w, { tick: DUE_TICK }, { interval: INTERVAL, routeCost: reachable, construction: mkConstruction() });
    expect(result.buildCommitmentsByGood?.size ?? 0).toBe(0);
  });

  it("reports no build commitments on an off-boundary tick (cycle start)", async () => {
    const w = new MemoryDirectedBuildWorld(scenario(0, 0, 20, { control: "developed", foodCycles: 1 }));
    const result = await runDirectedBuildProcessor(w, { tick: NOT_DUE_TICK }, { interval: INTERVAL, routeCost: reachable, construction: mkConstruction() });
    expect(result.buildCommitmentsByGood?.size ?? 0).toBe(0);
  });
});

describe("runDirectedBuildProcessor — strike-suppression instrumentation (strikeSuppressedProposals)", () => {
  // A developed self-supplier whose buildings already cover demand (no capacity gap), so the ONLY
  // thing `strikeExplains` can silence is the squeeze-feedback term — mirrors the persistence
  // suite's `rationedSelfSupplier` fixture (capacity > 0 by construction: `buildings.food`).
  const strikingProducer = (productionSuppressed: boolean): SystemBuildRow => ({
    systemId: "S", factionId: "f1", control: "developed", population: 20,
    buildings: { food: 10 }, yields: unitResourceVector(), extractionEff: unitResourceVector(), depositCounts: builderSlots(50), peopleLand: 0,
    markets: [{
      id: "S|food", goodId: "food", stock: 50, anchorMult: 1, demandRate: 10, storageCapacity: 0,
      squeezeCycles: 2, satisfaction: 0, realisedProductionRate: 0, proposalCycles: 1, productionSuppressed,
    }],
  });

  // A developed system with no BUILT capacity in the good at all (`buildings: {}`) but land to build
  // its own — the capacity-gap term is unconditional (engine `:314-318`), so this pair's deficit is
  // proposed regardless of the strike, unlike the feedback-gap term `strikingProducer` isolates.
  const strikingNoCapacity: SystemBuildRow = {
    systemId: "N", factionId: "f1", control: "developed", population: 100,
    buildings: {}, yields: unitResourceVector(), extractionEff: unitResourceVector(), depositCounts: builderSlots(50), peopleLand: 0,
    markets: [{ ...foodMarket("N", 1, 1), productionSuppressed: true }],
  };

  it("a striking system with capacity increments both counters; one with none is excluded from both", async () => {
    const w = new MemoryDirectedBuildWorld([strikingProducer(true), strikingNoCapacity]);
    const result = await runDirectedBuildProcessor(w, { tick: DUE_TICK }, { interval: INTERVAL, routeCost: reachable, construction: mkConstruction(4) });
    // Sanity: N's capacity-gap deficit still fires despite the strike — nothing was suppressed there.
    expect(w.constructionProjects.some((p) => p.kind === "build" && p.systemId === "N" && p.buildingType === "food")).toBe(true);
    expect(result.strikeSuppressedProposals).toEqual({ suppressed: 1, eligible: 1 });
  });

  it("a calm system increments eligible only, so the rate is 0 rather than undefined on a healthy galaxy", async () => {
    const w = new MemoryDirectedBuildWorld([strikingProducer(false)]);
    const result = await runDirectedBuildProcessor(w, { tick: DUE_TICK }, { interval: INTERVAL, routeCost: reachable, construction: mkConstruction(4) });
    expect(result.strikeSuppressedProposals).toEqual({ suppressed: 0, eligible: 1 });
  });

  it("reports no strikeSuppressedProposals on an off-boundary tick — the harness's denominator stays at zero rather than acquiring one to divide by", async () => {
    const w = new MemoryDirectedBuildWorld([strikingProducer(true)]);
    const result = await runDirectedBuildProcessor(w, { tick: NOT_DUE_TICK }, { interval: INTERVAL, routeCost: reachable, construction: mkConstruction(4) });
    expect(result.strikeSuppressedProposals).toBeUndefined();
  });
});

// ── founding stock endowment ─────────────────────────────────────
// A colony used to open holding nothing, so it read as starving from its first cycle before any
// logistics could reach it. It now arrives with a slice of its founder's warehouses, sized on its
// OWN basket, capped by what the founder can spare, and staged over the whole establish.

/** The seed population's own demand basis — no skilled work at a brand-new colony. */
const SEED_BASIS: CivilianDemandBasis = {
  population: EXPANSION.COLONY_SEED_POP, technicians: 0, engineers: 0,
};

/** What the colony wants of `goodId`: cycles of its own raw rate, per the founding policy. */
const foundingWant = (goodId: string) =>
  COLONISATION.FOUNDING_STOCK_COVER * consumptionRate(goodId, SEED_BASIS);

function stockedMarket(systemId: string, goodId: string, stock: number): MarketRowForLogistics {
  return { id: `${systemId}|${goodId}`, goodId, stock, anchorMult: 1, demandRate: 1, storageCapacity: 0 };
}

/** The founding source's own population — what its export gate compares its output against. */
const HOME_POP = 1000;

/**
 * A saturated home that also holds tradeable stock, so a founding manifest can actually be drawn.
 * `exportRates` gives a good a realised output; above the home's own demand it becomes a structural
 * exporter, drawable down to its strategic reserve rather than gated on the surplus margin.
 */
function stockedHome(
  goodStocks: Record<string, number>,
  exportRates: Record<string, number> = {},
): SystemBuildRow {
  return {
    ...saturatedHome(HOME_POP),
    markets: Object.entries(goodStocks).map(([goodId, stock]) => ({
      ...stockedMarket("home", goodId, stock),
      realisedProductionRate: exportRates[goodId],
    })),
  };
}

// ── per-cycle materials staging ──────────────────────────────────
// The manifest is drawn in slices as the establish is built, paid for as it is drawn, and the work a
// colony may absorb in a cycle is capped by the share of that slice it can actually stage.

describe("runDirectedBuildProcessor: staged founding materials", () => {
  const FEE = 100;
  // charterMult 0 + charterMin 100 ⇒ every charter is exactly 100, so the money figures below are
  // stated rather than recomputed through the pricing functions under test.
  const STAGING_PARAMS: ColonyEstablishParams = { ...COLONY_PARAMS, charterMult: 0, charterMin: FEE };
  const STAGE_CAP = 4;
  const STAGE_WORK = 20;                          // 5 cycles at the cap — a whole establish in a short loop
  const STAGE_CYCLES = STAGE_WORK / STAGE_CAP;

  /** One committed, unpaid establish — seeded directly so the planner's own gate is out of the way. */
  function stagingProject(): WorldConstructionProject {
    return {
      kind: "colony_establish", id: "col", origin: "auto", factionId: "f1",
      systemId: "c1", sourceSystemId: "home", seedPop: EXPANSION.COLONY_SEED_POP,
      housingLevels: 1, workTotal: STAGE_WORK, workDone: 0,
      stagedManifest: [], charterPaid: false, stalledCycles: 0,
    };
  }

  /**
   * Run that establish cycle by cycle until its colony develops (or `maxCycles` is spent), carrying
   * the open queue, the founding money committed so far and every staging draw forward. Nothing ever
   * settles during the run, so what has been committed stays pending against the same balance.
   * `throughputPerPop` sets the faction's construction pool — 0 starves the queue outright.
   */
  async function runEstablish(
    home: SystemBuildRow,
    balance: number,
    maxCycles = 40,
    throughputPerPop = 0.05,
  ) {
    let projects: WorldConstructionProject[] = [stagingProject()];
    let committed = 0;
    let developed = false;
    const draws: FoundingStagingDraw[] = [];
    const workDoneByCycle: number[] = [];
    const ledgerByCycle: number[] = [];
    const stalledByCycle: number[] = [];
    let delivered: FoundingStockLine[] = [];
    const manifestEvents: NonNullable<TickProcessorResult["foundingManifests"]> = [];
    const stallsByCycle: NonNullable<TickProcessorResult["foundingStalls"]>[] = [];
    let cycles = 0;
    for (; cycles < maxCycles && !developed; cycles++) {
      const w = new MemoryDirectedBuildWorld([home], projects);
      const r = await runDirectedBuildProcessor(w, { tick: DUE_TICK }, {
        interval: INTERVAL, routeCost: reachable,
        construction: mkConstruction(STAGE_CAP, throughputPerPop),
        develop: { candidateProvider: () => [], params: STAGING_PARAMS },
        treasuryByFaction: new Map([["f1", { balance, pendingFounding: committed, maintenanceBill: 0 }]]),
      });
      committed += r.foundingDebitsByFaction?.get("f1") ?? 0;
      draws.push(...w.foundingStagingDraws);
      projects = w.constructionProjects;
      const colony = projects.filter(
        (p): p is WorldColonyEstablishProject => p.kind === "colony_establish",
      )[0];
      workDoneByCycle.push(colony?.workDone ?? STAGE_WORK); // gone from the queue ⇒ it completed
      ledgerByCycle.push(colony?.stagedManifest.length ?? 0);
      stalledByCycle.push(colony?.stalledCycles ?? 0);
      const development = w.developments.find((d) => d.systemId === "c1");
      developed = development !== undefined;
      delivered = development?.stockManifest ?? [];
      manifestEvents.push(...(r.foundingManifests ?? []));
      stallsByCycle.push(r.foundingStalls ?? []);
    }
    return {
      developed, cycles, committed, draws, workDoneByCycle, ledgerByCycle, stalledByCycle,
      delivered, manifestEvents, stallsByCycle,
    };
  }

  it("completes a founding whose source can spare nothing, and opens with an empty ledger", async () => {
    // A source holding nothing can never supply the manifest, at any point of the establish. What it
    // cannot spare counts as satisfied, so the project runs at full cap on work alone; without that
    // rule the materials ceiling would sit at 0 for ever and this colony would never open.
    const run = await runEstablish(stockedHome({ food: 0, water: 0 }), 100_000);

    expect(run.developed).toBe(true);
    expect(run.cycles).toBe(STAGE_CYCLES);                    // full cap every cycle — nothing held it back
    expect(run.draws).toEqual([]);                            // nothing drawn…
    expect(run.ledgerByCycle.every((n) => n === 0)).toBe(true); // …and nothing conjured into the ledger
    expect(run.committed).toBe(FEE);                          // the charter is all it ever cost
    // An unprovisioned founding cost its founder nothing — it must not appear in the founding-cost
    // readout at all, or the harness reads it as a founder drained flat.
    expect(run.manifestEvents).toEqual([]);
  });

  it("stages over the whole establish, past what a single completion draw could take", async () => {
    // A food exporter parked so its spare is exactly half the colony's want: one raid at completion
    // could only ever take that half, while a per-cycle slice of the want fits inside it every cycle.
    const homeDemand = consumptionRate("food", { population: HOME_POP, technicians: 0, engineers: 0 });
    const exportRate = homeDemand * 2;
    const stock = DIRECTED_LOGISTICS.EXPORT_RESERVE_COVER * homeDemand + foundingWant("food") / 2;
    const singleDraw = surplusDrawable(
      stock, DIRECTED_LOGISTICS.DONOR_RESERVE_COVER * homeDemand, homeDemand, exportRate, false,
    );
    expect(singleDraw).toBeCloseTo(foundingWant("food") / 2, 6); // the setup really is half a want

    const run = await runEstablish(stockedHome({ food: stock }, { food: exportRate }), 1_000_000);

    expect(run.developed).toBe(true);
    expect(run.draws).toHaveLength(STAGE_CYCLES);              // one draw per funded cycle, landing cycle included
    const staged = run.draws.reduce((sum, d) => sum + d.quantity, 0);
    expect(staged).toBeGreaterThan(singleDraw);                // the spread total beats the single raid…
    expect(staged).toBeCloseTo(foundingWant("food"), 6);       // …reaching the whole want
    expect(run.committed).toBeCloseTo(FEE + foundingGoodsValue([{ goodId: "food", quantity: staged }], 1), 6);
  });

  it("does not count a pool-starved cycle as a materials stall", async () => {
    // Everything the colony needs is affordable and on the founder's shelves — the materials ceiling
    // never binds. What it does not get is construction points: colonies reserve no pool floor, so a
    // faction whose pool goes elsewhere can leave one waiting indefinitely. That is not a reason to
    // write off a manifest it could have bought, so the stall counter must not move at all.
    const cycles = COLONISATION.FOUNDING_STALL_COMPLETE_CYCLES + 3;
    const run = await runEstablish(stockedHome({ food: 5_000, water: 5_000 }), 100_000, cycles, 0);

    expect(run.cycles).toBe(cycles);                             // no pool ⇒ it never lands
    expect(run.workDoneByCycle.every((w) => w === 0)).toBe(true); // …and never absorbs anything
    expect(run.stalledByCycle.every((s) => s === 0)).toBe(true);  // the counter never moved
    expect(run.draws).toEqual([]);                                // nothing staged for unfunded work
    expect(run.committed).toBe(FEE);                              // only the charter was ever paid
  });

  it("completes on work alone after FOUNDING_STALL_COMPLETE_CYCLES cycles staging nothing", async () => {
    // One charter's worth of money and a source with plenty to sell: the charter empties the purse, so
    // every staging draw is unaffordable and the ceiling holds the project at zero work — until the
    // write-off drops the remaining want and it finishes on construction alone.
    // maxCycles must clear FOUNDING_STALL_COMPLETE_CYCLES + STAGE_CYCLES, not the default 40 — the
    // default was sized for the old ~8-cycle stall window and the run would truncate mid-stall now.
    const run = await runEstablish(
      stockedHome({ food: 5_000, water: 5_000 }),
      FEE,
      COLONISATION.FOUNDING_STALL_COMPLETE_CYCLES + STAGE_CYCLES + 5,
    );

    expect(run.committed).toBe(FEE);                          // only the charter was ever paid…
    expect(run.draws).toEqual([]);                            // …so no materials moved
    const stalled = run.workDoneByCycle.slice(0, COLONISATION.FOUNDING_STALL_COMPLETE_CYCLES);
    expect(stalled.every((w) => w === 0)).toBe(true);          // it really stalled, rather than merely crawling
    // The cycle after the write-off, work resumes at the ordinary cap.
    expect(run.workDoneByCycle[COLONISATION.FOUNDING_STALL_COMPLETE_CYCLES]).toBe(STAGE_CAP);
    expect(run.developed).toBe(true);
    expect(run.cycles).toBe(COLONISATION.FOUNDING_STALL_COMPLETE_CYCLES + STAGE_CYCLES);
    // Past the write-off the project is given no plan at all, so the gate has to fall back to the
    // project's own remaining work: it absorbs the whole of that allowance every cycle, and nothing
    // — not the money it gave up on, not the queue — is holding it back any more.
    const afterWriteOff = run.stallsByCycle
      .slice(COLONISATION.FOUNDING_STALL_COMPLETE_CYCLES)
      .flat();
    expect(afterWriteOff).not.toHaveLength(0);
    expect(afterWriteOff.every((s) => s.gate === null)).toBe(true);
    // Its counter stays latched above the threshold by construction — it stages nothing ever again —
    // which is exactly why the readout must not read that counter as a live stall.
    expect(afterWriteOff.every((s) => s.stalled)).toBe(true);
  });

  it("opens the colony with exactly the ledger it staged, weighted like the seed's own basket", async () => {
    // Ample stock and money, so the COLONY's want is what binds rather than the founder's spare.
    const run = await runEstablish(stockedHome({ food: 5_000, water: 5_000, luxuries: 5_000 }), 1_000_000);
    expect(run.developed).toBe(true);

    // The delivery carries the staged ledger and nothing else — no fresh draw at completion. Restore
    // a completion-time manifest and this diverges, because the landing draw is not in `draws`.
    const drawn = new Map<string, number>();
    for (const d of run.draws) drawn.set(d.goodId, (drawn.get(d.goodId) ?? 0) + d.quantity);
    const manifest = new Map(run.delivered.map((l) => [l.goodId, l.quantity]));
    expect([...manifest.keys()].sort()).toEqual([...drawn.keys()].sort());
    for (const [goodId, quantity] of drawn) expect(manifest.get(goodId)).toBeCloseTo(quantity, 9);

    // Staged in slices, the total still reaches the same want a single completion draw aimed at…
    for (const goodId of ["food", "water", "luxuries"]) {
      expect(manifest.get(goodId)).toBeCloseTo(foundingWant(goodId), 6);
    }
    // …and keeps the shape that matters: a 2-pop seed is sent staples, and only a trace of what
    // nobody there yet consumes much of. Water and food are the biggest needs; luxuries the smallest.
    expect(manifest.get("water")!).toBeGreaterThan(manifest.get("luxuries")! * 5);
    expect(manifest.get("food")!).toBeGreaterThan(manifest.get("luxuries")! * 5);

    // The founding-cost readout the harness samples: one event per DRAW, not one per colony, or
    // every slice but the last is lost. Together they add up to the ledger the colony opened with,
    // priced at what the faction paid for it beyond the charter.
    expect(run.manifestEvents).toHaveLength(STAGE_CYCLES);
    for (const event of run.manifestEvents) {
      expect(event.systemId).toBe("c1");
      expect(event.sourceSystemId).toBe("home");
      expect([...event.goodIds].sort()).toEqual(run.delivered.map((l) => l.goodId).sort());
      expect(event.founderCover).toBeGreaterThan(0); // a measurable reading, taken as it staged
    }
    const tonnage = run.manifestEvents.reduce((sum, e) => sum + e.tonnage, 0);
    expect(tonnage).toBeCloseTo(run.delivered.reduce((sum, l) => sum + l.quantity, 0), 9);
    const money = run.manifestEvents.reduce((sum, e) => sum + e.moneyCost, 0);
    expect(money).toBeCloseTo(run.committed - FEE, 9);
  });

  it("stages the whole share a part-funded cycle bought, in step with the work it bought", async () => {
    // A purse holding exactly half this cycle's manifest share, against a founder with plenty on the
    // shelves: money — not materials — is what lowers the ceiling, so the colony absorbs half a cap
    // and must stage the half-share it actually paid for. The plan's lines are ALREADY the money's
    // half; prorating them a second time by the same fraction would stage a quarter, charge a
    // quarter, and leave the faction's own purse untouched with nothing reporting it.
    const cycleShare = foundingWant("food") * (STAGE_CAP / STAGE_WORK);
    const halfValue = foundingGoodsValue([{ goodId: "food", quantity: cycleShare }], 1) / 2;

    const paid: WorldColonyEstablishProject = {
      ...stagingProject(), kind: "colony_establish", id: "col", systemId: "c1",
      sourceSystemId: "home", seedPop: EXPANSION.COLONY_SEED_POP, housingLevels: 1,
      stagedManifest: [], charterPaid: true, stalledCycles: 0,
    };
    const w = new MemoryDirectedBuildWorld([stockedHome({ food: 5_000 })], [paid]);
    const result = await runDirectedBuildProcessor(w, { tick: DUE_TICK }, {
      interval: INTERVAL, routeCost: reachable,
      construction: mkConstruction(STAGE_CAP, 0.05),
      develop: { candidateProvider: () => [], params: STAGING_PARAMS },
      treasuryByFaction: new Map([["f1", { balance: halfValue, pendingFounding: 0, maintenanceBill: 0 }]]),
    });

    // Half the share is affordable ⇒ the ceiling holds the work at half a cap.
    const colony = w.constructionProjects.find((p) => p.id === "col");
    expect(colony?.workDone).toBeCloseTo(STAGE_CAP / 2, 6);
    // …and that half-cap of work carries the whole half-share the money bought — the ledger, the
    // founder's debit and the faction's bill all agree on one figure.
    const drawn = w.foundingStagingDraws.reduce((sum, d) => sum + d.quantity, 0);
    expect(drawn).toBeCloseTo(cycleShare / 2, 6);
    expect(result.foundingDebitsByFaction?.get("f1")).toBeCloseTo(halfValue, 6);
    expect((result.foundingManifests ?? []).reduce((sum, e) => sum + e.moneyCost, 0)).toBeCloseTo(halfValue, 6);
    // It filled the whole ceiling its money bought, so the queue is not what held it back — the
    // partial purse is, and the record has to say so rather than reading the cycle as ungated.
    expect((result.foundingStalls ?? []).map((s) => s.gate)).toEqual(["funds"]);
  });

  it("absorbs no work at all while the charter is unpaid, however much pool there is", async () => {
    // Committing to a colony and paying for it are ONE step: until the fee is paid the establish is
    // not the faction's, and a queue that built it anyway would hand over a colony for free — the
    // charter would then arrive on a project already half-finished, or never.
    const unpaid: WorldConstructionProject = { ...stagingProject(), origin: "player" };
    const w = new MemoryDirectedBuildWorld([stockedHome({ food: 5_000, water: 5_000 })], [unpaid]);
    const result = await runDirectedBuildProcessor(w, { tick: DUE_TICK }, {
      interval: INTERVAL, routeCost: reachable,
      construction: mkConstruction(STAGE_CAP, 0.05), // ample pool — the charter is the only thing refusing
      develop: { candidateProvider: () => [], params: STAGING_PARAMS },
      treasuryByFaction: new Map([["f1", { balance: 0, pendingFounding: 0, maintenanceBill: 0 }]]),
    });

    expect(w.constructionProjects.find((p) => p.id === "col")?.workDone).toBe(0);
    expect(result.workPerformedByFaction?.get("f1") ?? 0).toBe(0);
    expect(w.foundingStagingDraws).toEqual([]);
    expect((result.foundingStalls ?? []).map((s) => s.gate)).toEqual(["charter"]);
  });

  it("asks for nothing more of a good the ledger already carries in full", async () => {
    // The share is taken against what is still OUTSTANDING, so a good already carried whole drops
    // off this cycle's list — and dropping off must take neither the goods still wanted with it nor
    // the priced share the work ceiling is measured against.
    const carried: WorldColonyEstablishProject = {
      ...stagingProject(), kind: "colony_establish", id: "col", systemId: "c1",
      sourceSystemId: "home", seedPop: EXPANSION.COLONY_SEED_POP, housingLevels: 1,
      stagedManifest: [{ goodId: "food", quantity: foundingWant("food") }],
      charterPaid: true, stalledCycles: 0,
    };
    const w = new MemoryDirectedBuildWorld([stockedHome({ food: 5_000, water: 5_000 })], [carried]);
    await runDirectedBuildProcessor(w, { tick: DUE_TICK }, {
      interval: INTERVAL, routeCost: reachable,
      construction: mkConstruction(STAGE_CAP, 0.05),
      develop: { candidateProvider: () => [], params: STAGING_PARAMS },
      treasuryByFaction: new Map([["f1", { balance: 1_000_000, pendingFounding: 0, maintenanceBill: 0 }]]),
    });

    const drawn = new Map<string, number>();
    for (const d of w.foundingStagingDraws) drawn.set(d.goodId, (drawn.get(d.goodId) ?? 0) + d.quantity);
    expect(drawn.has("food")).toBe(false); // it already has all the food it ever wanted
    expect(drawn.get("water")).toBeCloseTo(foundingWant("water") * (STAGE_CAP / STAGE_WORK), 6);
    // …and the ceiling was never dragged down by the good that left the list.
    expect(w.constructionProjects.find((p) => p.id === "col")?.workDone).toBe(STAGE_CAP);
  });

  it("sizes the last cycle's share on the work that is actually left", async () => {
    // The slice is `work left ÷ the whole establish`, so a final cycle with less than a cap to build
    // asks for less than a full slice — and having filled that smaller allowance, it is not a colony
    // the construction pool held up.
    const nearlyDone: WorldColonyEstablishProject = {
      ...stagingProject(), kind: "colony_establish", id: "col", systemId: "c1",
      sourceSystemId: "home", seedPop: EXPANSION.COLONY_SEED_POP, housingLevels: 1,
      workTotal: STAGE_WORK, workDone: STAGE_WORK - 2, // two points left, against a cap of four
      stagedManifest: [], charterPaid: true, stalledCycles: 0,
    };
    const w = new MemoryDirectedBuildWorld([stockedHome({ food: 5_000 })], [nearlyDone]);
    const result = await runDirectedBuildProcessor(w, { tick: DUE_TICK }, {
      interval: INTERVAL, routeCost: reachable,
      construction: mkConstruction(STAGE_CAP, 0.05),
      develop: { candidateProvider: () => [], params: STAGING_PARAMS },
      treasuryByFaction: new Map([["f1", { balance: 1_000_000, pendingFounding: 0, maintenanceBill: 0 }]]),
    });

    const drawn = w.foundingStagingDraws.reduce((sum, d) => sum + d.quantity, 0);
    expect(drawn).toBeCloseTo(foundingWant("food") * (2 / STAGE_WORK), 6);
    expect(w.developments.map((d) => d.systemId)).toEqual(["c1"]); // and it landed on that last slice
    expect((result.foundingStalls ?? []).map((s) => s.gate)).toEqual([null]);
  });

  it("keeps each founder's remaining pile to itself", async () => {
    // The running per-(source, good) balance is what stops two colonies drawing the same tonne. Kept
    // per GOOD alone it would also stop a second colony drawing from an entirely different founder,
    // and every founding after the first in a cycle would silently starve.
    const homeDemand = consumptionRate("food", { population: HOME_POP, technicians: 0, engineers: 0 });
    const exportRate = homeDemand * 2;
    const cycleShare = foundingWant("food") * (STAGE_CAP / STAGE_WORK);
    const stock = DIRECTED_LOGISTICS.EXPORT_RESERVE_COVER * homeDemand + cycleShare;
    const drawable = surplusDrawable(
      stock, DIRECTED_LOGISTICS.DONOR_RESERVE_COVER * homeDemand, homeDemand, exportRate, false,
    );
    expect(drawable).toBeCloseTo(cycleShare, 6); // each founder holds exactly one colony's slice

    const founder = (systemId: string): SystemBuildRow => ({
      ...saturatedHome(HOME_POP),
      systemId,
      markets: [{ ...stockedMarket(systemId, "food", stock), realisedProductionRate: exportRate }],
    });
    const from = (id: string, systemId: string, sourceSystemId: string): WorldColonyEstablishProject => ({
      ...stagingProject(), kind: "colony_establish", id, systemId, sourceSystemId,
      seedPop: EXPANSION.COLONY_SEED_POP, housingLevels: 1,
      stagedManifest: [], charterPaid: true, stalledCycles: 0,
    });
    const w = new MemoryDirectedBuildWorld(
      [founder("home"), founder("home2")],
      [from("colA", "c1", "home"), from("colB", "c2", "home2")],
    );
    await runDirectedBuildProcessor(w, { tick: DUE_TICK }, {
      interval: INTERVAL, routeCost: reachable,
      construction: mkConstruction(STAGE_CAP, 0.05),
      develop: { candidateProvider: () => [], params: STAGING_PARAMS },
      treasuryByFaction: new Map([["f1", { balance: 1_000_000, pendingFounding: 0, maintenanceBill: 0 }]]),
    });

    const drawnFrom = (systemId: string) =>
      w.foundingStagingDraws
        .filter((d) => d.sourceSystemId === systemId)
        .reduce((sum, d) => sum + d.quantity, 0);
    expect(drawnFrom("home")).toBeCloseTo(cycleShare, 6);
    expect(drawnFrom("home2")).toBeCloseTo(cycleShare, 6);
  });

  it("blames the queue, not the founding path, for a colony whose source has vanished", async () => {
    // A source that is gone can never supply the remainder, so the colony is given no plan at all
    // and runs on work alone. `colonyWorkGate` then has to size the cycle's allowance from the
    // project itself: with no pool it is the QUEUE holding it up, and an allowance that fell back to
    // zero would file the cycle as ungated and hide the starvation.
    const paid: WorldColonyEstablishProject = {
      ...stagingProject(), kind: "colony_establish", id: "col", systemId: "c1",
      sourceSystemId: "vanished", seedPop: EXPANSION.COLONY_SEED_POP, housingLevels: 1,
      stagedManifest: [], charterPaid: true, stalledCycles: 0,
    };
    const purse = new Map([["f1", { balance: 1_000_000, pendingFounding: 0, maintenanceBill: 0 }]]);
    const run = async (throughputPerPop: number, cap = STAGE_CAP) => {
      const w = new MemoryDirectedBuildWorld([stockedHome({ food: 5_000 })], [paid]);
      return runDirectedBuildProcessor(w, { tick: DUE_TICK }, {
        interval: INTERVAL, routeCost: reachable,
        construction: mkConstruction(cap, throughputPerPop),
        develop: { candidateProvider: () => [], params: STAGING_PARAMS },
        treasuryByFaction: purse,
      });
    };

    // No pool at all: the allowance is a whole cap of work the queue never funded.
    expect((await run(0)).foundingStalls?.map((s) => s.gate)).toEqual(["pool"]);
    // Ample pool: it absorbs its whole sourceless allowance, and nothing is gating it.
    expect((await run(0.05)).foundingStalls?.map((s) => s.gate)).toEqual([null]);
    // A cap of zero is a cycle with nothing to allow — not a founding refused by anything.
    expect((await run(0.05, 0)).foundingStalls?.map((s) => s.gate)).toEqual([null]);
  });

  it("never commits one faction's money twice when two colonies stage in the same cycle", async () => {
    // Two paid colonies drawing on one founder with ample stock, against a purse that covers exactly
    // ONE cycle's share. The staging plans are drawn in queue order against a running balance, so the
    // first spends it and the second finds nothing left — its ceiling is 0 and it stages nothing. The
    // charter phase has the same contention case; without the running balance here a faction would
    // over-commit `pendingFounding` and the treasury would settle a bill it never approved.
    const cycleShare = foundingWant("food") * (STAGE_CAP / STAGE_WORK);
    const shareValue = foundingGoodsValue([{ goodId: "food", quantity: cycleShare }], 1);

    const paid = (id: string, systemId: string): WorldColonyEstablishProject => ({
      ...stagingProject(), kind: "colony_establish", id, systemId,
      sourceSystemId: "home", seedPop: EXPANSION.COLONY_SEED_POP, housingLevels: 1,
      stagedManifest: [], charterPaid: true, stalledCycles: 0,
    });
    const w = new MemoryDirectedBuildWorld(
      [stockedHome({ food: 5_000 })],
      [paid("colA", "c1"), paid("colB", "c2")],
    );
    const result = await runDirectedBuildProcessor(w, { tick: DUE_TICK }, {
      interval: INTERVAL, routeCost: reachable,
      construction: mkConstruction(STAGE_CAP, 0.05),
      develop: { candidateProvider: () => [], params: STAGING_PARAMS },
      treasuryByFaction: new Map([["f1", { balance: shareValue, pendingFounding: 0, maintenanceBill: 0 }]]),
    });

    // The purse is spent exactly once — not once per colony.
    expect(result.foundingDebitsByFaction?.get("f1")).toBeCloseTo(shareValue, 6);
    expect(w.foundingStagingDraws.reduce((sum, d) => sum + d.quantity, 0)).toBeCloseTo(cycleShare, 6);
    // Which of the two the queue reaches first is not the property under test — the purse is.
    const stagedFood = (id: string) =>
      w.constructionProjects
        .filter((p): p is WorldColonyEstablishProject => p.kind === "colony_establish" && p.id === id)
        .flatMap((p) => p.stagedManifest)
        .reduce((sum, l) => sum + l.quantity, 0);
    const [served, starved] = [stagedFood("colA"), stagedFood("colB")].sort((a, b) => b - a);
    expect(served).toBeCloseTo(cycleShare, 6);
    expect(starved).toBe(0);
    // The starved one is refused by the money, and says so.
    expect((result.foundingStalls ?? []).filter((s) => s.gate === "funds")).toHaveLength(1);
  });

  it("stages two colonies from one founder against a single shrinking pile", async () => {
    // A food exporter, so the drawable surplus slides continuously above the strategic reserve and can
    // be parked at one-and-a-half of a single cycle's share — enough to serve one colony's slice and
    // leave only a remainder for the other. Without a shared balance both would read the same opening
    // figure, both would be granted a full slice, and the ledgers would record stock that never left.
    const homeDemand = consumptionRate("food", { population: HOME_POP, technicians: 0, engineers: 0 });
    const exportRate = homeDemand * 2;
    const cycleShare = foundingWant("food") * (STAGE_CAP / STAGE_WORK);
    const stock = DIRECTED_LOGISTICS.EXPORT_RESERVE_COVER * homeDemand + cycleShare * 1.5;
    const drawable = surplusDrawable(
      stock, DIRECTED_LOGISTICS.DONOR_RESERVE_COVER * homeDemand, homeDemand, exportRate, false,
    );
    expect(drawable).toBeCloseTo(cycleShare * 1.5, 6); // the setup really is one and a half slices

    const paid = (id: string, systemId: string): WorldColonyEstablishProject => ({
      ...stagingProject(), kind: "colony_establish", id, systemId,
      sourceSystemId: "home", seedPop: EXPANSION.COLONY_SEED_POP, housingLevels: 1,
      stagedManifest: [], charterPaid: true, stalledCycles: 0,
    });
    const w = new MemoryDirectedBuildWorld(
      [stockedHome({ food: stock }, { food: exportRate })],
      [paid("colA", "c1"), paid("colB", "c2")],
    );
    const result = await runDirectedBuildProcessor(w, { tick: DUE_TICK }, {
      interval: INTERVAL, routeCost: reachable,
      construction: mkConstruction(STAGE_CAP, 0.05),
      develop: { candidateProvider: () => [], params: STAGING_PARAMS },
      treasuryByFaction: new Map([["f1", { balance: 1_000_000, pendingFounding: 0, maintenanceBill: 0 }]]),
    });

    const stagedFood = (id: string) =>
      w.constructionProjects
        .filter((p): p is WorldColonyEstablishProject => p.kind === "colony_establish" && p.id === id)
        .flatMap((p) => p.stagedManifest)
        .filter((l) => l.goodId === "food")
        .reduce((sum, l) => sum + l.quantity, 0);
    // Which of the two the queue reaches first is not the property under test — the pile is.
    const [served, leftovers] = [stagedFood("colA"), stagedFood("colB")].sort((a, b) => b - a);
    expect(served).toBeCloseTo(cycleShare, 6);           // one colony's slice fits whole…
    expect(leftovers).toBeGreaterThan(0);
    expect(leftovers).toBeLessThan(served);              // …the other gets only what is left…
    expect(served + leftovers).toBeCloseTo(drawable, 6); // …and the pile is spent exactly once
    // The ledgers are the debits: nothing was recorded that did not leave the founder.
    expect(w.foundingStagingDraws.reduce((sum, d) => sum + d.quantity, 0)).toBeCloseTo(drawable, 6);

    // Each draw reports the founder as IT left him — the second colony draws from what the first
    // left behind, so the two readings are different depths of the same pile. Reconstructed after
    // the tick, both would read the one post-cycle stock and the attribution would be gone.
    const events = result.foundingManifests ?? [];
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.systemId).sort()).toEqual(["c1", "c2"]);
    const [coverServed, coverLeftovers] = events
      .sort((a, b) => b.tonnage - a.tonnage)
      .map((e) => e.founderCover ?? Number.NaN);
    expect(coverServed).toBeGreaterThan(coverLeftovers);
    // Stated as a ratio, the donor floor cancels: the two covers are the same founder at
    // (stock − served) and at (stock − the whole pile).
    expect(coverServed / coverLeftovers).toBeCloseTo((stock - served) / (stock - drawable), 6);
  });

  it("attributes an unpaid charter, an unaffordable share and a starved pool to three causes", async () => {
    // The three ways a founding fails to move, run as three arms of one case, because the whole
    // value of the record is that they are DIFFERENT: a report that collapses them cannot say
    // whether the money gate refused a colony or the construction queue simply never reached it.
    const stocked = () => stockedHome({ food: 5_000, water: 5_000 });

    // (a) No money at all: the charter goes unpaid, so the project absorbs nothing whatever else
    // is true. One cycle only — an unpaid autonomic colony is dropped from the queue after it.
    const noMoney = await runEstablish(stocked(), 0, 1);
    expect(noMoney.stallsByCycle[0].map((s) => s.gate)).toEqual(["charter"]);

    // (b) Exactly one charter's worth: the fee is paid, and the empty purse then buys none of the
    // materials share, which is what holds the work ceiling at zero.
    const charterOnly = await runEstablish(stocked(), FEE);
    const funds = charterOnly.stallsByCycle
      .slice(0, COLONISATION.FOUNDING_STALL_COMPLETE_CYCLES)
      .flat();
    expect(funds).not.toHaveLength(0);
    expect(funds.every((s) => s.gate === "funds")).toBe(true);
    expect(funds.every((s) => s.stalled)).toBe(true);        // …and the write-off clock is running
    expect(funds.every((s) => !s.materialsShort)).toBe(true); // the founder's shelves were full

    // (c) Money and materials both ample, no construction pool: nothing about founding is refusing.
    const starved = await runEstablish(stocked(), 100_000, 3, 0);
    const pool = starved.stallsByCycle.flat();
    expect(pool).not.toHaveLength(0);
    expect(pool.every((s) => s.gate === "pool")).toBe(true);
    // The world's own semantics: a pool-starved cycle is not a materials/money stall and must not
    // advance the write-off clock.
    expect(pool.every((s) => !s.stalled)).toBe(true);
  });

  it("attributes a PARTLY funded cycle to the pool, not to nothing at all", async () => {
    // Front-first funding runs out mid-project, so the marginal colony absorbs some of its cap and
    // not the rest. That colony is exactly the "the construction pool got smaller" case the record
    // exists to isolate; a test against zero absorption would file it as ungated and the report
    // would show the pool costing nothing while it throttled every founding in the galaxy.
    // A pool that funds part of one cap per cycle: enough to move, not enough to fill the ceiling.
    const cycles = 6;
    const run = await runEstablish(
      stockedHome({ food: 5_000, water: 5_000 }), 100_000, cycles, 0.0025,
    );

    const absorbedPerCycle = run.workDoneByCycle.map(
      (done, i) => done - (i === 0 ? 0 : run.workDoneByCycle[i - 1]),
    );
    const partial = absorbedPerCycle
      .map((absorbed, i) => ({ absorbed, gate: run.stallsByCycle[i][0]?.gate }))
      .filter((c) => c.absorbed > 0 && c.absorbed < STAGE_CAP - 1e-9);

    expect(partial).not.toHaveLength(0);            // the arm really is partly funded
    expect(partial.every((c) => c.gate === "pool")).toBe(true);
  });

  it("reports a founder that cannot spare the want as materials-short, not as a work gate", async () => {
    // The achievable-want rule: a source with nothing to give does not hold the project up — the
    // colony builds at its full cap and opens thinner. Counting that as a gate would read a thin
    // endowment as a refused founding, which is the opposite of what happened.
    const run = await runEstablish(stockedHome({ food: 0, water: 0 }), 100_000);

    expect(run.developed).toBe(true);
    const records = run.stallsByCycle.flat();
    expect(records).toHaveLength(run.cycles);
    expect(records.every((s) => s.gate === null)).toBe(true);
    expect(records.every((s) => s.materialsShort)).toBe(true);
    expect(records.every((s) => s.systemId === "c1" && s.sourceSystemId === "home")).toBe(true);
    // A cycle that staged nothing IS a stalled cycle here — that counter is what eventually writes
    // the unreachable remainder off. It reads as a stall precisely because work was funded and
    // still nothing arrived; a pool-starved cycle, where nothing was funded, does not.
    expect(records.every((s) => s.stalled)).toBe(true);
  });

  it("emits one record per priced colony per cycle, and none for an unpriced founding", async () => {
    // The denominator every share in the report is taken over: a colony that moved and a colony
    // that did not each contribute exactly one colony-cycle.
    const paid = (id: string, systemId: string): WorldColonyEstablishProject => ({
      ...stagingProject(), kind: "colony_establish", id, systemId,
      sourceSystemId: "home", seedPop: EXPANSION.COLONY_SEED_POP, housingLevels: 1,
      stagedManifest: [], charterPaid: true, stalledCycles: 0,
    });
    // An ordinary build shares the queue: it is not a founding and contributes no colony-cycle, so
    // counting it would put a denominator under every share in the report that nothing founded.
    const alsoBuilding: WorldConstructionProject = {
      kind: "build", id: "b1", origin: "auto", factionId: "f1", systemId: "home",
      buildingType: HOUSING_TYPE, levels: 1, workTotal: 1000, workDone: 0,
    };
    const w = new MemoryDirectedBuildWorld(
      [stockedHome({ food: 5_000, water: 5_000 })],
      [paid("colA", "c1"), paid("colB", "c2"), alsoBuilding],
    );
    const result = await runDirectedBuildProcessor(w, { tick: DUE_TICK }, {
      interval: INTERVAL, routeCost: reachable,
      construction: mkConstruction(STAGE_CAP, 0.05),
      develop: { candidateProvider: () => [], params: STAGING_PARAMS },
      treasuryByFaction: new Map([["f1", { balance: 1_000_000, pendingFounding: 0, maintenanceBill: 0 }]]),
    });
    expect((result.foundingStalls ?? []).map((s) => s.systemId).sort()).toEqual(["c1", "c2"]);

    const unpriced = new MemoryDirectedBuildWorld(
      [stockedHome({ food: 5_000, water: 5_000 })],
      [paid("colA", "c1")],
    );
    const unpricedResult = await runDirectedBuildProcessor(unpriced, { tick: DUE_TICK }, {
      interval: INTERVAL, routeCost: reachable,
      construction: mkConstruction(STAGE_CAP, 0.05),
      develop: { candidateProvider: () => [], params: STAGING_PARAMS },
      // no treasuryByFaction — an unpriced founding charges nothing and so reports nothing
    });
    expect(unpricedResult.foundingStalls).toEqual([]);
  });

  it("lands an unpriced founding with an empty ledger — no charter, no materials", async () => {
    // A faction with no treasury entry founds UNPRICED (the build-only engine path): no charter is
    // charged, so nothing is ever staged, so the colony opens holding nothing however full its
    // founder's warehouses are. A distinct branch from the empty-source case above, which has money
    // and a founder with nothing to give.
    const w = new MemoryDirectedBuildWorld([stockedHome({ food: 5_000, water: 5_000 })]);
    const result = await runDirectedBuildProcessor(w, { tick: DUE_TICK }, {
      interval: INTERVAL, routeCost: reachable, construction: mkConstruction(1000, 1),
      develop: {
        candidateProvider: (f) => (f === "f1" ? [colonyCand("c1")] : []), params: COLONY_PARAMS,
      },
      // no treasuryByFaction — this is the whole point of the case
    });

    expect(w.developments).toHaveLength(1);              // the colony is founded regardless
    expect(w.developments[0].systemId).toBe("c1");
    expect(w.developments[0].seedPop).toBe(EXPANSION.COLONY_SEED_POP);
    expect(w.developments[0].stockManifest).toEqual([]); // nothing staged ⇒ nothing delivered
    expect(w.foundingStagingDraws).toEqual([]);          // …and the founder was never drawn on
    expect(result.foundingDebitsByFaction?.get("f1") ?? 0).toBe(0);
    expect(result.foundingManifests).toEqual([]);
  });
});

// ── world-write gating ───────────────────────────────────────────
// Every bulk write is guarded on a non-empty batch, and the whole processor is guarded on there
// being a due shard with rows at all. A recording adapter is the only way to see a write that
// happened with nothing in it — the memory adapter's own state looks identical either way.

class RecordingBuildWorld extends MemoryDirectedBuildWorld {
  readonly calls: string[] = [];
  override async getSystemsForFactions(keys: Array<string | null>): Promise<SystemBuildRow[]> {
    this.calls.push("getSystemsForFactions");
    return super.getSystemsForFactions(keys);
  }
  override async getConstructionProjects(keys: Array<string | null>): Promise<WorldConstructionProject[]> {
    this.calls.push("getConstructionProjects");
    return super.getConstructionProjects(keys);
  }
  override async applyBuildingIncreases(updates: BuildBuildingUpdate[]): Promise<void> {
    this.calls.push("applyBuildingIncreases");
    return super.applyBuildingIncreases(updates);
  }
  override async applyConstructionUpdates(
    keys: Array<string | null>,
    projects: WorldConstructionProject[],
  ): Promise<void> {
    this.calls.push("applyConstructionUpdates");
    return super.applyConstructionUpdates(keys, projects);
  }
  override async applyProposalPersistenceUpdates(updates: ProposalPersistenceUpdate[]): Promise<void> {
    this.calls.push("applyProposalPersistenceUpdates");
    return super.applyProposalPersistenceUpdates(updates);
  }
  override async applyClaims(claims: SystemClaim[]): Promise<void> {
    this.calls.push("applyClaims");
    return super.applyClaims(claims);
  }
  override async applyDevelopments(developments: SystemDevelopment[]): Promise<void> {
    this.calls.push("applyDevelopments");
    return super.applyDevelopments(developments);
  }
  override async applyFoundingStagingDraws(draws: FoundingStagingDraw[]): Promise<void> {
    this.calls.push("applyFoundingStagingDraws");
    return super.applyFoundingStagingDraws(draws);
  }
}

/** A shard whose factions exist but whose row fetch comes back empty (a mid-tick ownership change). */
class RowlessBuildWorld extends RecordingBuildWorld {
  override async getSystemsForFactions(): Promise<SystemBuildRow[]> {
    this.calls.push("getSystemsForFactions");
    return [];
  }
}

/** A developed idle builder: fully housed, no markets, no slots — the planner proposes nothing at it. */
const idleHome = (population: number, systemId = "home"): SystemBuildRow => ({
  systemId, factionId: "f1", control: "developed", population,
  buildings: { [HOUSING_TYPE]: 5 }, yields: unitResourceVector(), extractionEff: unitResourceVector(), depositCounts: emptyResourceVector(),
 peopleLand: 5, markets: [],
});

/** One long-running in-flight build that can absorb a whole cycle's pool without ever landing. */
const endlessBuild = (systemId = "home"): WorldConstructionProject => ({
  kind: "build", id: "endless", origin: "auto", factionId: "f1", systemId,
  buildingType: "metals", levels: 1, workTotal: 1_000_000, workDone: 0,
});

describe("runDirectedBuildProcessor — world writes are batch-gated", () => {
  it("reads no systems at all on an off-boundary tick", async () => {
    // The cycle guard has to bail BEFORE the row fetch: an empty due-shard that still queried the
    // world would pay for every system read on 23 ticks out of 24 and return the same nothing.
    const w = new RecordingBuildWorld(scenario(0, 0));
    await runDirectedBuildProcessor(w, { tick: NOT_DUE_TICK }, {
      interval: INTERVAL, routeCost: reachable, construction: mkConstruction(4),
      claim: { reachProvider: () => [], rng: mulberry32(1), params: EXP_PARAMS },
    });
    expect(w.calls).toEqual([]);
  });

  it("persists nothing for a shard whose row fetch comes back empty", async () => {
    // Rows and faction keys are two separate reads. If the second returns nothing the first
    // promised, the processor must leave the queue alone — writing the (empty) open set would
    // delete every in-flight project those factions own.
    const w = new RowlessBuildWorld(scenario(0, 0), [endlessBuild("B")]);
    await runDirectedBuildProcessor(w, { tick: DUE_TICK }, {
      interval: INTERVAL, routeCost: reachable, construction: mkConstruction(4),
    });
    expect(w.calls).toEqual(["getSystemsForFactions"]);
    expect(w.constructionProjects).toHaveLength(1); // the in-flight project survived untouched
  });

  it("writes no claims when the claim phase resolves none", async () => {
    const w = new RecordingBuildWorld([ownedOnly("f1")]);
    await runDirectedBuildProcessor(w, { tick: DUE_TICK }, {
      interval: INTERVAL, routeCost: reachable, construction: mkConstruction(4),
      claim: { reachProvider: () => [], rng: mulberry32(1), params: EXP_PARAMS },
    });
    expect(w.calls).not.toContain("applyClaims");
  });

  it("calls no bulk write whose batch is empty", async () => {
    // One in-flight build at a marketless idle system: work is absorbed, nothing lands, nothing is
    // staged, nothing develops and no market row is assessed — so every write but the open-set
    // persist (which is unconditional by design) must stay unmade.
    const w = new RecordingBuildWorld([idleHome(1000)], [endlessBuild()]);
    await runDirectedBuildProcessor(w, { tick: DUE_TICK }, {
      interval: INTERVAL, routeCost: reachable, construction: mkConstruction(1000, 0.05),
    });
    expect(w.constructionProjects[0]?.workDone).toBeGreaterThan(0); // the cycle really did run
    expect(w.calls).not.toContain("applyFoundingStagingDraws");
    expect(w.calls).not.toContain("applyDevelopments");
    expect(w.calls).not.toContain("applyBuildingIncreases");
    expect(w.calls).not.toContain("applyProposalPersistenceUpdates");
    expect(w.calls).toContain("applyConstructionUpdates");
  });
});

// ── staging-draw internals ───────────────────────────────────────

const MUT_FEE = 100;
/** charterMult 0 + charterMin 100 ⇒ every charter is exactly 100, so money figures below are stated. */
const MUT_PARAMS: ColonyEstablishParams = { ...COLONY_PARAMS, charterMult: 0, charterMin: MUT_FEE };
const MUT_CAP = 4;
const MUT_WORK = 20;
const MUT_SHARE = MUT_CAP / MUT_WORK;

/** One committed, charter-paid establish from `home` — the planner's own gate is out of the way. */
function paidColony(over: Partial<WorldColonyEstablishProject> = {}): WorldColonyEstablishProject {
  return {
    kind: "colony_establish", id: "col", origin: "auto", factionId: "f1",
    systemId: "c1", sourceSystemId: "home", seedPop: EXPANSION.COLONY_SEED_POP,
    housingLevels: 1, workTotal: MUT_WORK, workDone: 0,
    stagedManifest: [], charterPaid: true, stalledCycles: 0, ...over,
  };
}

const mutPurse = (balance: number) =>
  new Map([["f1", { balance, pendingFounding: 0, maintenanceBill: 0 }]]);

async function runStaging(
  rows: SystemBuildRow[],
  projects: WorldConstructionProject[],
  balance: number,
  construction = mkConstruction(MUT_CAP, 0.05),
) {
  const w = new MemoryDirectedBuildWorld(rows, projects);
  const result = await runDirectedBuildProcessor(w, { tick: DUE_TICK }, {
    interval: INTERVAL, routeCost: reachable, construction,
    develop: { candidateProvider: () => [], params: MUT_PARAMS },
    treasuryByFaction: mutPurse(balance),
  });
  return { w, result };
}

describe("runDirectedBuildProcessor — the per-cycle staging plan", () => {
  it("blames nothing for a cycle with no absorption cap to spend", async () => {
    // A cap of zero is a cycle that could build nothing, so it asks for no share at all: the plan
    // is empty and the founder is not reported short of materials it was never asked for.
    const { w, result } = await runStaging(
      [stockedHome({ food: 5_000 })], [paidColony()], 1_000_000, mkConstruction(0, 0.05),
    );
    const stalls = result.foundingStalls ?? [];
    expect(stalls).toHaveLength(1);
    expect(stalls[0].gate).toBeNull();
    expect(stalls[0].materialsShort).toBe(false);
    expect(w.foundingStagingDraws).toEqual([]);
  });

  it("builds at the full cap on a cycle whose manifest is already carried in full", async () => {
    // Nothing left to want is fully achievable, not fully stalled: an empty share must not read as
    // a zero-satisfied share, or a colony that already holds its whole endowment would freeze.
    const carried: WorldColonyEstablishProject = paidColony({
      stagedManifest: [
        { goodId: "food", quantity: foundingWant("food") },
        { goodId: "water", quantity: foundingWant("water") },
      ],
    });
    const { w } = await runStaging([stockedHome({ food: 5_000, water: 5_000 })], [carried], 1_000_000);
    expect(w.constructionProjects.find((p) => p.id === "col")?.workDone).toBe(MUT_CAP);
    expect(w.foundingStagingDraws).toEqual([]);
  });

  it("keeps a good that has dropped off the list out of the funds gate's denominator", async () => {
    // A good already carried whole is not part of this cycle's priced share. Letting it back into
    // the achievable-fraction sum would poison the ratio and hand a part-funded colony a full cap.
    const waterShare = foundingWant("water") * MUT_SHARE;
    const halfWater = foundingGoodsValue([{ goodId: "water", quantity: waterShare }], 1) / 2;
    const carried: WorldColonyEstablishProject = paidColony({
      stagedManifest: [{ goodId: "food", quantity: foundingWant("food") }],
    });
    const { w } = await runStaging([stockedHome({ food: 5_000, water: 5_000 })], [carried], halfWater);
    // Half the (water-only) share is affordable ⇒ half a cap of work, not a whole one.
    expect(w.constructionProjects.find((p) => p.id === "col")?.workDone).toBeCloseTo(MUT_CAP / 2, 6);
  });

  it("spends one cycle's budget once across the goods it stages", async () => {
    // The running budget is what stops the second good being bought with the money the first
    // already spent — a colony must not stage more than the faction handed it.
    const foodShare = foundingWant("food") * MUT_SHARE;
    const foodValue = foundingGoodsValue([{ goodId: "food", quantity: foodShare }], 1);
    const { w } = await runStaging([stockedHome({ food: 5_000, water: 5_000 })], [paidColony()], foodValue);
    // Food (first on the source's list) takes the whole budget; water gets nothing at all.
    expect(w.foundingStagingDraws.map((d) => d.goodId)).toEqual(["food"]);
    expect(w.foundingStagingDraws[0].quantity).toBeCloseTo(foodShare, 6);
  });

  it("stages and charges exactly the share the work it absorbed bought", async () => {
    // Front-first funding leaves a colony part-way through its cycle allowance. Materials arrive in
    // step with the work: a quarter of the allowance stages a quarter of the share and costs a
    // quarter of its price — the figure the founder's shelves, the ledger and the bill all agree on.
    const cycleShare = foundingWant("food") * MUT_SHARE;
    const shareValue = foundingGoodsValue([{ goodId: "food", quantity: cycleShare }], 1);
    // pool = 1000 pop x 0.001 = 1 point against a cap of 4 ⇒ a quarter of the allowance.
    const { w, result } = await runStaging(
      [stockedHome({ food: 5_000 })], [paidColony()], 1_000_000, mkConstruction(MUT_CAP, 0.001),
    );
    const colony = w.constructionProjects.find((p) => p.id === "col");
    expect(colony?.workDone).toBeCloseTo(MUT_CAP / 4, 6); // the quarter-cap the pool funded
    const drawn = w.foundingStagingDraws.reduce((sum, d) => sum + d.quantity, 0);
    expect(drawn).toBeCloseTo(cycleShare / 4, 6);
    expect(result.foundingDebitsByFaction?.get("f1")).toBeCloseTo(shareValue / 4, 6);
    // A cycle that staged something is not a stalled cycle, whatever else held the rest of it back.
    expect((result.foundingStalls ?? []).every((s) => !s.stalled)).toBe(true);
  });

  it("plans no staging for a colony whose charter is still unpaid", async () => {
    // An unpaid colony has bought nothing, so it must reserve none of the faction's money: a plan
    // drawn for it would spend the balance the colony that DID pay is waiting to stage against.
    const cycleShare = foundingWant("food") * MUT_SHARE;
    const shareValue = foundingGoodsValue([{ goodId: "food", quantity: cycleShare }], 1);
    const unpaid: WorldColonyEstablishProject = paidColony({
      id: "unpaid", systemId: "c2", charterPaid: false,
    });
    const w = new MemoryDirectedBuildWorld([stockedHome({ food: 5_000 })], [unpaid, paidColony()]);
    const result = await runDirectedBuildProcessor(w, { tick: DUE_TICK }, {
      interval: INTERVAL, routeCost: reachable, construction: mkConstruction(MUT_CAP, 0.05),
      // A charter nobody can afford, so the unpaid colony stays unpaid through the whole cycle.
      develop: { candidateProvider: () => [], params: { ...MUT_PARAMS, charterMin: 1e9 } },
      treasuryByFaction: mutPurse(shareValue),
    });
    expect(w.foundingStagingDraws.reduce((sum, d) => sum + d.quantity, 0)).toBeCloseTo(cycleShare, 6);
    expect(w.constructionProjects.find((p) => p.id === "col")?.workDone).toBe(MUT_CAP);
    expect(result.foundingDebitsByFaction?.get("f1")).toBeCloseTo(shareValue, 6);
  });
});

describe("runDirectedBuildProcessor — the founder-cover reading", () => {
  const FOOD_USE = 10;
  const FOOD_STOCK = 5_000;
  const donorFloor = DIRECTED_LOGISTICS.DONOR_RESERVE_COVER * FOOD_USE;

  /** A founder whose food demand is pinned, so its donor floor is a stated number. */
  const pinnedFounder = (extraMarkets: MarketRowForLogistics[] = []): SystemBuildRow => ({
    ...saturatedHome(HOME_POP),
    markets: [
      { ...stockedMarket("home", "food", FOOD_STOCK), honestUseRate: FOOD_USE },
      ...extraMarkets,
    ],
  });

  it("reports the founder's post-draw stock over that good's donor floor", async () => {
    const { w, result } = await runStaging([pinnedFounder()], [paidColony()], 1_000_000);
    const drawn = w.foundingStagingDraws.reduce((sum, d) => sum + d.quantity, 0);
    expect(drawn).toBeGreaterThan(0);
    const events = result.foundingManifests ?? [];
    expect(events).toHaveLength(1);
    expect(events[0].founderCover).toBeCloseTo((FOOD_STOCK - drawn) / donorFloor, 9);
  });

  it("skips a good the founder has no use for rather than reading it as a cover of zero", async () => {
    // A good with no local demand has no donor floor to be drawn under. Dividing by that absent
    // floor would hand the whole reading a NaN and lose the cover of every good it DID move.
    const traceLuxuries: MarketRowForLogistics = {
      ...stockedMarket("home", "luxuries", 0.001), honestUseRate: 0,
    };
    const { w, result } = await runStaging([pinnedFounder([traceLuxuries])], [paidColony()], 1_000_000);
    // The whole (tiny) luxuries pile leaves, so its post-draw stock is exactly zero.
    const luxuries = w.foundingStagingDraws.find((d) => d.goodId === "luxuries");
    expect(luxuries?.quantity).toBeCloseTo(0.001, 12);
    const cover = (result.foundingManifests ?? [])[0]?.founderCover;
    expect(Number.isFinite(cover)).toBe(true);
    expect(cover).toBeGreaterThan(0);
  });
});

describe("runDirectedBuildProcessor — the founding gate record", () => {
  /** A paid establish whose source system is not in this shard's rows — it can never be given a plan. */
  const sourceless = (over: Partial<WorldColonyEstablishProject> = {}) =>
    paidColony({ sourceSystemId: "vanished", ...over });

  it("sizes a planless colony's allowance from the work the cycle opened with", async () => {
    // With no plan the gate has to reconstruct the cycle's allowance from the project itself, and
    // `workDone` already carries this cycle's absorption — so the allowance is measured against
    // what was left when the cycle STARTED, not against the whole project or against nothing.
    const ample = await runStaging(
      [saturatedHome(1000)], [sourceless({ workDone: MUT_WORK - 2 })], 1_000_000,
    );
    // Two points left, a cap of four: it absorbed its whole allowance and landed. Nothing gated it,
    // and a colony with no plan is never reported short of materials it stopped asking for.
    expect(ample.w.developments.map((d) => d.systemId)).toEqual(["c1"]);
    expect((ample.result.foundingStalls ?? []).map((s) => s.gate)).toEqual([null]);
    expect((ample.result.foundingStalls ?? []).every((s) => !s.materialsShort)).toBe(true);

    // Four points left against a pool of two: it moved, but only part of the allowance it had.
    const partial = await runStaging(
      [saturatedHome(1000)], [sourceless({ workDone: MUT_WORK - 4 })], 1_000_000,
      mkConstruction(MUT_CAP, 0.002),
    );
    expect(partial.w.constructionProjects.find((p) => p.id === "col")?.workDone)
      .toBeCloseTo(MUT_WORK - 2, 6);
    expect((partial.result.foundingStalls ?? []).map((s) => s.gate)).toEqual(["pool"]);
  });

  it("does not blame the pool for an allowance filled to within the float tolerance", async () => {
    // The 1e-9 is a float-dust tolerance, not a threshold: a colony that absorbed its whole
    // allowance bar a rounding crumb filled it, and reporting that as a starved queue would put
    // every fully-funded founding in the galaxy in the pool-throttled column.
    const bare: SystemBuildRow = {
      systemId: "home", factionId: "f1", control: "developed", population: 1, buildings: {},
      yields: unitResourceVector(), extractionEff: unitResourceVector(), depositCounts: emptyResourceVector(),
 peopleLand: 0, markets: [],
    };
    const { result } = await runStaging(
      [bare], [sourceless()], 1_000_000, mkConstruction(MUT_CAP, MUT_CAP - 1e-9),
    );
    // Sanity: the pool really is one crumb short of the cap (1 eligible head x the rate).
    expect(result.workPerformedByFaction?.get("f1")).toBe(MUT_CAP - 1e-9);
    expect((result.foundingStalls ?? []).map((s) => s.gate)).toEqual([null]);
  });

  it("counts a colony that opened with its work already done as a stalled cycle", async () => {
    // Nothing was funded because nothing was left to fund — the pool is not what stopped it, so the
    // cycle has to read as a manifest that went unstaged (which is what eventually writes it off).
    const { w, result } = await runStaging(
      [stockedHome({ food: 5_000 })], [paidColony({ workDone: MUT_WORK })], 1_000_000,
    );
    expect(w.developments.map((d) => d.systemId)).toEqual(["c1"]); // it completed on the spot
    const stalls = result.foundingStalls ?? [];
    expect(stalls).toHaveLength(1);
    expect(stalls[0].gate).toBeNull();
    expect(stalls[0].stalled).toBe(true);
  });
});

describe("runDirectedBuildProcessor — what the colony planner is shown", () => {
  /** A candidate seeded from an arbitrary source system. */
  const candFrom = (systemId: string, sourceSystemId: string): ColonyEstablishCandidate => ({
    systemId, peopleLand: 100, depositCounts: emptyResourceVector(), sourceSystemId,
  });

  it("shows the planner only economically-active systems", async () => {
    // A controlled system is not a seed source: it has no staffed output to forgo. Letting it into
    // the developed set prices a seed against production nobody is working, and the colony's whole
    // value disappears under a pop cost that does not exist.
    const controlledSource: SystemBuildRow = {
      systemId: "src", factionId: "f1", control: "controlled", population: 0, buildings: {},
      yields: unitResourceVector(), extractionEff: unitResourceVector(), depositCounts: emptyResourceVector(),
 peopleLand: 0,
      markets: [{ ...stockedMarket("src", "food", 0), realisedProductionRate: 100_000 }],
    };
    const w = new MemoryDirectedBuildWorld([saturatedHome(1000), controlledSource]);
    await runDirectedBuildProcessor(w, { tick: DUE_TICK }, {
      interval: INTERVAL, routeCost: reachable, construction: mkConstruction(4),
      develop: { candidateProvider: () => [candFrom("c1", "src")], params: COLONY_PARAMS },
    });
    expect(w.constructionProjects.some((p) => p.kind === "colony_establish")).toBe(true);
  });

  it("counts only colony projects as already in flight at a candidate", async () => {
    // "Already being established" is a colony-establish at that system, not any project at all — an
    // ordinary build at a candidate system must not veto colonising it.
    const buildAtCandidate: WorldConstructionProject = {
      kind: "build", id: "b1", origin: "auto", factionId: "f1", systemId: "c1",
      buildingType: "metals", levels: 1, workTotal: 1_000_000, workDone: 1,
    };
    const w = new MemoryDirectedBuildWorld([saturatedHome(1000)], [buildAtCandidate]);
    await runDirectedBuildProcessor(w, { tick: DUE_TICK }, {
      interval: INTERVAL, routeCost: reachable, construction: mkConstruction(4),
      develop: { candidateProvider: () => [colonyCand("c1")], params: COLONY_PARAMS },
    });
    expect(w.constructionProjects.some((p) => p.kind === "colony_establish" && p.systemId === "c1"))
      .toBe(true);
  });

  it("shows the planner the faction's working balance, so it proposes nothing it cannot commit to", async () => {
    // The affordability gate needs the purse. Without it every candidate reads as free and the
    // faction commits to colonies whose charter it can never pay — each one a live founding record
    // reporting a colony refused by money it was never asked to have.
    const w = new MemoryDirectedBuildWorld([saturatedHome(1000)]);
    const result = await runDirectedBuildProcessor(w, { tick: DUE_TICK }, {
      interval: INTERVAL, routeCost: reachable, construction: mkConstruction(4),
      develop: { candidateProvider: () => [colonyCand("c1")], params: MUT_PARAMS },
      treasuryByFaction: mutPurse(10), // a tenth of the flat charter
    });
    expect(w.constructionProjects.some((p) => p.kind === "colony_establish")).toBe(false);
    expect(result.foundingStalls).toEqual([]);
  });

  it("never colonises for the independents group", async () => {
    const w = new MemoryDirectedBuildWorld([{ ...saturatedHome(1000), factionId: null }]);
    await runDirectedBuildProcessor(w, { tick: DUE_TICK }, {
      interval: INTERVAL, routeCost: reachable, construction: mkConstruction(4),
      develop: { candidateProvider: () => [colonyCand("c1")], params: COLONY_PARAMS },
    });
    expect(w.constructionProjects).toHaveLength(0);
    expect(w.developments).toHaveLength(0);
  });

  it("leaves founding unpriced when the develop params are absent, whatever the treasury says", async () => {
    // Money and colony policy arrive together. A treasury with no policy behind it must not put
    // founding on the priced path: there is no charter to quote and no cover to size a share from.
    for (const charterPaid of [false, true]) {
      const w = new MemoryDirectedBuildWorld(
        [stockedHome({ food: 5_000 })], [paidColony({ charterPaid })],
      );
      const result = await runDirectedBuildProcessor(w, { tick: DUE_TICK }, {
        interval: INTERVAL, routeCost: reachable, construction: mkConstruction(MUT_CAP, 0.05),
        treasuryByFaction: mutPurse(1_000_000), // …but no `develop` params
      });
      expect(w.constructionProjects.find((p) => p.id === "col")?.workDone).toBe(MUT_CAP);
      expect(w.foundingStagingDraws).toEqual([]);
      expect(result.foundingStalls).toEqual([]);
      expect(result.foundingDebitsByFaction?.size ?? 0).toBe(0);
    }
  });

  it("proposes no construction centre while the player's build automation is off", async () => {
    // A centre is build-domain work. With the build switch off it must not slip in through the
    // colony proposals that are still being made — the switch gates the domain, not one emitter.
    // (A centre is never land-gated — habitability-seeding deleted the industry-land budget,
    // Task 15 — so no widened-space fixture is needed to let it site.)
    const w = new MemoryDirectedBuildWorld([saturatedHome(1000)]);
    await runDirectedBuildProcessor(w, { tick: DUE_TICK }, {
      interval: INTERVAL, routeCost: reachable, construction: mkConstruction(2, 0.005),
      develop: { candidateProvider: () => [colonyOf("c1", 1_000_000)], params: COLONY_PARAMS },
      player: { factionId: "f1", automation: { build: false, colonisation: true } },
    });
    expect(w.constructionProjects.some((p) => p.kind === "colony_establish")).toBe(true); // sanity
    expect(w.constructionProjects.some(
      (p) => p.kind === "build" && p.buildingType === CONSTRUCTION_CENTRE_TYPE,
    )).toBe(false);
  });
});

describe("runDirectedBuildProcessor — who the pool floor is reserved for", () => {
  const floorHome = (): SystemBuildRow => ({
    systemId: "H", factionId: "f1", control: "developed", population: 400,
    buildings: { [HOUSING_TYPE]: 20 }, yields: unitResourceVector(), extractionEff: unitResourceVector(), depositCounts: emptyResourceVector(),
 peopleLand: 20, markets: [],
  });
  const floorColony = (control: SystemControl): SystemBuildRow => ({
    systemId: "C", factionId: "f1", control, population: 2,
    buildings: { [HOUSING_TYPE]: 20 }, yields: unitResourceVector(), extractionEff: unitResourceVector(), depositCounts: emptyResourceVector(),
 peopleLand: 20, markets: [],
  });
  const frontBuild = (): WorldConstructionProject => ({
    id: "pH", kind: "build", origin: "auto", factionId: "f1", systemId: "H",
    buildingType: HOUSING_TYPE, levels: 5, workTotal: 1000, workDone: 0,
  });
  const floorConstruction = () =>
    mkConstruction(1000, 0.05, CONSTRUCTION.POOL_FLOOR_BASE, CONSTRUCTION.FLOOR_DEV_KNEE);

  it("reserves nothing for a system that is not economically active", async () => {
    // The floor exists so a young DEVELOPED colony's first build is not monopolised out of the
    // pool. A controlled system hosts no economy at all; reserving for it would hand the shard's
    // construction points to a project the build gate would never have created.
    const stray: WorldConstructionProject = {
      id: "pC", kind: "build", origin: "auto", factionId: "f1", systemId: "C",
      buildingType: HOUSING_TYPE, levels: 5, workTotal: 1000, workDone: 0,
    };
    const w = new MemoryDirectedBuildWorld([floorHome(), floorColony("controlled")], [frontBuild(), stray]);
    await runDirectedBuildProcessor(w, { tick: DUE_TICK }, {
      interval: INTERVAL, routeCost: reachable, construction: floorConstruction(),
    });
    expect(w.constructionProjects.find((p) => p.id === "pH")?.workDone).toBeGreaterThan(0);
    expect(w.constructionProjects.find((p) => p.id === "pC")?.workDone).toBe(0);
  });

  it("reserves nothing for a colony-establish sitting on a floor-eligible system", async () => {
    // The floor is a BUILD reservation — colonies are paced by the charter and the materials
    // ceiling instead. An establish that happened to sit on a young system must not draw on it.
    const colonyAtC: WorldConstructionProject = {
      kind: "colony_establish", id: "pC", origin: "auto", factionId: "f1", systemId: "C",
      sourceSystemId: "H", seedPop: 2, housingLevels: 1, workTotal: 1000, workDone: 0,
      stagedManifest: [], charterPaid: true, stalledCycles: 0,
    };
    const w = new MemoryDirectedBuildWorld([floorHome(), floorColony("developed")], [frontBuild(), colonyAtC]);
    await runDirectedBuildProcessor(w, { tick: DUE_TICK }, {
      interval: INTERVAL, routeCost: reachable, construction: floorConstruction(),
    });
    expect(w.constructionProjects.find((p) => p.id === "pH")?.workDone).toBeGreaterThan(0);
    expect(w.constructionProjects.find((p) => p.id === "pC")?.workDone).toBe(0);
  });

});

describe("runDirectedBuildProcessor — landing writes", () => {
  it("lands a build whose system is not among this shard's rows", async () => {
    // A stored project can outlive the row fetch that would carry its current counts (a system that
    // changed hands mid-cycle). Its landing still has to write an absolute count — from zero.
    const offshard: WorldConstructionProject = {
      kind: "build", id: "off", origin: "auto", factionId: "f1", systemId: "s9",
      buildingType: "metals", levels: 2, workTotal: 4, workDone: 0,
    };
    const w = new MemoryDirectedBuildWorld(scenario(0, 0), [offshard]);
    await runDirectedBuildProcessor(w, { tick: DUE_TICK }, {
      interval: INTERVAL, routeCost: reachable, construction: mkConstruction(1000, 1),
    });
    expect(w.buildingUpdates).toContainEqual({ systemId: "s9", buildingType: "metals", count: 2 });
  });

  it("lands one level of a multi-level project and persists the rest as an open remainder", async () => {
    // A build that crosses a level boundary without completing appears in the SAME cycle as both a
    // landed row and an open row under one id. The two write paths must each take their own half:
    // the count write adds only the levels that landed, and the persisted queue keeps the remainder
    // (same id, the levels that did not) rather than dropping it or re-landing the whole bundle.
    const split: WorldConstructionProject = {
      kind: "build", id: "split", origin: "auto", factionId: "f1", systemId: "s9",
      buildingType: "metals", levels: 2, workTotal: 4, workDone: 0,
    };
    const w = new MemoryDirectedBuildWorld(scenario(0, 0), [split]);
    // cap 2 = exactly one level's work (workTotal 4 ÷ 2 levels), so the project absorbs its first
    // level this cycle and nothing more.
    await runDirectedBuildProcessor(w, { tick: DUE_TICK }, {
      interval: INTERVAL, routeCost: reachable, construction: mkConstruction(2, 1),
    });
    expect(w.buildingUpdates).toContainEqual({ systemId: "s9", buildingType: "metals", count: 1 });
    const remainder = w.constructionProjects.filter((p) => p.id === "split");
    expect(remainder).toHaveLength(1);
    expect(remainder[0]).toMatchObject({ id: "split", levels: 1, workTotal: 2, workDone: 0 });
  });

  it("writes no building update for a landing that adds no levels", async () => {
    // A zero-level landing is not a count change; emitting it would rewrite the system's current
    // count for no reason, and the write path is absolute, not incremental.
    const empty: WorldConstructionProject = {
      kind: "build", id: "zero", origin: "auto", factionId: "f1", systemId: "B",
      buildingType: "metals", levels: 0, workTotal: 0, workDone: 0,
    };
    const w = new MemoryDirectedBuildWorld(scenario(0, 0), [empty]);
    await runDirectedBuildProcessor(w, { tick: DUE_TICK }, {
      interval: INTERVAL, routeCost: reachable, construction: mkConstruction(1000, 0),
    });
    expect(w.constructionProjects.some((p) => p.id === "zero")).toBe(false); // it did land
    expect(w.buildingUpdates).toEqual([]);
  });

  it("drops an in-flight construction centre that received no work this cycle", async () => {
    // Persist-if-funded: a centre is re-priced and re-proposed every cycle, so a workless row is
    // dropped to keep the queue live. Keeping it would also block the next cycle's re-pricing —
    // planCentreProposal refuses to value a second centre while one is in flight.
    const centre: WorldConstructionProject = {
      kind: "build", id: "centre", origin: "auto", factionId: "f1", systemId: "home",
      buildingType: CONSTRUCTION_CENTRE_TYPE, levels: 1, workTotal: 100, workDone: 0,
    };
    const w = new MemoryDirectedBuildWorld([idleHome(1000)], [centre]);
    await runDirectedBuildProcessor(w, { tick: DUE_TICK }, {
      interval: INTERVAL, routeCost: reachable, construction: mkConstruction(1000, 0), // zero pool
    });
    expect(w.constructionProjects).toEqual([]);
  });
});
