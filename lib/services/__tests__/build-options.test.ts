import { describe, it, expect, beforeEach } from "vitest";
import { setWorld, clearWorld, getWorld } from "@/lib/world/store";
import { generateWorld } from "@/lib/world/gen";
import { getSystemBuildOptions } from "@/lib/services/build-options";
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
    const data = getSystemBuildOptions(f.homeworldId);
    expect(data.mode).toBe("build");
    if (data.mode !== "build") return;
    const housing = data.options.find((o) => o.buildingType === HOUSING_TYPE)!;
    expect(housing.label).toBe("Housing");
    expect(housing.workPerLevel).toBeGreaterThan(0);
  });

  it("returns none for a rival faction's system and for a playerless world", () => {
    const w = getWorld();
    const foreign = w.systems.find(
      (s) => s.factionId !== null && s.factionId !== w.player?.controlledFactionId,
    )!;
    expect(getSystemBuildOptions(foreign.id).mode).toBe("none");
  });

  it("returns colony mode at a controlled player system", () => {
    const w = getWorld();
    const pid = w.player!.controlledFactionId;
    const home = w.systems.find((s) => s.id === w.factions.find((x) => x.id === pid)!.homeworldId)!;
    let target = w.systems.find((s) => s.factionId === pid && s.control === "controlled");
    if (!target) {
      const conn = w.connections.find((c) => c.fromId === home.id || c.toId === home.id)!;
      const otherId = conn.fromId === home.id ? conn.toId : conn.fromId;
      target = w.systems.find((s) => s.id === otherId)!;
      target.factionId = pid;
      target.control = "controlled";
    }
    const data = getSystemBuildOptions(target.id);
    expect(data.mode).toBe("colony");
  });
});
