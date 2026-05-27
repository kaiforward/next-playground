import { describe, it, expect } from "vitest";
import { deriveDominantEconomy } from "../faction-gen";
import type { EconomyType } from "@/lib/types/game";

describe("deriveDominantEconomy", () => {
  it("returns 'extraction' for empty input", () => {
    expect(deriveDominantEconomy([])).toBe("extraction");
  });

  it("returns the only economy type when input has one entry", () => {
    expect(deriveDominantEconomy([{ economyType: "tech" }])).toBe("tech");
  });

  it("returns the majority economy type", () => {
    const systems: { economyType: EconomyType }[] = [
      { economyType: "agricultural" },
      { economyType: "agricultural" },
      { economyType: "industrial" },
    ];
    expect(deriveDominantEconomy(systems)).toBe("agricultural");
  });

  it("breaks ties alphabetically", () => {
    const systems: { economyType: EconomyType }[] = [
      { economyType: "tech" },
      { economyType: "industrial" },
      { economyType: "agricultural" },
    ];
    expect(deriveDominantEconomy(systems)).toBe("agricultural");
  });

  it("breaks two-way ties alphabetically", () => {
    const systems: { economyType: EconomyType }[] = [
      { economyType: "tech" },
      { economyType: "tech" },
      { economyType: "industrial" },
      { economyType: "industrial" },
    ];
    expect(deriveDominantEconomy(systems)).toBe("industrial");
  });

  it("is deterministic regardless of input order", () => {
    const a: { economyType: EconomyType }[] = [
      { economyType: "agricultural" },
      { economyType: "industrial" },
      { economyType: "industrial" },
    ];
    const b: { economyType: EconomyType }[] = [
      { economyType: "industrial" },
      { economyType: "agricultural" },
      { economyType: "industrial" },
    ];
    expect(deriveDominantEconomy(a)).toBe(deriveDominantEconomy(b));
  });
});
