import { describe, it, expect } from "vitest";
import { isEconomicallyActive } from "@/lib/engine/control";

describe("isEconomicallyActive", () => {
  it("is true only for developed systems", () => {
    expect(isEconomicallyActive("developed")).toBe(true);
  });

  it("is false for controlled and unclaimed systems", () => {
    expect(isEconomicallyActive("controlled")).toBe(false);
    expect(isEconomicallyActive("unclaimed")).toBe(false);
  });
});
