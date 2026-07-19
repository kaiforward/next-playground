import { describe, it, expect, beforeEach } from "vitest";
import { setWorld, clearWorld, getWorld } from "@/lib/world/store";
import { generateWorld } from "@/lib/world/gen";
import { getSystemBuildOptions } from "@/lib/services/build-options";
import { orderBuild } from "@/lib/services/construction-orders";
import { HOUSING_TYPE } from "@/lib/constants/industry";

function seatWorld() {
  return generateWorld({
    systemCount: 60, seed: 42,
    playerFaction: { name: "Test Seat", governmentType: "federation", doctrine: "mercantile" },
  });
}

describe("getSystemBuildOptions", () => {
  beforeEach(() => { clearWorld(); setWorld(seatWorld()); });

  it("returns build mode with labelled options at the player's developed homeworld", () => {
    const w = getWorld();
    const f = w.factions.find((x) => x.id === w.player?.controlledFactionId)!;
    const home = w.systems.find((s) => s.id === f.homeworldId)!;
    // Deterministically exhaust ore deposit slots regardless of what world-gen rolled, so there's
    // always a zero-maxLevels / null-etaPulses option to assert against.
    home.slotOre = 0;

    const data = getSystemBuildOptions(f.homeworldId);
    expect(data.mode).toBe("build");
    if (data.mode !== "build") return;

    const housing = data.options.find((o) => o.buildingType === HOUSING_TYPE)!;
    expect(housing.label).toBe("Housing");
    expect(housing.workPerLevel).toBeGreaterThan(0);
    expect(housing.maxLevels).toBeGreaterThan(0);
    expect(housing.etaPulses).not.toBeNull();
    if (housing.etaPulses === null) return;
    expect(Number.isFinite(housing.etaPulses)).toBe(true);
    expect(housing.etaPulses).toBeGreaterThanOrEqual(1);

    const ore = data.options.find((o) => o.buildingType === "ore")!;
    expect(ore.maxLevels).toBe(0);
    expect(ore.etaPulses).toBeNull();

    // Ordering housing now commits work ahead of a fresh hypothetical row for the same type — a
    // subsequent read's etaPulses for housing can only stay the same or move back, never improve.
    const placed = orderBuild({ systemId: f.homeworldId, buildingType: HOUSING_TYPE, levels: 1 });
    expect(placed.ok).toBe(true);
    const after = getSystemBuildOptions(f.homeworldId);
    if (after.mode !== "build") throw new Error("expected build mode after order");
    const afterHousing = after.options.find((o) => o.buildingType === HOUSING_TYPE)!;
    expect(afterHousing.etaPulses).not.toBeNull();
    if (afterHousing.etaPulses === null) return;
    expect(afterHousing.etaPulses).toBeGreaterThanOrEqual(housing.etaPulses);
  });

  it("returns none for a rival faction's system", () => {
    const w = getWorld();
    const foreign = w.systems.find(
      (s) => s.factionId !== null && s.factionId !== w.player?.controlledFactionId,
    )!;
    expect(getSystemBuildOptions(foreign.id).mode).toBe("none");
  });

  it("returns none for every system in a playerless world", () => {
    clearWorld();
    setWorld(generateWorld({ systemCount: 40, seed: 7 }));
    const w = getWorld();
    expect(w.player).toBeNull();
    for (const s of w.systems) {
      expect(getSystemBuildOptions(s.id).mode).toBe("none");
    }
  });

  it("returns colony mode with a deterministic eligible preview at a controlled neighbour", () => {
    // Always manufacture the eligible case from home's direct neighbour rather than trusting
    // whatever "controlled" system world-gen happened to produce — a pre-existing one could sit
    // outside the seed-source hop radius, making the eligible/ineligible branch nondeterministic.
    const w = getWorld();
    const faction = w.factions.find((x) => x.id === w.player?.controlledFactionId)!;
    const pid = faction.id;
    const home = w.systems.find((s) => s.id === faction.homeworldId)!;
    const conn = w.connections.find((c) => c.fromId === home.id || c.toId === home.id)!;
    const otherId = conn.fromId === home.id ? conn.toId : conn.fromId;
    const target = w.systems.find((s) => s.id === otherId)!;
    target.factionId = pid;
    target.control = "controlled";
    target.habitableSpace = 100; // comfortably above the habitable floor — deterministically eligible

    const data = getSystemBuildOptions(target.id);
    expect(data.mode).toBe("colony");
    if (data.mode !== "colony") return;
    expect(data.colony.state).toBe("eligible");
    if (data.colony.state !== "eligible") return;
    expect(data.colony.preview.sourceSystemId).toBe(home.id);
    expect(data.colony.preview.seedPop).toBeGreaterThan(0);
    expect(data.colony.preview.housingLevels).toBeGreaterThanOrEqual(1);
  });
});
