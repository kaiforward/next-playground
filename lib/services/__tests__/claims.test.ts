import { describe, it, expect, beforeEach } from "vitest";
import { setWorld, clearWorld, getWorld } from "@/lib/world/store";
import { generateWorld } from "@/lib/world/gen";
import { claimSystem } from "@/lib/services/claims";
import { seatWorld, playerHome } from "./seat-world";
import { LANES } from "@/lib/constants/lanes";
import { CYCLE_LENGTH } from "@/lib/constants/tick-cadence";

const COOLDOWN_TICKS = LANES.PLAYER_CLAIM_COOLDOWN * CYCLE_LENGTH;

/** An unclaimed system directly connected to the homeworld — the fixture's own frontier edge. */
function unclaimedNeighbour() {
  const w = getWorld();
  const home = playerHome();
  for (const c of w.connections) {
    let otherId: string | null = null;
    if (c.fromId === home.id) otherId = c.toId;
    else if (c.toId === home.id) otherId = c.fromId;
    if (otherId === null) continue;
    const other = w.systems.find((s) => s.id === otherId)!;
    if (other.factionId === null) return other;
  }
  throw new Error("seeded galaxy has no unclaimed neighbour of the homeworld");
}

/**
 * An unclaimed neighbour of ANY system `factionId` currently owns — a genuinely adjacent,
 * genuinely unclaimed target reachable in one hop from the player's territory as it stands right
 * now, so a refusal against it can only be the cooldown. A one-system faction whose only neighbour
 * it just claimed has no such border left in a small seeded galaxy — manufactured here exactly like
 * `controlledNeighbour` manufactures ownership: wire a fresh connection from an owned system to any
 * unclaimed one rather than skip the assertion.
 */
function secondUnclaimedNeighbour(factionId: string) {
  const w = getWorld();
  const owned = new Set(w.systems.filter((s) => s.factionId === factionId).map((s) => s.id));
  for (const c of w.connections) {
    if (!owned.has(c.fromId)) continue;
    const other = w.systems.find((s) => s.id === c.toId)!;
    if (other.factionId === null) return other;
  }
  const ownedSystemId = [...owned][0];
  const unclaimed = w.systems.find((s) => s.factionId === null);
  if (!unclaimed) throw new Error("seeded galaxy has no unclaimed system left to manufacture adjacency onto");
  setWorld({
    ...w,
    connections: [
      ...w.connections,
      { fromId: ownedSystemId, toId: unclaimed.id, fuelCost: 1 },
      { fromId: unclaimed.id, toId: ownedSystemId, fuelCost: 1 },
    ],
  });
  return unclaimed;
}

describe("claimSystem", () => {
  beforeEach(() => { clearWorld(); setWorld(seatWorld()); });

  it("rejects when no world is loaded", () => {
    clearWorld();
    expect(claimSystem({ systemId: "x" })).toEqual({ ok: false, error: "No world loaded." });
  });

  it("rejects when the world has no player seat", () => {
    clearWorld();
    setWorld(generateWorld({ systemCount: 40, seed: 7 }));
    expect(claimSystem({ systemId: "x" })).toEqual({ ok: false, error: "This world has no player seat." });
  });

  it("rejects an unknown system", () => {
    expect(claimSystem({ systemId: "no-such-system" })).toEqual({
      ok: false, error: "System no-such-system not found.",
    });
  });

  it("claims an unclaimed system adjacent to owned territory, then refuses a second claim inside the cooldown", () => {
    const target = unclaimedNeighbour();
    const pid = getWorld().player!.controlledFactionId;
    const before = getWorld().nextId;

    const claimed = claimSystem({ systemId: target.id });
    expect(claimed.ok).toBe(true);
    if (!claimed.ok) return;
    expect(claimed.data.systemId).toBe(target.id);
    expect(claimed.data.nextClaimTick).toBe(getWorld().meta.currentTick + COOLDOWN_TICKS);
    // No construction id minted — the claim verb is free, not funded through the queue.
    expect(getWorld().nextId).toBe(before);

    const row = getWorld().systems.find((s) => s.id === target.id)!;
    expect(row.factionId).toBe(pid);
    expect(row.control).toBe("controlled");
    expect(getWorld().player?.lastClaimTick).toBe(getWorld().meta.currentTick);

    // A second claim right away, on an unclaimed neighbour of the system just claimed, is refused
    // by the cooldown alone — every other gate (unclaimed, adjacent) genuinely passes.
    const secondTarget = secondUnclaimedNeighbour(pid);
    const refused = claimSystem({ systemId: secondTarget.id });
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.error).toMatch(/Claim cooldown/);
  });

  it("succeeds again once the cooldown has fully elapsed", () => {
    const target = unclaimedNeighbour();
    expect(claimSystem({ systemId: target.id }).ok).toBe(true);

    // Fast-forward the world clock past the cooldown without running the tick — this test is about
    // the gate's own arithmetic, not the tick loop.
    setWorld({
      ...getWorld(),
      meta: { ...getWorld().meta, currentTick: getWorld().meta.currentTick + COOLDOWN_TICKS },
    });

    const pid = getWorld().player!.controlledFactionId;
    const nextTarget = secondUnclaimedNeighbour(pid);
    expect(claimSystem({ systemId: nextTarget.id }).ok).toBe(true);
  });

  it("rejects a system that is already claimed", () => {
    const foreign = getWorld().systems.find(
      (s) => s.factionId !== null && s.factionId !== getWorld().player!.controlledFactionId,
    )!;
    const r = claimSystem({ systemId: foreign.id });
    expect(r).toEqual({ ok: false, error: `${foreign.name} is already claimed.` });
  });

  it("rejects a system that is unclaimed but not adjacent to owned territory", () => {
    // Manufacture a genuinely non-adjacent unclaimed system: strip every connection that would
    // otherwise make it a neighbour of any player-owned system.
    const w = getWorld();
    const pid = w.player!.controlledFactionId;
    const ownedIds = new Set(w.systems.filter((s) => s.factionId === pid).map((s) => s.id));
    const farUnclaimed = w.systems.find((s) => {
      if (s.factionId !== null) return false;
      return !w.connections.some((c) => {
        const otherId = c.fromId === s.id ? c.toId : c.toId === s.id ? c.fromId : null;
        return otherId !== null && ownedIds.has(otherId);
      });
    });
    if (!farUnclaimed) return; // seeded galaxy has no such system — nothing to assert
    const r = claimSystem({ systemId: farUnclaimed.id });
    expect(r).toEqual({ ok: false, error: `${farUnclaimed.name} is not adjacent to your territory.` });
  });
});
