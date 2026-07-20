import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { generateWorld } from "@/lib/world/gen";
import { setWorld, clearWorld, getWorld } from "@/lib/world/store";
import { getFactionTreasury } from "@/lib/services/treasury";
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
