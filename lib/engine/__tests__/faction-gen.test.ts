import { describe, it, expect } from "vitest";
import { deriveDominantEconomy, placeHomeworlds } from "../faction-gen";
import { emptyResourceVector } from "@/lib/engine/resources";
import type { GeneratedSystem } from "../universe-gen";
import type { EconomyType } from "@/lib/types/game";

// Minimal GeneratedSystem for placement tests — only the fields placeHomeworlds reads
// (index, x, y, habitableSpace, bodyDanger, slotCap) matter; the rest are inert defaults.
function mkSys(p: Partial<GeneratedSystem> & { index: number }): GeneratedSystem {
  return {
    name: `s${p.index}`, economyType: "extraction", sunClass: "yellow",
    bodies: [], popCap: 0, population: 0, bodyDanger: 0, buildings: {},
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

  it("succeeds via relaxation — returns a spaced set once the threshold relaxes enough", () => {
    // mapSize 100 → initial spacing threshold 18. The A/C/D triangle has min pairwise
    // distance 10, so no 3-system spacing holds until the threshold relaxes below 10 —
    // reached mid-loop at step 4 (18 × 0.85^4 ≈ 9.4), not at step 0 and not via the
    // give-up fallback. B sits ~1.4 from A: high-scoring enough to be a top-3 pick but too
    // close to be spaced, so a relaxed pick must drop it for the spaced {A,C,D}. The
    // fallback (top-3 by score) would instead keep B — which is what this asserts against.
    const a = mkSys({ index: 0, x: 0, y: 0, habitableSpace: 100 });
    const b = mkSys({ index: 1, x: 1, y: 1, habitableSpace: 90 });
    const c = mkSys({ index: 2, x: 0, y: 10, habitableSpace: 50 });
    const d = mkSys({ index: 3, x: 10, y: 0, habitableSpace: 40 });
    const hw = placeHomeworlds([a, b, c, d], 3, 100);
    expect([...hw].sort((x, y) => x - y)).toEqual([0, 2, 3]);
    expect(hw).not.toContain(1); // spacing preserved via relaxation, not the top-3-by-score fallback
  });

  it("falls back to top-scoring order when even full relaxation can't space `count` apart", () => {
    // Three systems packed tighter (min pairwise ≈2.24) than the most-relaxed threshold
    // (18 × 0.85^12 ≈ 2.56 at mapSize 100), so spacing is never satisfiable: the loop
    // exhausts every relax step and returns the top-`count`-by-substrate fallback.
    const cluster = [
      mkSys({ index: 0, x: 10, y: 10, habitableSpace: 30 }),
      mkSys({ index: 1, x: 12, y: 11, habitableSpace: 20 }),
      mkSys({ index: 2, x: 11, y: 13, habitableSpace: 10 }),
    ];
    expect(placeHomeworlds(cluster, 3, 100)).toEqual([0, 1, 2]); // ranked by habitableSpace, spacing given up
  });

  it("throws when there are fewer systems than requested homeworlds", () => {
    // Fail loud rather than silently returning a short array — a shortfall would otherwise
    // put `undefined` into a faction's homeworldSystemIndex and corrupt ownership downstream.
    const systems = [mkSys({ index: 0, x: 0, y: 0 }), mkSys({ index: 1, x: 50, y: 50 })];
    expect(() => placeHomeworlds(systems, 3, 100)).toThrow(/cannot place/);
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
