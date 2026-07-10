import { describe, it, expect } from "vitest";
import { generateWorld } from "../gen";
import { serializeWorld, deserializeWorld, sanitizeSaveName, SAVE_FORMAT_VERSION } from "../save";
import type { World } from "../types";

describe("sanitizeSaveName", () => {
  it("lowercases and strips everything but [a-z0-9-_]", () => {
    expect(sanitizeSaveName("My Save! #1")).toBe("mysave1");
  });

  it("preserves hyphens and underscores (they don't collide)", () => {
    expect(sanitizeSaveName("Run-A_2")).toBe("run-a_2");
  });

  it("returns empty string for a name with no [a-z0-9-_] characters", () => {
    // The exact edge case saveGameSchema.refine() guards against — a name that
    // sanitizes to "" would otherwise collide on saves/.json.
    expect(sanitizeSaveName("???")).toBe("");
    expect(sanitizeSaveName("   ")).toBe("");
  });
});

describe("serializeWorld / deserializeWorld", () => {
  const world = generateWorld({ systemCount: 60, seed: 7 });

  it("round-trips a generated world unchanged", () => {
    const result = deserializeWorld(serializeWorld(world));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.world).toStrictEqual(world);
  });

  it("rejects malformed JSON", () => {
    const result = deserializeWorld("{ not valid json");
    expect(result.ok).toBe(false);
  });

  it("rejects a well-formed JSON object missing world.meta", () => {
    const json = JSON.stringify({ formatVersion: 2, world: { systems: [] } });
    const result = deserializeWorld(json);
    expect(result.ok).toBe(false);
  });

  it("rejects a world whose meta is missing mapSize (tile geometry depends on it)", () => {
    const { seed, systemCount, currentTick, startingSystemId } = world.meta;
    const json = JSON.stringify({
      formatVersion: 2,
      world: { ...world, meta: { seed, systemCount, currentTick, startingSystemId } },
    });
    const result = deserializeWorld(json);
    expect(result.ok).toBe(false);
  });

  it("rejects a save with an unsupported formatVersion", () => {
    const json = JSON.stringify({ formatVersion: 99, world });
    const result = deserializeWorld(json);
    expect(result.ok).toBe(false);
  });

  it("is at save format version 5 (discriminated construction projects)", () => {
    expect(SAVE_FORMAT_VERSION).toBe(5);
  });

  it("rejects a prior-version (v4) save — saves break on the shape bump", () => {
    const json = JSON.stringify({ formatVersion: 4, world });
    const result = deserializeWorld(json);
    expect(result.ok).toBe(false);
  });

  it("round-trips construction projects + building idleMonths unchanged", () => {
    const withConstruction: World = {
      ...world,
      constructionProjects: [
        {
          kind: "build",
          id: "proj-1",
          factionId: world.factions[0].id,
          systemId: world.systems[0].id,
          buildingType: "housing",
          levels: 2,
          workTotal: 30,
          workDone: 12,
        },
      ],
      buildings: world.buildings.map((b, i) => ({ ...b, idleMonths: i === 0 ? 3 : 0 })),
    };
    const result = deserializeWorld(serializeWorld(withConstruction));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.world).toStrictEqual(withConstruction);
  });

  it("round-trips a colony-establish project unchanged (serializable, no lost fields)", () => {
    const withColony: World = {
      ...world,
      constructionProjects: [
        {
          kind: "colony_establish",
          id: "establish-1",
          factionId: world.factions[0].id,
          systemId: world.systems[1].id,
          sourceSystemId: world.systems[0].id,
          seedPop: 50,
          housingLevels: 3,
          workTotal: 84,
          workDone: 40,
        },
      ],
    };
    const result = deserializeWorld(serializeWorld(withColony));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.world).toStrictEqual(withColony);
  });
});
