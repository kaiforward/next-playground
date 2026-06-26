import { describe, it, expect } from "vitest";
import { resolveConstants } from "@/lib/engine/simulator/constants";
import { createSimWorld } from "@/lib/engine/simulator/world";
import { simulateWorldTick } from "@/lib/engine/simulator/economy";
import { mulberry32 } from "@/lib/engine/universe-gen";
import { buildSimAdjacencyList } from "@/lib/engine/simulator/pathfinding-cache";
import type { SimConfig, SimRunContext } from "@/lib/engine/simulator/types";
import type { GovernmentType } from "@/lib/types/game";

describe("directed-build in the simulator tick", () => {
  it("runs the full tick (incl. directed-build) with finite, non-negative building counts", async () => {
    const config: SimConfig = { tickCount: 1, bots: [], seed: 42 };
    const constants = resolveConstants();
    const rng = mulberry32(config.seed);
    let world = createSimWorld(config, constants);

    // Mirror runner.ts adjacencyList + systemToGov construction exactly.
    const adjacencyList = buildSimAdjacencyList(world.connections);
    const systemToGov: Map<string, GovernmentType> = new Map(
      world.systems.map((s) => [s.id, s.governmentType]),
    );

    const ctx: SimRunContext = {
      constants,
      disableRandomEvents: config.disableRandomEvents ?? false,
      eventInjections: config.eventInjections ?? [],
      adjacencyList,
      systemToGov,
    };

    let w = world;
    for (let i = 0; i < 12; i++) {
      w = await simulateWorldTick(w, rng, ctx);
    }

    for (const s of w.systems) {
      for (const c of Object.values(s.buildings)) {
        expect(Number.isFinite(c)).toBe(true);
        expect(c).toBeGreaterThanOrEqual(0);
      }
    }
  });
});
