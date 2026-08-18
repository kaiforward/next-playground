import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { generateWorld } from "@/lib/world/gen";
import { setWorld, getWorld, clearWorld } from "@/lib/world/store";
import { getFactionConstruction, getSystemConstruction } from "@/lib/services/construction";
import { orderBuild } from "@/lib/services/construction-orders";
import { seatWorld } from "./seat-world";
import { ServiceError } from "@/lib/services/errors";
import { CONSTRUCTION_CENTRE_TYPE, VOCATIONAL_SCHOOL_TYPE, HOUSING_TYPE } from "@/lib/constants/industry";
import type { World, WorldSystem } from "@/lib/world/types";

let world: World;
let dev: WorldSystem;      // a developed system with a faction
let ctrlWithColony: WorldSystem;
let ctrlEmpty: WorldSystem;
let factionId: string;

beforeEach(() => {
  world = generateWorld({ systemCount: 60, seed: 14 });
  const developed = [...world.systems]
    .filter((s) => s.control === "developed" && s.factionId !== null)
    .sort((a, b) => b.population - a.population);
  dev = developed[0];
  if (!dev || dev.factionId === null) throw new Error("fixture: expected a developed faction system");
  factionId = dev.factionId;
  // Repurpose two other systems of the same faction into controlled test fixtures.
  const others = world.systems.filter((s) => s.id !== dev.id);
  ctrlWithColony = others[0];
  ctrlEmpty = others[1];
  for (const s of [ctrlWithColony, ctrlEmpty]) { s.factionId = factionId; s.control = "controlled"; s.population = 0; }

  world.constructionProjects = [
    { kind: "build", id: "b1", origin: "auto", factionId, systemId: dev.id, buildingType: "housing", levels: 4, workTotal: 40, workDone: 32 },
    { kind: "colony_establish", id: "c1", origin: "auto", factionId, systemId: ctrlWithColony.id, sourceSystemId: dev.id, seedPop: 340, housingLevels: 3, workTotal: 100, workDone: 62, stagedManifest: [], charterPaid: true, stalledCycles: 0 },
  ];
  setWorld(world);
});

afterEach(() => { clearWorld(); });

describe("getFactionConstruction", () => {
  it("groups build systems and colonies with a positive pool", () => {
    const data = getFactionConstruction(factionId);
    expect(data.pool).toBeGreaterThan(0);
    expect(data.colonies.length).toBe(1);
    expect(data.colonies[0].systemId).toBe(ctrlWithColony.id);
    expect(data.buildSystems.length).toBe(1);
    expect(data.buildSystems[0].systemId).toBe(dev.id);
    expect(data.buildSystems[0].count).toBe(1);
  });
  it("scopes the roll-up to one faction and orders both lists for the eye", () => {
    // The summary is a navigation surface: build systems lead with the busiest, colonies with the
    // nearest to opening, and neither list may carry another faction's work — a rival's queue in a
    // player's command summary is both a leak and a link that goes nowhere.
    const rival = world.systems.find(
      (s) => s.factionId !== null && s.factionId !== factionId && s.control === "developed",
    );
    if (!rival || rival.factionId === null) throw new Error("fixture: expected a rival system");
    const spare = world.systems.filter((s) => s.factionId === factionId && s.id !== dev.id);
    const [second, third] = [spare[0], spare[1]];
    if (!second || !third) throw new Error("fixture: expected two more systems for the faction");
    second.control = "developed";
    third.control = "controlled";

    setWorld({
      ...world,
      constructionProjects: [
        // `second` carries two builds, `dev` one → `second` must lead the build list.
        { kind: "build", id: "d1", origin: "auto", factionId, systemId: dev.id, buildingType: "housing", levels: 1, workTotal: 40, workDone: 0 },
        { kind: "build", id: "s1", origin: "player", factionId, systemId: second.id, buildingType: "housing", levels: 1, workTotal: 40, workDone: 0 },
        { kind: "build", id: "s2", origin: "player", factionId, systemId: second.id, buildingType: "housing", levels: 1, workTotal: 40, workDone: 0 },
        // Two colonies at different progress → the nearer one leads.
        { kind: "colony_establish", id: "cA", origin: "auto", factionId, systemId: ctrlWithColony.id, sourceSystemId: dev.id, seedPop: 2, housingLevels: 1, workTotal: 100, workDone: 10, stagedManifest: [], charterPaid: true, stalledCycles: 0 },
        { kind: "colony_establish", id: "cB", origin: "auto", factionId, systemId: third.id, sourceSystemId: dev.id, seedPop: 2, housingLevels: 1, workTotal: 100, workDone: 90, stagedManifest: [], charterPaid: true, stalledCycles: 0 },
        // A rival's work, in the same world.
        { kind: "build", id: "r1", origin: "player", factionId: rival.factionId, systemId: rival.id, buildingType: "housing", levels: 1, workTotal: 40, workDone: 0 },
      ],
    });

    const data = getFactionConstruction(factionId);
    expect(data.buildSystems.map((s) => s.systemId)).toEqual([second.id, dev.id]);
    expect(data.buildSystems[0].count).toBe(2);
    expect(data.colonies.map((c) => c.systemId)).toEqual([third.id, ctrlWithColony.id]);
    expect(data.colonies[0].progress).toBeGreaterThan(data.colonies[1].progress);
    // Only the rows the player actually ordered are counted as orders.
    expect(data.orderedCount).toBe(2);
    // …and nothing of the rival's is in either list.
    expect(data.buildSystems.some((s) => s.systemId === rival.id)).toBe(false);
    expect(getFactionConstruction(rival.factionId).buildSystems.map((s) => s.systemId)).toEqual([rival.id]);
  });

  it("orders colonies by progress first, breaking only a tie to the name — never by name alone", () => {
    // Names deliberately run the OPPOSITE way from progress, so a comparator that used the name as
    // anything more than a tie-break would sort this list backwards.
    const spare = world.systems.filter((s) => s.id !== dev.id).slice(0, 4);
    const [sysHigh, sysMid, sysLowA, sysLowB] = spare;
    if (!sysHigh || !sysMid || !sysLowA || !sysLowB) throw new Error("fixture: expected four more systems");
    for (const s of spare) { s.factionId = factionId; s.control = "controlled"; }
    sysHigh.name = "Zulu"; sysMid.name = "Mike"; sysLowA.name = "Bravo"; sysLowB.name = "Alpha";

    setWorld({
      ...world,
      constructionProjects: [
        { kind: "colony_establish", id: "high", origin: "auto", factionId, systemId: sysHigh.id, sourceSystemId: dev.id, seedPop: 2, housingLevels: 1, workTotal: 100, workDone: 90, stagedManifest: [], charterPaid: true, stalledCycles: 0 },
        { kind: "colony_establish", id: "mid", origin: "auto", factionId, systemId: sysMid.id, sourceSystemId: dev.id, seedPop: 2, housingLevels: 1, workTotal: 100, workDone: 50, stagedManifest: [], charterPaid: true, stalledCycles: 0 },
        // A genuine tie at the bottom, where the name tie-break DOES apply.
        { kind: "colony_establish", id: "lowA", origin: "auto", factionId, systemId: sysLowA.id, sourceSystemId: dev.id, seedPop: 2, housingLevels: 1, workTotal: 100, workDone: 10, stagedManifest: [], charterPaid: true, stalledCycles: 0 },
        { kind: "colony_establish", id: "lowB", origin: "auto", factionId, systemId: sysLowB.id, sourceSystemId: dev.id, seedPop: 2, housingLevels: 1, workTotal: 100, workDone: 10, stagedManifest: [], charterPaid: true, stalledCycles: 0 },
      ],
    });

    const data = getFactionConstruction(factionId);
    // Progress-descending, with the tied pair ("Alpha", "Bravo") ordered by name.
    expect(data.colonies.map((c) => c.systemId)).toEqual([sysHigh.id, sysMid.id, sysLowB.id, sysLowA.id]);
  });

  it("throws ServiceError(404) naming the id for an unknown faction", () => {
    expect(() => getFactionConstruction("nope")).toThrow(ServiceError);
    try {
      getFactionConstruction("nope");
    } catch (err) {
      if (!(err instanceof ServiceError)) throw err;
      expect(err.status).toBe(404);
      expect(err.message).toContain("nope");
    }
  });
  it("splits the pool into base and centre components via the buildingsBySystem join", () => {
    // Seed the developed system with a Construction Centre + the school that staffs it, replacing
    // any world-gen entries of the same (system, type) pair so the fixture is deterministic.
    const withoutTarget = world.buildings.filter(
      (b) => !(b.systemId === dev.id && (b.buildingType === CONSTRUCTION_CENTRE_TYPE || b.buildingType === VOCATIONAL_SCHOOL_TYPE)),
    );
    setWorld({
      ...world,
      buildings: [
        ...withoutTarget,
        { systemId: dev.id, buildingType: CONSTRUCTION_CENTRE_TYPE, count: 1, idleCycles: 0 },
        { systemId: dev.id, buildingType: VOCATIONAL_SCHOOL_TYPE, count: 1, idleCycles: 0 },
      ],
    });

    const data = getFactionConstruction(factionId);
    expect(data.poolCentres).toBeGreaterThan(0);
    expect(data.poolBase + data.poolCentres).toBeCloseTo(data.pool, 6);
  });
});

describe("getFactionConstruction — command summary", () => {
  beforeEach(() => { setWorld(seatWorld()); });

  it("summarises the queue as link lists and surfaces the player's switches", () => {
    const w = getWorld();
    const pid = w.player!.controlledFactionId;
    const home = w.factions.find((f) => f.id === pid)!.homeworldId;
    orderBuild({ systemId: home, buildingType: HOUSING_TYPE, levels: 1 });
    const data = getFactionConstruction(pid);
    expect(data.automation).toEqual({ build: true, colonisation: true });
    expect(data.buildSystems.some((s) => s.systemId === home && s.count >= 1)).toBe(true);
    expect(data.orderedCount).toBeGreaterThanOrEqual(1);
    // An AI faction reports no switches.
    const ai = w.factions.find((f) => f.id !== pid)!;
    expect(getFactionConstruction(ai.id).automation).toBeNull();
  });
});

describe("getSystemConstruction", () => {
  it("shows the build on a developed system", () => {
    const data = getSystemConstruction(dev.id);
    expect(data.visibility).toBe("visible");
    if (data.visibility !== "visible") throw new Error("expected visible");
    expect(data.projects[0].kind).toBe("build");
  });
  it("shows the colony on a controlled system that is establishing", () => {
    const data = getSystemConstruction(ctrlWithColony.id);
    expect(data.visibility).toBe("visible");
  });
  it("is empty (not hidden) on a controlled system with nothing under way", () => {
    expect(getSystemConstruction(ctrlEmpty.id)).toEqual({ visibility: "empty", control: "controlled", factionId });
  });
  it("hides on a developed system with nothing building", () => {
    world.constructionProjects = [];
    setWorld(world);
    expect(getSystemConstruction(dev.id)).toEqual({ visibility: "hidden" });
  });
  it("hides on an unclaimed system with no faction", () => {
    const unclaimed = world.systems.find((s) => s.factionId === null);
    if (!unclaimed) throw new Error("fixture: expected an unclaimed system in the generated world");
    expect(getSystemConstruction(unclaimed.id)).toEqual({ visibility: "hidden" });
  });
  it("reads a stalled colony's reason from the faction's purse and its source's shelves", () => {
    // `stalledCycles` records only THAT a cycle bought nothing, never why: the reason is derived at
    // read time from the working balance and what the source can actually spare, so this is the
    // service's marshalling under test as much as the derivation's.
    const stalled = world.constructionProjects.map((p) =>
      p.kind === "colony_establish" ? { ...p, stalledCycles: 3 } : p,
    );
    const sourceStock = (stock: number) =>
      world.markets.map((m) => (m.systemId === dev.id ? { ...m, stock } : m));
    const purse = (balance: number) =>
      world.treasuries.map((t) =>
        t.factionId === factionId ? { ...t, balance, pendingFounding: 0 } : t,
      );
    const colonyRow = (systemId: string) => {
      const data = getSystemConstruction(systemId);
      if (data.visibility !== "visible") throw new Error("expected visible");
      const row = data.projects[0];
      if (row.kind !== "colony_establish") throw new Error("expected a colony row");
      return row;
    };

    // Full shelves, empty purse: the goods are there and the faction cannot buy them.
    setWorld({
      ...world, constructionProjects: stalled, markets: sourceStock(100_000), treasuries: purse(0),
    });
    const broke = colonyRow(ctrlWithColony.id);
    expect(broke.stalledReason).toBe("awaiting_funds");
    expect(broke.etaCycles).toBeNull();

    // Bare shelves, full purse: money buys nothing that is not there.
    setWorld({
      ...world, constructionProjects: stalled, markets: sourceStock(0), treasuries: purse(10_000_000),
    });
    expect(colonyRow(ctrlWithColony.id).stalledReason).toBe("awaiting_materials");

    // Stock the export rule will not release is not supply: a trickle far under the founder's own
    // donor floor stays where it is, so the colony reads exactly as it does against bare shelves.
    // Read as raw stock it would look like a fully-provisioned founder and a solvent faction.
    setWorld({
      ...world, constructionProjects: stalled, markets: sourceStock(1), treasuries: purse(10_000_000),
    });
    expect(colonyRow(ctrlWithColony.id).stalledReason).toBe("awaiting_materials");

    // …and it is the colony's OWN source that is read. Filling every OTHER system's shelves while
    // the named source stays bare changes nothing.
    setWorld({
      ...world,
      constructionProjects: stalled,
      markets: world.markets.map((m) => (m.systemId === dev.id ? { ...m, stock: 0 } : { ...m, stock: 100_000 })),
      treasuries: purse(10_000_000),
    });
    expect(colonyRow(ctrlWithColony.id).stalledReason).toBe("awaiting_materials");
  });

  it("resolves the founding treasury by factionId, not by array position", () => {
    // The faction's own treasury happens to sit at index 0 of the generated treasuries array for
    // this fixture's seed, which would mask a lookup that just grabbed the first treasury — so force
    // a DIFFERENT (naturally broke) faction's treasury to index 0 and put the faction's own (funded)
    // treasury elsewhere.
    const otherFactionId = world.factions.find((f) => f.id !== factionId)!.id;
    const stalled = world.constructionProjects.map((p) =>
      p.kind === "colony_establish" ? { ...p, stalledCycles: 3 } : p,
    );
    setWorld({
      ...world,
      constructionProjects: stalled,
      markets: world.markets.map((m) => (m.systemId === dev.id ? { ...m, stock: 100_000 } : m)),
      treasuries: [
        ...world.treasuries.filter((t) => t.factionId === otherFactionId),
        ...world.treasuries
          .filter((t) => t.factionId !== otherFactionId)
          .map((t) => (t.factionId === factionId ? { ...t, balance: 10_000_000, pendingFounding: 0 } : t)),
      ],
    });
    const data = getSystemConstruction(ctrlWithColony.id);
    if (data.visibility !== "visible") throw new Error("expected visible");
    const row = data.projects[0];
    if (row.kind !== "colony_establish") throw new Error("expected a colony row");
    // The faction's OWN treasury is amply funded; the decoy at index 0 is not — a lookup that fell
    // back to array position would read this as starved on funds.
    expect(row.stalledReason).not.toBe("awaiting_funds");
  });

  it("reads a working balance of 0 without crashing when the faction has no treasury row at all", () => {
    const stalled = world.constructionProjects.map((p) =>
      p.kind === "colony_establish" ? { ...p, stalledCycles: 3 } : p,
    );
    setWorld({
      ...world,
      constructionProjects: stalled,
      markets: world.markets.map((m) => (m.systemId === dev.id ? { ...m, stock: 100_000 } : m)),
      treasuries: world.treasuries.filter((t) => t.factionId !== factionId),
    });
    let data: ReturnType<typeof getSystemConstruction> | undefined;
    expect(() => { data = getSystemConstruction(ctrlWithColony.id); }).not.toThrow();
    if (!data || data.visibility !== "visible") throw new Error("expected visible");
    const row = data.projects[0];
    if (row.kind !== "colony_establish") throw new Error("expected a colony row");
    // No treasury row → a working balance of 0 → ample materials but no money to buy them.
    expect(row.stalledReason).toBe("awaiting_funds");
  });

  it("reads the colony's OWN named source's population, not just whichever system is first in the array", () => {
    // `dev` happens to sit at index 0 of the generated systems array for this fixture's seed, which
    // would silently mask a lookup that just grabbed the first system instead of matching by id — so
    // force a decoy to index 0 and put `dev` (the real source) somewhere else entirely. The market
    // ROWS the sparable-stock computation reads are looked up by the correct source id regardless of
    // which system object resolves, so the divergence has to be driven through `population` (which
    // DOES come from the resolved system object, and drives local demand competing for the same
    // stock) — a small `seedPop` (unlike the 340 in the shared beforeEach fixture) is what makes the
    // colony's want small enough for local demand at the WRONG system to actually move the outcome.
    const decoy = world.systems.find((s) => s.id !== dev.id)!;
    const reordered = [decoy, ...world.systems.filter((s) => s.id !== decoy.id)];
    const colony = {
      kind: "colony_establish" as const, id: "c-small", origin: "auto" as const, factionId,
      systemId: ctrlWithColony.id, sourceSystemId: dev.id, seedPop: 2, housingLevels: 1,
      workTotal: 100, workDone: 62, stagedManifest: [], charterPaid: true, stalledCycles: 3,
    };
    const reading = (decoyPopulation: number) => {
      setWorld({
        ...world,
        systems: reordered.map((s) => (s.id === decoy.id ? { ...s, population: decoyPopulation } : s)),
        constructionProjects: [colony],
        // Amply solvent — the money gate must not bind, so any divergence is driven by supply.
        treasuries: world.treasuries.map((t) =>
          t.factionId === factionId ? { ...t, balance: 10_000_000, pendingFounding: 0 } : t,
        ),
      });
      const data = getSystemConstruction(ctrlWithColony.id);
      if (data.visibility !== "visible") throw new Error("expected visible");
      const row = data.projects[0];
      if (row.kind !== "colony_establish") throw new Error("expected a colony row");
      return row.stalledReason;
    };
    // If the source resolves correctly to `dev`, the DECOY's population (a system that is never
    // actually read) must not move the reading at all.
    expect(reading(0)).toBe(reading(9_000_000));
  });

  it("reads a colony whose seed source has gone as still building, not as a crash", () => {
    // A source can leave the read set between cycles. It lists no goods, so there is nothing left to
    // want and nothing to wait on: the colony finishes on work alone with what its ledger already
    // holds. Reaching into the missing row instead would take the whole page down.
    const orphaned = world.constructionProjects.map((p) =>
      p.kind === "colony_establish"
        ? { ...p, sourceSystemId: "no-such-system", stalledCycles: 3 }
        : p,
    );
    setWorld({
      ...world,
      constructionProjects: orphaned,
      treasuries: world.treasuries.map((t) =>
        t.factionId === factionId ? { ...t, balance: 10_000_000, pendingFounding: 0 } : t,
      ),
    });
    const data = getSystemConstruction(ctrlWithColony.id);
    if (data.visibility !== "visible") throw new Error("expected visible");
    const row = data.projects[0];
    if (row.kind !== "colony_establish") throw new Error("expected a colony row");
    expect(row.stalledReason).toBeNull();
    expect(row.sourceSystemName).toBe("no-such-system"); // no name to resolve — the id stands in
    expect(row.stagedFraction).toBe(0);
    expect(row.etaCycles).not.toBeNull();                // and it still builds
    expect(row.nextCycleGain).toBeGreaterThan(0);
  });

  it("reads the source's real buildings and yields into what it can spare — a barren source is not a rich one", () => {
    // The supply derivation feeds the source's buildings and yield columns into `production`, which
    // `surplusDrawable` branches on. A reading that stops consulting either prices a barren source
    // exactly like a rich one — the readout↔tick drift this service exists to prevent. Differential
    // on purpose: no reserve constant is pinned, only "a richer source reads differently from a
    // barren one", so economy tuning cannot break it.
    const stalled = world.constructionProjects.map((p) =>
      p.kind === "colony_establish" ? { ...p, stalledCycles: 3 } : p,
    );
    const reading = (over: Partial<World>) => {
      setWorld({
        ...world,
        constructionProjects: stalled,
        // Stock held between the exporter reserve and the donor margin, so which branch
        // `surplusDrawable` takes — a production question — decides what is drawable.
        markets: world.markets.map((m) => (m.systemId === dev.id ? { ...m, stock: 200 } : m)),
        treasuries: world.treasuries.map((t) =>
          t.factionId === factionId ? { ...t, balance: 0, pendingFounding: 0 } : t,
        ),
        ...over,
      });
      const data = getSystemConstruction(ctrlWithColony.id);
      if (data.visibility !== "visible") throw new Error("expected visible");
      const row = data.projects[0];
      if (row.kind !== "colony_establish") throw new Error("expected a colony row");
      return [row.stalledReason, row.nextCycleGain, row.etaCycles];
    };

    const rich = reading({});
    const noYields = reading({
      systems: world.systems.map((s) =>
        s.id === dev.id
          ? { ...s, yieldGas: 0, yieldMinerals: 0, yieldOre: 0, yieldBiomass: 0,
              yieldArable: 0, yieldWater: 0, yieldRadioactive: 0 }
          : s,
      ),
    });
    const noBuildings = reading({ buildings: world.buildings.filter((b) => b.systemId !== dev.id) });

    expect(noYields).not.toEqual(rich);
    expect(noBuildings).not.toEqual(rich);
  });

  it("throws ServiceError(404) naming the id for an unknown system", () => {
    expect(() => getSystemConstruction("nope")).toThrow(ServiceError);
    try {
      getSystemConstruction("nope");
    } catch (err) {
      if (!(err instanceof ServiceError)) throw err;
      expect(err.status).toBe(404);
      expect(err.message).toContain("nope");
    }
  });
});
