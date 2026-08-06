import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { generateWorld } from "@/lib/world/gen";
import { setWorld, getWorld, clearWorld } from "@/lib/world/store";
import { getFactionConstruction, getSystemConstruction } from "@/lib/services/construction";
import { orderBuild } from "@/lib/services/construction-orders";
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
  // A player-seat world: the player faction owns a developed homeworld with automation defaults.
  function seatWorld() {
    return generateWorld({
      systemCount: 60, seed: 42,
      playerFaction: { name: "Test Seat", governmentType: "federation", doctrine: "mercantile" },
    });
  }
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
    // A founder with shelves to spare, so "no money" and "no goods" are genuinely distinguishable.
    const markets = world.markets.map((m) =>
      m.systemId === dev.id ? { ...m, stock: 100_000 } : m,
    );
    const purse = (balance: number) =>
      world.treasuries.map((t) =>
        t.factionId === factionId ? { ...t, balance, pendingFounding: 0 } : t,
      );

    setWorld({ ...world, constructionProjects: stalled, markets, treasuries: purse(0) });
    const broke = getSystemConstruction(ctrlWithColony.id);
    if (broke.visibility !== "visible") throw new Error("expected visible");
    const brokeRow = broke.projects[0];
    if (brokeRow.kind !== "colony_establish") throw new Error("expected a colony row");
    expect(brokeRow.stalledReason).toBe("awaiting_funds");
    expect(brokeRow.etaCycles).toBeNull();

    setWorld({ ...world, constructionProjects: stalled, markets, treasuries: purse(10_000_000) });
    const rich = getSystemConstruction(ctrlWithColony.id);
    if (rich.visibility !== "visible") throw new Error("expected visible");
    const richRow = rich.projects[0];
    if (richRow.kind !== "colony_establish") throw new Error("expected a colony row");
    expect(richRow.stalledReason).toBe("awaiting_materials");
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
