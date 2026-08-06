import { describe, it, expect } from "vitest";
import { runDirectedBuildProcessor } from "@/lib/tick/processors/directed-build";
import { MemoryDirectedBuildWorld } from "@/lib/tick/adapters/memory/directed-build";
import type { SystemBuildRow } from "@/lib/tick/world/directed-build-world";
import type { MarketRowForLogistics } from "@/lib/tick/world/directed-logistics-world";
import type { SystemControl, WorldConstructionProject } from "@/lib/world/types";
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
import { surplusDrawable } from "@/lib/engine/directed-logistics";
import { consumptionRate, type CivilianDemandBasis } from "@/lib/engine/physical-economy";
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
  const slotCap = emptyResourceVector();
  for (const k of RESOURCE_TYPES) slotCap[k] = n;
  return slotCap;
}

// A: deep structural food deficit, no capacity. B: builder with arable slots + population, reachable from A.
// generalSpace defaults to habitableSpace (100) so housing's habitable-capped headroom also exhausts B's
// general space, matching every pre-existing call site; the centre tests below widen it so a centre can
// still site itself once housing has claimed its habitable-bounded share. `aOpts` lets the industry tests
// mark A developed (only developed systems contribute counted deficits) and seed its persisted proposal
// clock so the persistence-gated food build emits on the cycle under test; it defaults to the inert
// unclaimed A every pre-existing call site relies on.
function scenario(
  bFood: number,
  bHousing: number,
  slots = 20,
  generalSpace = 100,
  aOpts?: { control?: SystemControl; foodCycles?: number },
): SystemBuildRow[] {
  return [
    {
      systemId: "A", factionId: "f1", control: aOpts?.control ?? "unclaimed", population: 100, buildings: {},
      yields: unitResourceVector(), slotCap: emptyResourceVector(),
      generalSpace: 0, habitableSpace: 0, markets: [foodMarket("A", 1, aOpts?.foodCycles)],
    },
    {
      systemId: "B", factionId: "f1", control: "developed", population: 5000,
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
      yields: unitResourceVector(), slotCap: builderSlots(10), generalSpace: 0, habitableSpace: 0,
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
      buildings: {}, yields: unitResourceVector(), slotCap: emptyResourceVector(),
      generalSpace: 10, habitableSpace: 3, markets: [],
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
    const w = new MemoryDirectedBuildWorld(scenario(0, 0, 20, 100, { control: "developed", foodCycles: 1 }));
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
        yields: unitResourceVector(), slotCap: emptyResourceVector(),
        generalSpace: 0, habitableSpace: 0, markets: [foodMarket("A1", 1, 1)],
      },
      {
        systemId: "A2", factionId: "f1", control: "developed", population: 100000, buildings: {},
        yields: unitResourceVector(), slotCap: emptyResourceVector(),
        generalSpace: 0, habitableSpace: 0, markets: [foodMarket("A2", 1, 1)],
      },
      {
        systemId: "B1", factionId: "f1", control: "developed", population: 5000, buildings: {},
        yields: unitResourceVector(), slotCap: builderSlots(20), generalSpace: 100, habitableSpace: 100, markets: [],
      },
      {
        systemId: "B2", factionId: "f1", control: "developed", population: 5000, buildings: {},
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

describe("runDirectedBuildProcessor — proposal-pressure persistence (the construction clock)", () => {
  // A developed food SINK (no capacity) whose persisted proposal clock advances toward the saturating
  // PERSISTENCE_CYCLES while its structural residual survives; a covered good resets to 0. Distinct from
  // the economy's squeeze clock — this counter is written by directed-build, keyed by market id.
  const sink = (systemId: string, population: number, foodCycles?: number): SystemBuildRow => ({
    systemId, factionId: "f1", control: "developed", population,
    buildings: {}, yields: unitResourceVector(), slotCap: emptyResourceVector(),
    generalSpace: 0, habitableSpace: 0, markets: [foodMarket(systemId, 1, foodCycles)],
  });

  it("writes a saturating increment for a persistent deficit and a reset for a covered good", async () => {
    // A: a pop-100 sink whose residual survives (prior clock 1 → 2, capped). Z: a pop-0 sink → no demand
    // → no residual → the clock resets to 0. Both are due developed rows, so both write.
    const w = new MemoryDirectedBuildWorld([sink("A", 100, 1), sink("Z", 0, 1)]);
    await runDirectedBuildProcessor(w, { tick: DUE_TICK }, { interval: INTERVAL, routeCost: reachable, construction: mkConstruction(4) });
    expect(w.proposalCycleUpdates.get("A|food")).toBe(2); // residual persists → saturating increment
    expect(w.proposalCycleUpdates.get("Z|food")).toBe(0); // no demand → reset
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
    const w = new MemoryDirectedBuildWorld(scenario(0, 0, 20, 100, { control: "developed", foodCycles: 1 }));
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
    const w = new MemoryDirectedBuildWorld(scenario(0, 0, 20, 100, { control: "developed", foodCycles: 1 }));
    await runDirectedBuildProcessor(w, { tick: DUE_TICK }, {
      interval: INTERVAL, routeCost: reachable, construction: mkConstruction(4),
      player: { factionId: "f1", automation: { build: true, colonisation: false } },
    });
    expect(w.proposalCycleUpdates.get("A|food")).toBe(2);
    expect(w.constructionProjects.some((p) => p.kind === "build" && p.systemId === "B" && p.buildingType === "food")).toBe(true);
  });

  // A developed food SELF-SUPPLIER: buildings cover 1.1× demand (no capacity gap) and a persisted realized
  // rate of 0 keeps it off the exporter self-netting path — so the ONLY thing that can advance its clock is
  // the squeeze-feedback gap, isolating the two guards that suppress it.
  const rationedSelfSupplier = (extra: Partial<MarketRowForLogistics>): SystemBuildRow => ({
    systemId: "S", factionId: "f1", control: "developed", population: 20,
    buildings: { food: 10 }, yields: unitResourceVector(), slotCap: builderSlots(50), generalSpace: 100, habitableSpace: 0,
    markets: [{
      id: "S|food", goodId: "food", stock: 50, anchorMult: 1, demandRate: 10, storageCapacity: 0,
      squeezeCycles: 2, satisfaction: 0, realizedProductionRate: 0, proposalCycles: 1, ...extra,
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
    const w = new MemoryDirectedBuildWorld(scenario(0, 0, 20, 1000, { control: "developed", foodCycles: 1 }));
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
    const fullyHoused = scenario(0, 100, 20, 1000, { control: "developed", foodCycles: 1 });
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
  maxClaimsPerCycle: 1, scoreFloor: 0.001, weights: { habitable: 1, diversity: 3, proximity: 0.5 },
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
    systemId: `${factionId}-home`, factionId, control: "developed", population: 100,
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

  it("claims nothing off the cycle boundary", async () => {
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

  it("develops nothing off the cycle boundary", async () => {
    const w = new MemoryDirectedBuildWorld([saturatedHome(1000)]);
    await runDirectedBuildProcessor(w, { tick: NOT_DUE_TICK }, {
      interval: INTERVAL, routeCost: reachable, construction: mkConstruction(1000, 1),
      develop: { candidateProvider: () => [colonyCand("c1")], params: COLONY_PARAMS },
    });
    expect(w.developments).toHaveLength(0);
    expect(w.constructionProjects).toHaveLength(0);
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

/** A developed home saturated on housing (σ = 1, no housing headroom) but carrying a deep food deficit
 *  with spare labour + food slots — so it emits a food industry build proposal that competes with a
 *  colony in the same pool. Population sets labour; the pool is kept scarce via mkConstruction's rate. */
function homeWithFoodDeficit(population = 1000): SystemBuildRow {
  return {
    systemId: "home", factionId: "f1", control: "developed", population,
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
    // pool = 1000 × 0.004 = 4 → one cap-worth; only the front of the ROI-ordered queue funds this cycle.
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
    // The food build was proposed but starved of the pool this cycle (builds persist at workDone 0).
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
      buildings: { [HOUSING_TYPE]: 20 }, yields: unitResourceVector(), slotCap: emptyResourceVector(),
      generalSpace: 0, habitableSpace: 20, markets: [],
    },
    {
      systemId: "C", factionId: "f1", control: "developed", population: 2,
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
    systemId: "B", factionId: "f1", control: "developed", population,
    buildings: { [HOUSING_TYPE]: 5 }, yields: unitResourceVector(), slotCap: emptyResourceVector(),
    generalSpace: 5, habitableSpace: 5, markets: [],
  });

  it("interval scaling preserves wall-clock minimum build time", async () => {
    // One in-flight project whose work is exactly 2 × the reference cap, pool ample (cap binds). At
    // interval 24 (catchUp 1) it lands after 2 cycles; at interval 12 (catchUp 0.5) the effective cap
    // halves, so it needs 4 cycles — 2×24 = 4×12 = 48 wall-clock ticks either way.
    const project = (): WorldConstructionProject => ({
      id: "e", kind: "build", origin: "auto", factionId: "f1", systemId: "B", buildingType: HOUSING_TYPE, levels: 5, workTotal: 2 * CAP, workDone: 0,
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
        buildings: { [HOUSING_TYPE]: 20 }, yields: unitResourceVector(), slotCap: emptyResourceVector(),
        generalSpace: 0, habitableSpace: 20, markets: [],
      },
      {
        systemId: "C", factionId: "f1", control: "developed", population: 2,
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

describe("construction funding gate", () => {
  // One developed system, one standing player order with a huge remaining work total, a cap
  // larger than the pool → absorbed work per cycle equals the pool exactly, making the
  // funded-fraction scaling directly observable via workPerformedByFaction.
  const row = (): SystemBuildRow => ({
    systemId: "s1", factionId: "f1", control: "developed" as const,
    population: 100, buildings: {},
    yields: emptyResourceVector(), slotCap: emptyResourceVector(),
    generalSpace: 0, habitableSpace: 0, markets: [],
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
    const w = new MemoryDirectedBuildWorld(scenario(0, 0, 20, 100, { control: "developed", foodCycles: 1 }));
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
    const w = new MemoryDirectedBuildWorld(scenario(0, 0, 20, 1000, { control: "developed", foodCycles: 1 }));
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
    const rows = scenario(0, 0, 20, 100, { control: "developed", foodCycles: 1 });

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
    const w = new MemoryDirectedBuildWorld(scenario(0, 0, 20, 100, { control: "developed", foodCycles: 1 }));
    const result = await runDirectedBuildProcessor(w, { tick: DUE_TICK }, { interval: INTERVAL, routeCost: reachable, construction: mkConstruction(1000, 1) });
    const landedFood = w.buildingUpdates.find((u) => u.systemId === "B" && u.buildingType === "food");
    expect(landedFood).toBeDefined(); // sanity: it actually landed this cycle, not just queued
    expect(result.buildCommitmentsByGood?.get("food")).toBe(landedFood?.count);
  });

  it("reports no build commitments when nothing is proposed", async () => {
    const balanced: SystemBuildRow[] = [{
      systemId: "A", factionId: "f1", control: "developed", population: 0, buildings: {},
      yields: unitResourceVector(), slotCap: builderSlots(10), generalSpace: 0, habitableSpace: 0,
      markets: [foodMarket("A", 1)], // population 0 → no consumption → no rate deficit; no habitable land → no housing
    }];
    const w = new MemoryDirectedBuildWorld(balanced);
    const result = await runDirectedBuildProcessor(w, { tick: DUE_TICK }, { interval: INTERVAL, routeCost: reachable, construction: mkConstruction() });
    expect(result.buildCommitmentsByGood?.size ?? 0).toBe(0);
  });

  it("reports no build commitments on an off-boundary tick (cycle start)", async () => {
    const w = new MemoryDirectedBuildWorld(scenario(0, 0, 20, 100, { control: "developed", foodCycles: 1 }));
    const result = await runDirectedBuildProcessor(w, { tick: NOT_DUE_TICK }, { interval: INTERVAL, routeCost: reachable, construction: mkConstruction() });
    expect(result.buildCommitmentsByGood?.size ?? 0).toBe(0);
  });
});

// ── founding stock endowment ─────────────────────────────────────
// A colony used to open holding nothing, so it read as starving from its first cycle before any
// logistics could reach it. It now arrives with a slice of its founder's warehouses, sized on its
// OWN basket and capped by what the founder can spare.

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
 * `exportRates` gives a good a realized output; above the home's own demand it becomes a structural
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
      realizedProductionRate: exportRates[goodId],
    })),
  };
}

const developColony = (w: MemoryDirectedBuildWorld, candidates: ColonyEstablishCandidate[]) =>
  runDirectedBuildProcessor(w, { tick: DUE_TICK }, {
    interval: INTERVAL, routeCost: reachable, construction: mkConstruction(1000, 1),
    develop: { candidateProvider: (f) => (f === "f1" ? candidates : []), params: COLONY_PARAMS },
  });

describe("runDirectedBuildProcessor: colony founding stock", () => {
  it("weights the manifest like the colony's own basket, not a flat share", async () => {
    // Ample stock of each, so the COLONY's want is what binds rather than the founder's spare.
    const w = new MemoryDirectedBuildWorld([stockedHome({ food: 5_000, water: 5_000, luxuries: 5_000 })]);
    const result = await developColony(w, [colonyCand("c1")]);

    const manifest = new Map(w.developments[0].stockManifest.map((l) => [l.goodId, l.quantity]));
    for (const goodId of ["food", "water", "luxuries"]) {
      expect(manifest.get(goodId)).toBeCloseTo(foundingWant(goodId), 6);
    }
    // The shape that matters: a 2-pop seed is sent staples, and only a trace of what nobody there
    // yet consumes much of. Water and food are the biggest per-capita needs; luxuries the smallest.
    expect(manifest.get("water")!).toBeGreaterThan(manifest.get("luxuries")! * 5);
    expect(manifest.get("food")!).toBeGreaterThan(manifest.get("luxuries")! * 5);

    // The founding-cost readout the harness samples: one record per provisioned founding, its
    // tonnage the manifest's own line sum, attributed to the founder that paid it.
    expect(result.foundingManifests).toHaveLength(1);
    const record = result.foundingManifests?.[0];
    if (record === undefined) throw new Error("Expected a founding manifest record");
    expect(record.systemId).toBe("c1");
    expect(record.sourceSystemId).toBe("home");
    const manifestTonnage = w.developments[0].stockManifest
      .reduce((sum, line) => sum + line.quantity, 0);
    expect(record.tonnage).toBeCloseTo(manifestTonnage, 9);
    expect(record.goodIds).toEqual(w.developments[0].stockManifest.map((l) => l.goodId));
  });

  it("never draws the founder below its own drawable surplus", async () => {
    // A food exporter parked just above its strategic reserve, so surplusDrawable — not the colony's
    // want — is the binding cap. It has to be an exporter to sit that finely: an ordinary donor keeps
    // DONOR_RESERVE_COVER cycles of its OWN demand, and at this population that floor is far above
    // anything a 2-pop seed asks for, so a non-exporting home of this size simply spares nothing.
    const homeDemand = consumptionRate("food", { population: HOME_POP, technicians: 0, engineers: 0 });
    const exportRate = homeDemand * 2;
    const stock = DIRECTED_LOGISTICS.EXPORT_RESERVE_COVER * homeDemand + foundingWant("food") / 2;
    const w = new MemoryDirectedBuildWorld([stockedHome({ food: stock }, { food: exportRate })]);
    await developColony(w, [colonyCand("c1")]);

    const food = w.developments[0].stockManifest.find((l) => l.goodId === "food");
    const drawable = surplusDrawable(
      stock, DIRECTED_LOGISTICS.DONOR_RESERVE_COVER * homeDemand,
      homeDemand, exportRate, false,
    );
    expect(drawable).toBeGreaterThan(0);
    expect(drawable).toBeLessThan(foundingWant("food")); // the founder's spare, not the want, binds
    expect(food?.quantity ?? 0).toBeCloseTo(drawable, 6);
  });

  it("sends nothing from a source that holds nothing, and the colony still lands", async () => {
    const w = new MemoryDirectedBuildWorld([stockedHome({ food: 0, water: 0 })]);
    const result = await developColony(w, [colonyCand("c1")]);

    expect(w.developments).toHaveLength(1);       // the colony is founded regardless
    expect(w.developments[0].seedPop).toBe(EXPANSION.COLONY_SEED_POP);
    expect(w.developments[0].stockManifest).toEqual([]);
    // An unprovisioned founding cost its founder nothing — it must not appear in the
    // founding-cost readout at all, or the harness reads it as a founder drained flat.
    expect(result.foundingManifests).toEqual([]);
  });

  it("draws two colonies from one shrinking source balance, never twice from the opening stock", async () => {
    // A food exporter, so the drawable surplus slides continuously above the strategic reserve and can
    // be parked at one-and-a-half wants — enough for the first colony's want and only a remainder for
    // the second. Without a shared balance both would read the same opening figure and both would be
    // granted a full want, minting stock the founder never had.
    const homeDemand = consumptionRate("food", { population: HOME_POP, technicians: 0, engineers: 0 });
    const exportRate = homeDemand * 2;
    const stock = DIRECTED_LOGISTICS.EXPORT_RESERVE_COVER * homeDemand + foundingWant("food") * 1.5;
    const w = new MemoryDirectedBuildWorld([stockedHome({ food: stock }, { food: exportRate })]);
    await developColony(w, [colonyCand("c1"), colonyCand("c2")]);

    expect(w.developments.length).toBeGreaterThanOrEqual(2);
    const draws = w.developments.map(
      (d) => d.stockManifest.find((l) => l.goodId === "food")?.quantity ?? 0,
    );
    const drawable = surplusDrawable(
      stock, DIRECTED_LOGISTICS.DONOR_RESERVE_COVER * homeDemand,
      homeDemand, exportRate, false,
    );
    expect(draws[0]).toBeCloseTo(foundingWant("food"), 6); // the first colony is fully provisioned…
    expect(draws[1]).toBeGreaterThan(0);
    expect(draws[1]).toBeLessThan(draws[0]);               // …the second gets only what is left…
    expect(draws[0] + draws[1]).toBeCloseTo(drawable, 6);  // …and the pile is spent exactly once
  });
});
