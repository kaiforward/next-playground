import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { generateWorld } from "@/lib/world/gen";
import { setWorld, clearWorld } from "@/lib/world/store";
import { getOwnershipBySystem } from "@/lib/services/ownership-map";
import type { World } from "@/lib/world/types";

let world: World;

beforeEach(() => {
  world = generateWorld({ systemCount: 60, seed: 15 });
  setWorld(world);
});

afterEach(() => {
  clearWorld();
});

describe("getOwnershipBySystem", () => {
  it("returns per-system factionId + developed (control === 'developed') for every system", () => {
    const entries = getOwnershipBySystem();
    expect(entries).toHaveLength(world.systems.length);

    const byId = new Map(entries.map((e) => [e.systemId, e] as const));
    for (const s of world.systems) {
      const e = byId.get(s.id);
      expect(e).toBeDefined();
      expect(e?.factionId).toBe(s.factionId);
      expect(e?.developed).toBe(s.control === "developed");
    }
  });

  it("flags forming on exactly the systems holding an open colony-establish project", () => {
    const target = world.systems.find((s) => s.control === "controlled") ?? world.systems[0];
    const other = world.systems.find((s) => s.id !== target.id)!;
    setWorld({
      ...world,
      constructionProjects: [
        {
          kind: "colony_establish", id: "e1", origin: "auto", factionId: "f1",
          systemId: target.id, sourceSystemId: other.id, seedPop: 2, housingLevels: 1,
          workTotal: 100, workDone: 0, stagedManifest: [], charterPaid: false, stalledCycles: 0,
        },
        // A plain build at another system must not read as a forming colony.
        {
          kind: "build", id: "b1", origin: "auto", factionId: "f1",
          systemId: other.id, buildingType: "housing", levels: 1, workTotal: 10, workDone: 0,
        },
      ],
    });

    const byId = new Map(getOwnershipBySystem().map((e) => [e.systemId, e] as const));
    expect(byId.get(target.id)?.forming).toBe(true);
    expect(byId.get(other.id)?.forming).toBe(false);
    for (const [id, e] of byId) {
      if (id !== target.id) expect(e.forming).toBe(false);
    }
  });

  it("marks exactly the faction homeworlds as developed at world-gen", () => {
    const entries = getOwnershipBySystem();
    const developed = entries.filter((e) => e.developed);
    expect(developed.length).toBe(world.factions.length);

    const homeworldIds = new Set(world.factions.map((f) => f.homeworldId));
    for (const e of developed) {
      expect(homeworldIds.has(e.systemId)).toBe(true);
    }
  });
});
