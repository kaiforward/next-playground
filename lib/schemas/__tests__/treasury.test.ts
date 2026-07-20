import { describe, it, expect } from "vitest";
import { treasuryPolicySchema } from "@/lib/schemas/treasury";
import { ALL_TAX_LEVELS } from "@/lib/types/guards";

const validBands = { maintenance: 0.8, logistics: 1, construction: 0.5 };

describe("treasuryPolicySchema", () => {
  it("accepts taxLevel alone, bands alone, and both", () => {
    expect(treasuryPolicySchema.safeParse({ taxLevel: "high" }).success).toBe(true);
    expect(treasuryPolicySchema.safeParse({ bands: validBands }).success).toBe(true);
    expect(treasuryPolicySchema.safeParse({ taxLevel: "low", bands: validBands }).success).toBe(true);
  });

  it("rejects an empty payload", () => {
    expect(treasuryPolicySchema.safeParse({}).success).toBe(false);
  });

  it("accepts every canonical tax level and rejects unknown ones", () => {
    for (const level of ALL_TAX_LEVELS) {
      expect(treasuryPolicySchema.safeParse({ taxLevel: level }).success).toBe(true);
    }
    expect(treasuryPolicySchema.safeParse({ taxLevel: "confiscatory" }).success).toBe(false);
  });

  it("rejects maintenance below the 0.5 floor and any band outside [0,1]", () => {
    expect(treasuryPolicySchema.safeParse({ bands: { ...validBands, maintenance: 0.4 } }).success).toBe(false);
    expect(treasuryPolicySchema.safeParse({ bands: { ...validBands, logistics: -0.1 } }).success).toBe(false);
    expect(treasuryPolicySchema.safeParse({ bands: { ...validBands, construction: 1.1 } }).success).toBe(false);
  });

  it("rejects a partial bands object", () => {
    expect(treasuryPolicySchema.safeParse({ bands: { maintenance: 0.8 } }).success).toBe(false);
  });
});
