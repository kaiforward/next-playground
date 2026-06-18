import { describe, it, expect } from "vitest";
import {
  GOOD_PRODUCTION,
  GOOD_CONSUMPTION,
  LABOUR_HALF_POP,
} from "../physical-economy";
import { GOOD_NAMES, GOOD_TIER_BY_KEY } from "../goods";
import { RESOURCE_TYPES } from "@/lib/engine/resources";

describe("GOOD_PRODUCTION / GOOD_CONSUMPTION coverage", () => {
  it("has a production driver and a consumption need for every good", () => {
    for (const goodId of GOOD_NAMES) {
      expect(GOOD_PRODUCTION[goodId], `production: ${goodId}`).toBeDefined();
      expect(GOOD_CONSUMPTION[goodId], `consumption: ${goodId}`).toBeDefined();
    }
  });

  it("defines no drivers or needs for goods that do not exist", () => {
    const known = new Set(GOOD_NAMES);
    for (const goodId of Object.keys(GOOD_PRODUCTION)) expect(known.has(goodId)).toBe(true);
    for (const goodId of Object.keys(GOOD_CONSUMPTION)) expect(known.has(goodId)).toBe(true);
  });

  it("uses positive coefficients and per-capita needs", () => {
    for (const goodId of GOOD_NAMES) {
      expect(GOOD_PRODUCTION[goodId].coeff).toBeGreaterThan(0);
      expect(GOOD_CONSUMPTION[goodId]).toBeGreaterThan(0);
    }
  });
});

describe("resource-driven vs labour-only split", () => {
  it("maps tier-0 goods to their driving resource", () => {
    expect(GOOD_PRODUCTION.water.resource).toBe("water");
    expect(GOOD_PRODUCTION.ore.resource).toBe("ore");
    expect(GOOD_PRODUCTION.food.resource).toBe("arable");
    expect(GOOD_PRODUCTION.textiles.resource).toBe("arable");
  });

  it("leaves tier-1/2 goods labour-only (no resource gate)", () => {
    for (const goodId of GOOD_NAMES) {
      if (GOOD_TIER_BY_KEY[goodId] === 0) {
        expect(GOOD_PRODUCTION[goodId].resource, `tier-0 ${goodId}`).toBeDefined();
      } else {
        expect(GOOD_PRODUCTION[goodId].resource, `tier-${GOOD_TIER_BY_KEY[goodId]} ${goodId}`).toBeUndefined();
      }
    }
  });

  it("never drives production from an economically-inert resource", () => {
    const inert = new Set(["gas", "minerals", "biomass", "radioactive"]);
    for (const goodId of GOOD_NAMES) {
      const res = GOOD_PRODUCTION[goodId].resource;
      if (res) expect(inert.has(res), `${goodId} → ${res}`).toBe(false);
    }
    // sanity: the inert set is a subset of the real resource types
    for (const r of inert) expect(RESOURCE_TYPES).toContain(r);
  });
});

describe("LABOUR_HALF_POP", () => {
  it("is a positive population magnitude", () => {
    expect(LABOUR_HALF_POP).toBeGreaterThan(0);
  });
});
