import { describe, it, expect } from "vitest";
import { generateWorld } from "../gen";
import { serializeWorld, deserializeWorld } from "../save";

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
    const json = JSON.stringify({ formatVersion: 1, world: { systems: [] } });
    const result = deserializeWorld(json);
    expect(result.ok).toBe(false);
  });

  it("rejects a save with an unsupported formatVersion", () => {
    const json = JSON.stringify({ formatVersion: 2, world });
    const result = deserializeWorld(json);
    expect(result.ok).toBe(false);
  });
});
