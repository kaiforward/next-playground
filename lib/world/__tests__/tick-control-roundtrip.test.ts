import { describe, it, expect } from "vitest";
import { generateWorld } from "@/lib/world/gen";
import { runWorldTick } from "@/lib/world/tick";

describe("runWorldTick: control round-trips", () => {
  it("preserves each system's control + factionId across a tick", async () => {
    const world = generateWorld({ systemCount: 40, seed: 3 });
    const before = new Map(world.systems.map((s) => [s.id, `${s.control}:${s.factionId ?? "-"}`]));
    const next = (await runWorldTick(world)).world;
    for (const s of next.systems) {
      // Nothing claims on tick 1 (off the monthly pulse); ownership is unchanged.
      expect(`${s.control}:${s.factionId ?? "-"}`).toBe(before.get(s.id));
    }
  });
});
