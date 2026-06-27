import { describe, it, expect } from "vitest";
import { MemoryDirectedBuildWorld } from "@/lib/tick/adapters/memory/directed-build";
import type { SystemBuildRow } from "@/lib/tick/world/directed-build-world";
import { emptyResourceVector } from "@/lib/engine/resources";

function row(systemId: string, factionId: string | null): SystemBuildRow {
  return {
    systemId, factionId, population: 100, unrest: 0, buildings: {},
    yields: emptyResourceVector(), slotCap: emptyResourceVector(),
    generalSpace: 0, habitableSpace: 0, markets: [],
  };
}

describe("MemoryDirectedBuildWorld", () => {
  it("returns the distinct faction shard keys", async () => {
    const w = new MemoryDirectedBuildWorld([row("A", "f1"), row("B", "f1"), row("C", null)]);
    const keys = await w.getFactionShardKeys();
    expect(new Set(keys)).toEqual(new Set(["f1", null]));
  });

  it("filters systems by the requested faction keys", async () => {
    const w = new MemoryDirectedBuildWorld([row("A", "f1"), row("C", null)]);
    const got = await w.getSystemsForFactions(["f1"]);
    expect(got.map((s) => s.systemId)).toEqual(["A"]);
  });

  it("captures building-count writes", async () => {
    const w = new MemoryDirectedBuildWorld([row("A", "f1")]);
    await w.applyBuildingIncreases([{ systemId: "A", buildingType: "food", count: 3.5 }]);
    expect(w.buildingUpdates).toEqual([{ systemId: "A", buildingType: "food", count: 3.5 }]);
  });
});
