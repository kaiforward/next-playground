import { describe, it, expect } from "vitest";
import { MemoryDirectedBuildWorld } from "@/lib/tick/adapters/memory/directed-build";
import type { SystemBuildRow, SystemClaim, SystemDevelopment, ProposalPersistenceUpdate } from "@/lib/tick/world/directed-build-world";
import { emptyResourceVector } from "@/lib/engine/resources";

function row(systemId: string, factionId: string | null): SystemBuildRow {
  return {
    systemId, factionId, governmentType: factionId ? "federation" : "frontier", control: "unclaimed", population: 100, unrest: 0, buildings: {},
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

describe("MemoryDirectedBuildWorld: claim + develop capture", () => {
  it("captures applied claims and developments for write-back", async () => {
    const world = new MemoryDirectedBuildWorld([]);
    const claims: SystemClaim[] = [{ systemId: "s1", factionId: "f1" }];
    const devs: SystemDevelopment[] = [{ systemId: "s2", sourceSystemId: "home", seedPop: 50, housingLevels: 3, stockManifest: [] }];
    await world.applyClaims(claims);
    await world.applyDevelopments(devs);
    expect(world.claims).toEqual(claims);
    expect(world.developments).toEqual(devs);
  });
  it("starts with no claims or developments", () => {
    const world = new MemoryDirectedBuildWorld([]);
    expect(world.claims).toEqual([]);
    expect(world.developments).toEqual([]);
  });
});

describe("MemoryDirectedBuildWorld: proposal-persistence clamp", () => {
  it("clamps persisted proposal pulses to a finite [0,2] at the boundary", async () => {
    const world = new MemoryDirectedBuildWorld([]);
    const updates: ProposalPersistenceUpdate[] = [
      { id: "sysA:ore", proposalPulses: NaN }, // non-finite → 0
      { id: "sysB:ore", proposalPulses: 3 },   // above the cap → 2
      { id: "sysC:ore", proposalPulses: -1 },  // below the floor → 0
    ];
    await world.applyProposalPersistenceUpdates(updates);
    expect(world.proposalPulseUpdates.get("sysA:ore")).toBe(0);
    expect(world.proposalPulseUpdates.get("sysB:ore")).toBe(2);
    expect(world.proposalPulseUpdates.get("sysC:ore")).toBe(0);
  });
});
