import { describe, it, expect } from "vitest";
import { deriveDominantEconomy, placeHomeworlds } from "../faction-gen";
import { emptyResourceVector } from "@/lib/engine/resources";
import type { GeneratedSystem } from "../universe-gen";
import type { EconomyType } from "@/lib/types/game";

// Minimal GeneratedSystem for placement tests — only the fields placeHomeworlds reads
// (index, x, y, habitableSpace, bodyDanger, traits, slotCap) matter; the rest are inert defaults.
function mkSys(p: Partial<GeneratedSystem> & { index: number }): GeneratedSystem {
  return {
    index: p.index, name: `s${p.index}`, economyType: "extraction", sunClass: "yellow",
    bodies: [], popCap: 0, population: 0, bodyDanger: 0, traits: [], buildings: {},
    availableSpace: 0, generalSpace: 0, habitableSpace: 0,
    slotCap: emptyResourceVector(), yieldMult: emptyResourceVector(),
    x: 0, y: 0, regionIndex: 0, isGateway: false, description: "",
    ...p,
  };
}

describe("placeHomeworlds", () => {
  it("returns `count` distinct homeworld indices", () => {
    const systems = Array.from({ length: 30 }, (_, i) => mkSys({ index: i, x: (i % 6) * 20, y: Math.floor(i / 6) * 20 }));
    const hw = placeHomeworlds(systems, 8, 120);
    expect(hw).toHaveLength(8);
    expect(new Set(hw).size).toBe(8);
    for (const i of hw) expect(i).toBeGreaterThanOrEqual(0);
  });

  it("prefers a clearly-better substrate (high habitable, diverse, low danger) over a dud", () => {
    const slotCap = emptyResourceVector();
    slotCap.arable = 3; slotCap.water = 2; slotCap.ore = 4; // diverse
    const good = mkSys({ index: 0, x: 10, y: 10, habitableSpace: 100, bodyDanger: 0, slotCap });
    const dud = mkSys({ index: 1, x: 90, y: 90, habitableSpace: 1, bodyDanger: 100, slotCap: emptyResourceVector() });
    expect(placeHomeworlds([good, dud], 1, 100)).toEqual([0]); // good dominates on habitable + diversity + low danger
  });

  it("spaces homeworlds apart — skips a high-scoring neighbour that is too close", () => {
    // mapSize 100 → threshold 18. A(10,10) best, B(15,10) dist 5 (< 18, too close), C(90,90) far.
    const a = mkSys({ index: 0, x: 10, y: 10, habitableSpace: 100 });
    const b = mkSys({ index: 1, x: 15, y: 10, habitableSpace: 90 });
    const c = mkSys({ index: 2, x: 90, y: 90, habitableSpace: 50 });
    expect(placeHomeworlds([a, b, c], 2, 100)).toEqual([0, 2]);
  });

  it("relaxes gracefully — still returns `count` when spacing cannot be satisfied", () => {
    // Three systems all within the initial threshold of each other → relaxation lets all fit.
    const cluster = [
      mkSys({ index: 0, x: 10, y: 10, habitableSpace: 30 }),
      mkSys({ index: 1, x: 12, y: 11, habitableSpace: 20 }),
      mkSys({ index: 2, x: 11, y: 13, habitableSpace: 10 }),
    ];
    const hw = placeHomeworlds(cluster, 3, 100);
    expect(hw).toHaveLength(3);
    expect(new Set(hw).size).toBe(3);
  });

  it("is deterministic — same input produces the same placement", () => {
    const systems = Array.from({ length: 20 }, (_, i) => mkSys({ index: i, x: (i * 7) % 100, y: (i * 13) % 100, habitableSpace: (i * 17) % 50 }));
    expect(placeHomeworlds(systems, 6, 100)).toEqual(placeHomeworlds(systems, 6, 100));
  });
});

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
