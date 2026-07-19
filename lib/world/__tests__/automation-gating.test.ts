import { describe, it, expect } from "vitest";
import { generateWorld } from "@/lib/world/gen";
import { runWorldTick } from "@/lib/world/tick";
import type { World } from "@/lib/world/types";

const TICKS = 400;

/** Drives the real tick (the same body the live loop runs) so the gating check covers the
 *  world→processor threading seam, not just the processor's own unit tests. */
async function run(automation: { build: boolean; colonisation: boolean }): Promise<World> {
  let world = generateWorld({
    systemCount: 60,
    seed: 42,
    playerFaction: { name: "Gating Seat", governmentType: "federation", doctrine: "mercantile" },
  });
  if (world.player) world.player.automation = automation;
  for (let t = 0; t < TICKS; t++) {
    const result = await runWorldTick(world);
    world = result.world;
  }
  return world;
}

describe("player automation gating through the live tick", () => {
  it("automation on (control): the planner proposes projects for the player faction", async () => {
    const world = await run({ build: true, colonisation: true });
    const pid = world.player?.controlledFactionId;
    expect(
      world.constructionProjects.filter((p) => p.factionId === pid && p.origin === "auto").length,
    ).toBeGreaterThan(0);
  });

  it("automation off: zero auto projects for the player faction; AI factions unaffected", async () => {
    const world = await run({ build: false, colonisation: false });
    const pid = world.player?.controlledFactionId;
    expect(
      world.constructionProjects.filter((p) => p.factionId === pid && p.origin === "auto"),
    ).toEqual([]);
    expect(
      world.constructionProjects.filter((p) => p.factionId !== pid).length,
    ).toBeGreaterThan(0);
  });
});
