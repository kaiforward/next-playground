import { describe, it, expect, beforeEach } from "vitest";
import { setWorld, clearWorld } from "@/lib/world/store";
import { generateWorld } from "@/lib/world/gen";
import { getWorld } from "@/lib/world/store";
import { orderBuild, orderColony, cancelOrder, setAutomation } from "@/lib/services/construction-orders";
import { HOUSING_TYPE } from "@/lib/constants/industry";
import type { WorldBuildProject } from "@/lib/world/types";

/** A small authored world: the player faction owns a developed homeworld. */
function seatWorld() {
  return generateWorld({
    systemCount: 60, seed: 42,
    playerFaction: { name: "Test Seat", governmentType: "federation", doctrine: "mercantile" },
  });
}
const home = () => {
  const w = getWorld();
  const f = w.factions.find((x) => x.id === w.player?.controlledFactionId)!;
  return w.systems.find((s) => s.id === f.homeworldId)!;
};

describe("construction order services", () => {
  beforeEach(() => { clearWorld(); setWorld(seatWorld()); });

  it("orders housing at the player's homeworld and batches a second order into the same row", () => {
    const first = orderBuild({ systemId: home().id, buildingType: HOUSING_TYPE, levels: 1 });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = orderBuild({ systemId: home().id, buildingType: HOUSING_TYPE, levels: 1 });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.data.projectId).toBe(first.data.projectId);
    expect(second.data.levels).toBe(2);
    const row = getWorld().constructionProjects.find((p) => p.id === first.data.projectId)!;
    expect(row.origin).toBe("player");
    expect(row.kind === "build" && row.levels).toBe(2);
  });

  it("hard-rejects a build beyond the physical ceiling", () => {
    // The generated homeworld has hundreds of habitable-space units of headroom, so a request
    // has to be well beyond the schema's own 100-level cap to hit the service's physical ceiling.
    const r = orderBuild({ systemId: home().id, buildingType: HOUSING_TYPE, levels: 100_000 });
    expect(r.ok).toBe(false);
  });

  it("rejects a build with no free deposit slots, with the exact reason string", () => {
    // Force the ore deposit exhausted regardless of what world-gen rolled here (mirrors the
    // manufactured-eligibility idiom the colony test below uses): zero the homeworld's ore slots,
    // then ask for one more ore extractor level.
    const h = home();
    h.slotOre = 0;
    const r = orderBuild({ systemId: h.id, buildingType: "ore", levels: 1 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe("No free deposit slots for that building here.");
  });

  it("rejects builds at systems the player does not control", () => {
    const w = getWorld();
    const foreign = w.systems.find(
      (s) => s.control === "developed" && s.factionId !== w.player?.controlledFactionId,
    )!;
    const r = orderBuild({ systemId: foreign.id, buildingType: HOUSING_TYPE, levels: 1 });
    expect(r.ok).toBe(false);
  });

  it("cancels only player-originated projects", () => {
    const placed = orderBuild({ systemId: home().id, buildingType: HOUSING_TYPE, levels: 1 });
    if (!placed.ok) throw new Error("setup failed");

    // Seed an auto-originated row for the same faction directly into the world — cancelOrder must
    // refuse it (origin !== "player") and leave it in place, not just refuse a made-up id.
    const w = getWorld();
    if (!w.player) throw new Error("fixture: expected a player seat");
    const autoProject: WorldBuildProject = {
      kind: "build", id: "auto-1", origin: "auto", factionId: w.player.controlledFactionId,
      systemId: home().id, buildingType: HOUSING_TYPE, levels: 1, workTotal: 10, workDone: 0,
    };
    setWorld({ ...w, constructionProjects: [...w.constructionProjects, autoProject] });
    expect(cancelOrder({ projectId: "auto-1" }).ok).toBe(false);
    expect(getWorld().constructionProjects.some((p) => p.id === "auto-1")).toBe(true);

    expect(cancelOrder({ projectId: placed.data.projectId }).ok).toBe(true);
    expect(getWorld().constructionProjects.some((p) => p.id === placed.data.projectId)).toBe(false);
    expect(cancelOrder({ projectId: "no-such-project" }).ok).toBe(false);
  });

  it("orders a colony at an eligible controlled system and rejects an ineligible one", () => {
    // Deterministically manufacture eligibility: take a controlled player system if the seed
    // produced one, else claim an unclaimed neighbour of the homeworld as controlled.
    const w = getWorld();
    const pid = w.player!.controlledFactionId;
    let target = w.systems.find((s) => s.factionId === pid && s.control === "controlled");
    if (!target) {
      const conn = w.connections.find((c) => c.fromId === home().id || c.toId === home().id)!;
      const otherId = conn.fromId === home().id ? conn.toId : conn.fromId;
      target = w.systems.find((s) => s.id === otherId)!;
      target.factionId = pid;
      target.control = "controlled";
    }
    const r = orderColony({ systemId: target.id });
    if (target.habitableSpace >= 1) {
      expect(r.ok).toBe(true);
      const row = getWorld().constructionProjects.find((p) => p.kind === "colony_establish" && p.systemId === target.id)!;
      expect(row.origin).toBe("player");
      // A second order on the same system is "already forming".
      expect(orderColony({ systemId: target.id }).ok).toBe(false);
    } else {
      expect(r.ok).toBe(false); // below the habitable floor is a legitimate reject
    }
    // The developed homeworld is never colony-eligible.
    expect(orderColony({ systemId: home().id }).ok).toBe(false);
  });

  it("sets and reports automation on the player seat", () => {
    const r = setAutomation({ build: false, colonisation: true });
    expect(r.ok).toBe(true);
    expect(getWorld().player?.automation).toEqual({ build: false, colonisation: true });
  });
});
