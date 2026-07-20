import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { generateWorld } from "@/lib/world/gen";
import { setWorld, clearWorld, getWorld } from "@/lib/world/store";
import { getFactionTreasury, updateTreasuryPolicy } from "@/lib/services/treasury";
import { ServiceError } from "@/lib/services/errors";
import type { World, WorldTreasurySettlement } from "@/lib/world/types";

let world: World;

beforeEach(() => {
  world = generateWorld({
    systemCount: 60,
    seed: 13,
    playerFaction: { name: "Test Seat", governmentType: "federation", doctrine: "expansionist" },
  });
  setWorld(world);
});

afterEach(() => {
  clearWorld();
});

function playerFactionId(): string {
  const id = getWorld().player?.controlledFactionId;
  if (!id) throw new Error("test world has no player seat");
  return id;
}

const settlementFixture: WorldTreasurySettlement = {
  tick: 24,
  headsIncome: 100,
  productionIncome: 60,
  incomeBySystem: [{ systemId: "s1", heads: 100, production: 60 }],
  maintenanceBill: 90,
  maintenanceByType: [{ buildingType: "housing", amount: 90 }],
  logisticsBill: 20,
  constructionBill: 50,
  paid: { maintenance: 90, logistics: 20, construction: 30 },
};

describe("getFactionTreasury", () => {
  it("throws ServiceError(404) for an unknown factionId", () => {
    expect(() => getFactionTreasury("does-not-exist")).toThrow(ServiceError);
    try {
      getFactionTreasury("does-not-exist");
    } catch (error) {
      expect(error).toMatchObject({ status: 404 });
    }
  });

  it("returns the persisted treasury verbatim with net 0 before the first settlement", () => {
    const factionId = playerFactionId();
    const row = getWorld().treasuries.find((t) => t.factionId === factionId)!;
    const data = getFactionTreasury(factionId);
    expect(data.factionId).toBe(factionId);
    expect(data.balance).toBe(row.balance);
    expect(data.taxLevel).toBe(row.taxLevel);
    expect(data.bands).toEqual(row.bands);
    expect(data.funded).toEqual(row.funded);
    expect(data.lastSettlement).toBeNull();
    expect(data.net).toBe(0);
  });

  it("computes net as settlement income minus money paid", () => {
    const factionId = playerFactionId();
    const w = getWorld();
    setWorld({
      ...w,
      treasuries: w.treasuries.map((t) =>
        t.factionId === factionId ? { ...t, lastSettlement: settlementFixture } : t,
      ),
    });
    const data = getFactionTreasury(factionId);
    // 100 + 60 − (90 + 20 + 30)
    expect(data.net).toBe(20);
    expect(data.lastSettlement).toEqual(settlementFixture);
  });

  it("reads AI factions too (god-view; only writes are seat-gated)", () => {
    const other = getWorld().factions.find((f) => f.id !== playerFactionId())!;
    expect(getFactionTreasury(other.id).factionId).toBe(other.id);
  });
});

describe("updateTreasuryPolicy", () => {
  it("rejects when the world has no player seat", () => {
    const seatless = generateWorld({ systemCount: 60, seed: 13 });
    setWorld(seatless);
    const anyFaction = seatless.factions[0];
    const result = updateTreasuryPolicy(anyFaction.id, { taxLevel: "high" });
    expect(result).toEqual({ ok: false, error: "This world has no player seat." });
  });

  it("rejects mutating a faction the player does not control", () => {
    const other = getWorld().factions.find((f) => f.id !== playerFactionId())!;
    const result = updateTreasuryPolicy(other.id, { taxLevel: "high" });
    expect(result).toEqual({ ok: false, error: "You do not control this faction." });
  });

  it("writes taxLevel and bands, clamping maintenance to the floor", () => {
    const factionId = playerFactionId();
    const result = updateTreasuryPolicy(factionId, {
      taxLevel: "very_high",
      bands: { maintenance: 0.5, logistics: 0.25, construction: 0 },
    });
    expect(result.ok).toBe(true);
    const row = getWorld().treasuries.find((t) => t.factionId === factionId)!;
    expect(row.taxLevel).toBe("very_high");
    expect(row.bands).toEqual({ maintenance: 0.5, logistics: 0.25, construction: 0 });
  });

  it("leaves the untouched half of the pair and other treasuries alone", () => {
    const factionId = playerFactionId();
    const before = getWorld().treasuries.find((t) => t.factionId === factionId)!;
    const othersBefore = getWorld().treasuries.filter((t) => t.factionId !== factionId);

    const result = updateTreasuryPolicy(factionId, { taxLevel: "low" });
    expect(result.ok).toBe(true);

    const after = getWorld().treasuries.find((t) => t.factionId === factionId)!;
    expect(after.taxLevel).toBe("low");
    expect(after.bands).toEqual(before.bands);
    expect(after.balance).toBe(before.balance);
    expect(after.funded).toEqual(before.funded);
    expect(getWorld().treasuries.filter((t) => t.factionId !== factionId)).toEqual(othersBefore);
  });

  it("defensively clamps service-level input even past the schema", () => {
    const factionId = playerFactionId();
    const result = updateTreasuryPolicy(factionId, {
      bands: { maintenance: 0.1, logistics: 1.5, construction: -2 },
    });
    expect(result.ok).toBe(true);
    const row = getWorld().treasuries.find((t) => t.factionId === factionId)!;
    expect(row.bands).toEqual({ maintenance: 0.5, logistics: 1, construction: 0 });
  });
});
