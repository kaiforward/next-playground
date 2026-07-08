import { describe, it, expect } from "vitest";
import { generateWorld } from "../gen";
import { serializeWorld, deserializeWorld, sanitizeSaveName } from "../save";

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
});
