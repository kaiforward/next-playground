import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { systemHabitabilityQuality, isContributingBody, contributingBodiesSorted } from "../habitability";
import { POP_CENTRE_DENSITY } from "@/lib/constants/industry";
import { generateWorld } from "@/lib/world/gen";
import { BODY_ARCHETYPES, HABITABILITY_THRESHOLD } from "@/lib/constants/bodies";

describe("systemHabitabilityQuality", () => {
  it("reads the TOP body's score at population 0 — not a mean, not 0", () => {
    // Worst-scored body listed FIRST on purpose: if the fold ever skipped its own internal sort
    // and instead trusted array order, this fixture would read 0.3 (or a mean) instead of 1.0.
    const bodies = [
      { score: 0.3, peopleLand: 200 },
      { score: 1.0, peopleLand: 100 },
      { score: 0.6, peopleLand: 300 },
    ];
    const { quality, frontierIndex, partial } = systemHabitabilityQuality(bodies, 0);
    expect(quality).toBe(1.0);
    expect(quality).not.toBe((0.3 + 1.0 + 0.6) / 3); // not a plain mean
    expect(quality).not.toBe(0);
    expect(frontierIndex).toBe(0);
    // The zero-occupancy arm: frontierIndex names the best body as next-to-fill, but nobody has
    // landed anywhere yet — not partially filled.
    expect(partial).toBe(false);
  });

  it("reads the all-bodies people-land-weighted mean once population overruns every body's land (the clamp arm)", () => {
    const bodies = [
      { score: 1.0, peopleLand: 100 },
      { score: 0.6, peopleLand: 300 },
    ];
    // Occupied land (population / POP_CENTRE_DENSITY) far past the 400 total.
    const population = 10_000 * POP_CENTRE_DENSITY;
    const { quality, frontierIndex, partial } = systemHabitabilityQuality(bodies, population);
    const expected = (1.0 * 100 + 0.6 * 300) / 400;
    expect(quality).toBeCloseTo(expected, 12);
    expect(frontierIndex).toBe(1); // the sorted list's last index
    // The clamp arm: every body is fully occupied, not partially — the last body is not "mid-fill".
    expect(partial).toBe(false);
  });

  it("weights a partial last body by its OCCUPIED land only (pinned boundary arithmetic)", () => {
    // Two bodies: A (score 1.0, land 100) fully occupied, B (score 0.6, land 50) occupied to
    // exactly 20 of its 50 land. Occupied land = 120 (< the 150 total, so this is the mid-prefix
    // arm, not the clamp arm).
    const bodies = [
      { score: 0.6, peopleLand: 50 }, // listed out of score order — sort must still land it last
      { score: 1.0, peopleLand: 100 },
    ];
    const occupiedLand = 120;
    const population = occupiedLand * POP_CENTRE_DENSITY;
    const { quality, frontierIndex, partial } = systemHabitabilityQuality(bodies, population);
    // weighted = 1.0*100 (all of A) + 0.6*20 (only the occupied slice of B) = 112
    const expected = (1.0 * 100 + 0.6 * 20) / 120;
    expect(expected).toBeCloseTo(0.933333333, 9);
    expect(quality).toBeCloseTo(expected, 12);
    expect(frontierIndex).toBe(1); // B is the marginal body
    // B is genuinely mid-fill: 20 of its 50 land occupied, 30 still unoccupied.
    expect(partial).toBe(true);
  });

  it("folds best-first even when the input list is unsorted (vacuity check — the sort is inside the seam)", () => {
    // Same three-body set, handed in three different orders. If the function ever silently relied
    // on caller order, one of these arrangements would land on a different quality.
    const a = { score: 0.6, peopleLand: 50 };
    const b = { score: 1.0, peopleLand: 100 };
    const c = { score: 0.3, peopleLand: 400 };
    const occupiedLand = 120; // inside b, partially into a — c (worst) never enters the prefix
    const population = occupiedLand * POP_CENTRE_DENSITY;
    const expected = (1.0 * 100 + 0.6 * 20) / 120;

    const orderings = [[a, b, c], [b, c, a], [c, a, b], [b, a, c]];
    for (const bodies of orderings) {
      const { quality, frontierIndex } = systemHabitabilityQuality(bodies, population);
      expect(quality).toBeCloseTo(expected, 12);
      expect(frontierIndex).toBe(1);
    }
  });

  it("reads a neutral 0 for an empty body list (defensive — real play always has ≥1 contributing body)", () => {
    const { quality, frontierIndex, partial } = systemHabitabilityQuality([], 500);
    expect(quality).toBe(0);
    expect(frontierIndex).toBe(-1);
    expect(partial).toBe(false);
  });
});

describe("systemHabitabilityQuality: homeworld integration flavour", () => {
  it("reads a faction homeworld's quality at ~1.0 — the garden body's authored score arriving intact", () => {
    const world = generateWorld({ systemCount: 60, seed: 7 });
    const faction = world.factions[0];
    const homeSystem = world.systems.find((s) => s.id === faction.homeworldId);
    if (!homeSystem) throw new Error("Expected a homeworld system");

    const bodies = world.bodies
      .filter((b) => b.systemId === homeSystem.id)
      .filter((b) => {
        const arch = BODY_ARCHETYPES[b.bodyType];
        return !arch.techLocked && arch.scores.default >= HABITABILITY_THRESHOLD;
      })
      .map((b) => ({ score: BODY_ARCHETYPES[b.bodyType].scores.default, peopleLand: b.peopleLand }));

    const { quality } = systemHabitabilityQuality(bodies, homeSystem.population);
    // The garden body (temperate_world, score 1.0) is authored with GARDEN_MARGIN headroom over
    // the prefab's exact footprint, so the homeworld's opening population always fits inside it
    // alone — quality reads exactly the top (garden) body's score.
    expect(quality).toBe(1.0);
  });
});

describe("isContributingBody / contributingBodiesSorted", () => {
  it("excludes a locked body and a sub-threshold body, keeps score-descending order for the rest", () => {
    const best = { score: 1.0, locked: false };
    const good = { score: HABITABILITY_THRESHOLD, locked: false };
    const subThreshold = { score: HABITABILITY_THRESHOLD - 0.01, locked: false };
    const lockedGood = { score: 1.0, locked: true };
    expect(isContributingBody(best)).toBe(true);
    expect(isContributingBody(subThreshold)).toBe(false);
    expect(isContributingBody(lockedGood)).toBe(false);
    expect(contributingBodiesSorted([good, best, subThreshold, lockedGood])).toEqual([best, good]);
  });
});

/**
 * The contributing-body predicate/ordering was once independently restated at three sites (this
 * engine fold, `lib/world/tick.ts`'s `habitabilityBodiesBySystem`, `lib/utils/substrate.ts`'s
 * `contributingBodiesSorted`/`occupiedBodyIds`); the ONE shared definition above replaced them.
 * This is the structural red-proof that the other two sites actually import it rather than keeping
 * their own inline copy — a behavioural test alone can't distinguish "imports the shared
 * predicate" from "coincidentally restates the same two conditions".
 */
describe("contributing-body predicate — consumed at the former restatement sites, not re-stated", () => {
  const here = fileURLToPath(import.meta.url);
  const repoRoot = join(dirname(here), "..", "..", "..");
  const read = (relPath: string) => readFileSync(join(repoRoot, relPath), "utf8");

  it("lib/world/tick.ts imports isContributingBody from the engine fold and no longer inlines the threshold/locked check", () => {
    const src = read("lib/world/tick.ts");
    expect(src).toMatch(/import\s*\{\s*isContributingBody\s*\}\s*from\s*["']@\/lib\/engine\/habitability["']/);
    expect(src).not.toMatch(/techLocked\s*\|\|\s*arch\.scores\.default\s*<\s*HABITABILITY_THRESHOLD/);
  });

  it("lib/utils/substrate.ts imports contributingBodiesSorted from the engine fold rather than defining its own", () => {
    const src = read("lib/utils/substrate.ts");
    expect(src).toMatch(/import\s*\{\s*contributingBodiesSorted\s*\}\s*from\s*["']@\/lib\/engine\/habitability["']/);
    expect(src).not.toMatch(/export function contributingBodiesSorted/);
  });
});
