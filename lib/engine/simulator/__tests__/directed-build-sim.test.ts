import { describe, it, expect } from "vitest";
import { resolveConstants } from "@/lib/engine/simulator/constants";
import { createSimWorld } from "@/lib/engine/simulator/world";
import { simulateWorldTick } from "@/lib/engine/simulator/economy";
import { mulberry32 } from "@/lib/engine/universe-gen";
import { buildSimAdjacencyList } from "@/lib/engine/simulator/pathfinding-cache";
import type { SimConfig, SimRunContext } from "@/lib/engine/simulator/types";
import type { GovernmentType } from "@/lib/types/game";

describe("directed-build in the simulator tick", () => {
  // Runs 12 full sim ticks — fast in isolation (~1.3s) but can exceed the 5s
  // default under CI parallel load, so give it headroom like the other sim
  // tests (simulator-integration uses 30–60s).
  it("runs the full tick incl. directed-build, adding buildings with finite, non-negative counts", { timeout: 30_000 }, async () => {
    const config: SimConfig = { tickCount: 1, bots: [], seed: 42 };
    // directed-build's per-faction shard sweeps once per (2 × economy.interval) ticks. Shrink the
    // economy clock so the sweep completes within this short run — at the live interval (48) the
    // processor would barely fire over 12 ticks and the test could pass even if it were a no-op.
    const base = resolveConstants();
    const constants = { ...base, economy: { ...base.economy, interval: 2 } };
    const rng = mulberry32(config.seed);
    const world = createSimWorld(config, constants);

    // Snapshot seeded building counts per (system, type). directed-build is the ONLY processor
    // that *increases* a building count (economy/population/migration don't build; decay only
    // removes), so any count rising above its seed value proves directed-build actually ran.
    const seeded = new Map<string, number>();
    for (const s of world.systems) {
      for (const [type, count] of Object.entries(s.buildings)) seeded.set(`${s.id}|${type}`, count);
    }

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

    let builtSomething = false;
    for (const s of w.systems) {
      for (const [type, count] of Object.entries(s.buildings)) {
        expect(Number.isFinite(count)).toBe(true);
        expect(count).toBeGreaterThanOrEqual(0);
        if (count > (seeded.get(`${s.id}|${type}`) ?? 0) + 1e-9) builtSomething = true;
      }
    }
    // Proves the processor fired and produced builds — not just that the pipeline didn't NaN.
    expect(builtSomething).toBe(true);
  });
});
