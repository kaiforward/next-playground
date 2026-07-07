import { describe, it, expect } from "vitest";
import { runRelationsProcessor } from "../relations";
import { InMemoryRelationsWorld } from "@/lib/tick/adapters/memory/relations";
import { ALLIANCE, RELATIONS_PHASE_SENTINEL } from "@/lib/constants/relations";
import type { TickContext } from "@/lib/tick/types";

function makeCtx(tick: number, results: TickContext["results"] = new Map()): TickContext {
  return { tick, results };
}

function makeWorld(score: number, opts: { alliance?: boolean; events?: { id: string; type: "pact_under_negotiation" | "alliance_dissolved" | "border_conflict"; expiresAtTick: number }[] } = {}) {
  return new InMemoryRelationsWorld({
    factions: [
      {
        id: "fa",
        name: "Alpha",
        governmentType: "federation",
        doctrine: "mercantile",
        territory: new Set(["s1"]),
      },
      {
        id: "fb",
        name: "Beta",
        governmentType: "federation",
        doctrine: "opportunistic",
        territory: new Set(["s2"]),
      },
    ],
    relations: [
      { factionAId: "fa", factionBId: "fb", score, history: [], updatedAtTick: 0 },
    ],
    alliances: opts.alliance
      ? [{ factionAId: "fa", factionBId: "fb", formedAtTick: 0, pendingDissolutionAtTick: null }]
      : [],
    systems: [
      { id: "s1", regionId: "r1", factionId: "fa" },
      { id: "s2", regionId: "r2", factionId: "fb" },
    ],
    connections: [{ fromSystemId: "s1", toSystemId: "s2" }],
    events: (opts.events ?? []).map((e) => ({
      id: e.id,
      type: e.type,
      phaseStartTick: 0,
      phaseDuration: RELATIONS_PHASE_SENTINEL,
      metadata: { factionAId: "fa", factionBId: "fb", expiresAtTick: e.expiresAtTick },
    })),
  });
}

describe("runRelationsProcessor", () => {
  it("drifts every pair and writes a history entry per pair", async () => {
    const world = makeWorld(0);
    await runRelationsProcessor(world, makeCtx(10), { tradeWindowTicks: 3, rng: () => 0.5 });
    const updated = await world.getFactionRelations();
    expect(updated).toHaveLength(1);
    expect(updated[0].history).toHaveLength(1);
    expect(updated[0].updatedAtTick).toBe(10);
    expect(updated[0].score).toBeLessThan(0); // baseline downward bias
  });

  it("spawns a border_conflict event when a pair crosses into the unfriendly band", async () => {
    // Score starts just inside neutral and crosses below -25 after drift.
    // Default drift = baseline (-0.05) + border friction (-0.02) = -0.07,
    // so starting at -24.95 brings newScore to -25.02 (≤ -25, prior score > -25).
    const world = makeWorld(-24.95);
    await runRelationsProcessor(world, makeCtx(5), { tradeWindowTicks: 3, rng: () => 0.5 });
    const events = await world.getActiveRelationEvents();
    const borderConflict = events.find((e) => e.type === "border_conflict");
    expect(borderConflict).toBeDefined();
    expect(borderConflict?.metadata.factionAId).toBe("fa");
    expect(borderConflict?.metadata.factionBId).toBe("fb");
  });

  it("spawns a pact_under_negotiation event when a pair crosses +75", async () => {
    // Start at +75.05 — already at threshold, ensures baseline drift doesn't matter:
    // need pair.score < threshold AND nextScore >= threshold. Use 74.99 instead.
    const world = makeWorld(74.99);
    // Boost the pair with a positive driver: add trade volume so drift is positive.
    world.tradeFlows.push({ tick: 5, fromSystemId: "s1", toSystemId: "s2", quantity: 5000 });
    world.tradeFlows.push({ tick: 5, fromSystemId: "s2", toSystemId: "s1", quantity: 5000 });
    await runRelationsProcessor(world, makeCtx(10), { tradeWindowTicks: 100, rng: () => 0.5 });
    const events = await world.getActiveRelationEvents();
    const pact = events.find((e) => e.type === "pact_under_negotiation");
    expect(pact).toBeDefined();
  });

  it("forms an alliance when a pact_under_negotiation window closes with score ≥ holdThreshold", async () => {
    const world = makeWorld(80, {
      events: [
        { id: "ev1", type: "pact_under_negotiation", expiresAtTick: 10 },
      ],
    });
    await runRelationsProcessor(world, makeCtx(10), { tradeWindowTicks: 3, rng: () => 0.5 });
    const alliances = await world.getActiveAlliances();
    expect(alliances).toHaveLength(1);
    expect(alliances[0].factionAId).toBe("fa");
    expect(alliances[0].factionBId).toBe("fb");
    const events = await world.getActiveRelationEvents();
    expect(events.find((e) => e.type === "pact_under_negotiation")).toBeUndefined();
  });

  it("does not form an alliance when score has fallen below holdThreshold", async () => {
    const world = makeWorld(ALLIANCE.holdThreshold - 5, {
      events: [
        { id: "ev1", type: "pact_under_negotiation", expiresAtTick: 10 },
      ],
    });
    await runRelationsProcessor(world, makeCtx(10), { tradeWindowTicks: 3, rng: () => 0.5 });
    const alliances = await world.getActiveAlliances();
    expect(alliances).toHaveLength(0);
  });

  it("dissolves an alliance when an alliance_dissolved event's window closes", async () => {
    const world = makeWorld(30, {
      alliance: true,
      events: [
        { id: "ev1", type: "alliance_dissolved", expiresAtTick: 10 },
      ],
    });
    await runRelationsProcessor(world, makeCtx(10), { tradeWindowTicks: 3, rng: () => 0.5 });
    const alliances = await world.getActiveAlliances();
    expect(alliances).toHaveLength(0);
  });

  it("does NOT touch border_conflict events — events processor owns their expiry", async () => {
    const world = makeWorld(-50, {
      events: [
        { id: "ev1", type: "border_conflict", expiresAtTick: 1 },
      ],
    });
    await runRelationsProcessor(world, makeCtx(100), { tradeWindowTicks: 3, rng: () => 0.5 });
    const events = await world.getActiveRelationEvents();
    expect(events.find((e) => e.type === "border_conflict")).toBeDefined();
  });

  it("does not spawn duplicate border_conflict for a pair that already has one", async () => {
    const world = makeWorld(-30, {
      events: [
        { id: "ev1", type: "border_conflict", expiresAtTick: RELATIONS_PHASE_SENTINEL },
      ],
    });
    await runRelationsProcessor(world, makeCtx(5), { tradeWindowTicks: 3, rng: () => 0.5 });
    const events = await world.getActiveRelationEvents();
    const conflicts = events.filter((e) => e.type === "border_conflict");
    expect(conflicts).toHaveLength(1);
  });

  it("spawns an alliance_dissolved event when an active alliance's score is below dissolutionThreshold", async () => {
    // Allied pair already below the dissolution threshold with no existing
    // dissolution event — the trigger fires on the first relations tick.
    const world = makeWorld(ALLIANCE.dissolutionThreshold - 2, {
      alliance: true,
    });
    await runRelationsProcessor(world, makeCtx(5), { tradeWindowTicks: 3, rng: () => 0.5 });
    const events = await world.getActiveRelationEvents();
    const dissolution = events.find((e) => e.type === "alliance_dissolved");
    expect(dissolution).toBeDefined();
    expect(dissolution?.metadata.factionAId).toBe("fa");
    expect(dissolution?.metadata.factionBId).toBe("fb");

    // Alliance is still active — the event was spawned, not resolved.
    const alliances = await world.getActiveAlliances();
    expect(alliances).toHaveLength(1);
  });

  it("does not spawn duplicate alliance_dissolved when one already exists for the pair", async () => {
    const world = makeWorld(ALLIANCE.dissolutionThreshold - 10, {
      alliance: true,
      events: [
        { id: "ev1", type: "alliance_dissolved", expiresAtTick: RELATIONS_PHASE_SENTINEL },
      ],
    });
    await runRelationsProcessor(world, makeCtx(5), { tradeWindowTicks: 3, rng: () => 0.5 });
    const events = await world.getActiveRelationEvents();
    expect(events.filter((e) => e.type === "alliance_dissolved")).toHaveLength(1);
  });

  it("threads params.rng through event templates for deterministic windows", async () => {
    // Cross into negotiation territory with rng pinned to 0 → minimum window.
    const minWorld = makeWorld(74.99);
    minWorld.tradeFlows.push({ tick: 5, fromSystemId: "s1", toSystemId: "s2", quantity: 5000 });
    minWorld.tradeFlows.push({ tick: 5, fromSystemId: "s2", toSystemId: "s1", quantity: 5000 });
    await runRelationsProcessor(minWorld, makeCtx(10), { tradeWindowTicks: 100, rng: () => 0 });
    const minEvents = await minWorld.getActiveRelationEvents();
    const minPact = minEvents.find((e) => e.type === "pact_under_negotiation");
    expect(minPact).toBeDefined();
    expect(minPact?.metadata.expiresAtTick).toBe(10 + ALLIANCE.negotiationWindow[0]);

    // Same scenario with rng pinned to 0.9999 → maximum window.
    const maxWorld = makeWorld(74.99);
    maxWorld.tradeFlows.push({ tick: 5, fromSystemId: "s1", toSystemId: "s2", quantity: 5000 });
    maxWorld.tradeFlows.push({ tick: 5, fromSystemId: "s2", toSystemId: "s1", quantity: 5000 });
    await runRelationsProcessor(maxWorld, makeCtx(10), { tradeWindowTicks: 100, rng: () => 0.9999 });
    const maxEvents = await maxWorld.getActiveRelationEvents();
    const maxPact = maxEvents.find((e) => e.type === "pact_under_negotiation");
    expect(maxPact).toBeDefined();
    expect(maxPact?.metadata.expiresAtTick).toBe(10 + ALLIANCE.negotiationWindow[1]);
  });
});
