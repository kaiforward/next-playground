import { describe, it, expect } from "vitest";
import { getGoods } from "@/lib/services/goods";
import { GOODS } from "@/lib/constants/goods";

describe("getGoods", () => {
  it("returns one entry per catalog good with id, name, tier, basePrice", () => {
    const goods = getGoods();

    expect(goods).toHaveLength(Object.keys(GOODS).length);
    for (const g of goods) {
      expect(Object.hasOwn(GOODS, g.id)).toBe(true);
      expect(g.name).toBe(GOODS[g.id].name);
      expect([0, 1, 2]).toContain(g.tier);
      expect(g.basePrice).toBeGreaterThan(0);
    }
  });

  it("sorts by tier ascending then name", () => {
    const goods = getGoods();
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
