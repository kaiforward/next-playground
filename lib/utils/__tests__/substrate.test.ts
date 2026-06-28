import { describe, it, expect } from "vitest";
import { bodyDepositFeatures } from "../substrate";
import { makeResourceVector, emptyResourceVector } from "@/lib/engine/resources";

describe("bodyDepositFeatures", () => {
  it("lists present deposits as named features, richest grade first", () => {
    const slots = makeResourceVector({ ore: 8, gas: 2 });
    const quality = makeResourceVector({ ore: 1.6, gas: 0.5 }); // ore "good", gas "poor"
    const features = bodyDepositFeatures(slots, quality);
    expect(features.map((f) => f.resource)).toEqual(["ore", "gas"]); // higher quality first
    expect(features[0].band).toBe("good"); // 1.6 ≤ 1.8
    expect(features[0].name).toMatch(/ore/i);
    expect(features[1].band).toBe("poor"); // 0.5 ≤ 0.7
  });
  it("excludes resources with no deposit", () => {
    expect(bodyDepositFeatures(emptyResourceVector(), emptyResourceVector())).toEqual([]);
  });
});
