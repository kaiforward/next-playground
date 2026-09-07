import { describe, it, expect } from "vitest";
import { treasuryPolicySchema } from "@/lib/schemas/treasury";
import { ALL_TAX_LEVELS } from "@/lib/types/guards";
import { DIRECTED_LOGISTICS } from "@/lib/constants/directed-logistics";

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

  it("accepts stockpileScale alone", () => {
    expect(treasuryPolicySchema.safeParse({ stockpileScale: 1.5 }).success).toBe(true);
  });

  it("accepts every step of STOCKPILE_SCALE_STEPS and rejects a value off it", () => {
    for (const step of DIRECTED_LOGISTICS.STOCKPILE_SCALE_STEPS) {
      expect(treasuryPolicySchema.safeParse({ stockpileScale: step }).success).toBe(true);
    }
    expect(treasuryPolicySchema.safeParse({ stockpileScale: 2 }).success).toBe(false);
  });
});
