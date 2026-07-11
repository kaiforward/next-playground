import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { generateWorld } from "@/lib/world/gen";
import { setWorld, clearWorld } from "@/lib/world/store";
import { getFactionConstruction, getSystemConstruction } from "@/lib/services/construction";
import { ServiceError } from "@/lib/services/errors";
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
    { kind: "build", id: "b1", factionId, systemId: dev.id, buildingType: "housing", levels: 4, workTotal: 40, workDone: 32 },
    { kind: "colony_establish", id: "c1", factionId, systemId: ctrlWithColony.id, sourceSystemId: dev.id, seedPop: 340, housingLevels: 3, workTotal: 100, workDone: 62 },
  ];
  setWorld(world);
});

afterEach(() => { clearWorld(); });

describe("getFactionConstruction", () => {
  it("groups expansion and build-out with a positive pool", () => {
    const data = getFactionConstruction(factionId);
    expect(data.pool).toBeGreaterThan(0);
    expect(data.expandCount).toBe(1);
    expect(data.buildCount).toBe(1);
    expect(data.expansion[0].kind).toBe("colony_establish");
    expect(data.buildOut[0].buildingLabel).toBe("Housing");
  });
  it("throws ServiceError(404) for an unknown faction", () => {
    expect(() => getFactionConstruction("nope")).toThrow(ServiceError);
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
  it("throws ServiceError(404) for an unknown system", () => {
    expect(() => getSystemConstruction("nope")).toThrow(ServiceError);
  });
});
