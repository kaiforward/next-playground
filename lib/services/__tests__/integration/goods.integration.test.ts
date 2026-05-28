import { describe, it, expect, vi, beforeEach } from "vitest";
import { useIntegrationDb } from "@/lib/test-utils/integration";
import { seedTestUniverse } from "@/lib/test-utils/fixtures";

const { prisma } = useIntegrationDb();
vi.mock("@/lib/prisma", () => ({ prisma }));

const { getGoods } = await import("@/lib/services/goods");

describe("getGoods (integration)", () => {
  beforeEach(async () => {
    await seedTestUniverse(prisma);
  });

  it("returns one entry per seeded good with id, name, tier, basePrice", async () => {
    const goods = await getGoods();

    expect(goods.length).toBeGreaterThan(0);
    for (const g of goods) {
      expect(typeof g.id).toBe("string");
      expect(g.id.length).toBeGreaterThan(0);
      expect(typeof g.name).toBe("string");
      expect(g.name.length).toBeGreaterThan(0);
      expect([0, 1, 2]).toContain(g.tier);
      expect(typeof g.basePrice).toBe("number");
      expect(g.basePrice).toBeGreaterThan(0);
    }
  });

  it("sorts by tier ascending then name", async () => {
    const goods = await getGoods();
    for (let i = 1; i < goods.length; i++) {
      const prev = goods[i - 1];
      const cur = goods[i];
      if (prev.tier === cur.tier) {
        expect(cur.name.localeCompare(prev.name)).toBeGreaterThanOrEqual(0);
      } else {
        expect(cur.tier).toBeGreaterThan(prev.tier);
      }
    }
  });
});
