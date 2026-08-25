import { describe, expect, it } from "vitest";
import {
  depositSlotOrder, workedYieldFold, workedYieldVectors, marginalSlot, workedByBody,
  potentialSlotOrder, potentialYieldByResource,
  type SlottedBody,
} from "@/lib/engine/worked-deposits";
import { makeResourceVector, RESOURCE_TYPES } from "@/lib/engine/resources";
import type { BodyArchetypeId } from "@/lib/types/game";

// temperate_world: extractionModifier 1.0, unlocked. volcanic_world: 0.4, techLocked.
// barren_rock: 0.7, unlocked. asteroid_belt: 0.6, unlocked.
const TEMPERATE: BodyArchetypeId = "temperate_world";
const VOLCANIC: BodyArchetypeId = "volcanic_world";
const BARREN: BodyArchetypeId = "barren_rock";
const ASTEROID: BodyArchetypeId = "asteroid_belt";

function body(bodyType: BodyArchetypeId, counts: Record<string, number>, quality: Record<string, number>): SlottedBody {
  return {
    bodyType,
    counts: makeResourceVector(counts),
    quality: makeResourceVector(quality),
  };
}

describe("depositSlotOrder", () => {
  it("sorts by ground value with a middle high-value body, and keeps input order among ties", () => {
    // body0 and body2 tie at ground value 0.5; body1 (in between them positionally) is the
    // highest at 0.9 and must sort to the front — so a fixture that never reorders (or reorders
    // wrong) fails this, unlike a fixture where the tied bodies already sit in sorted order.
    const bodies: SlottedBody[] = [
      body(TEMPERATE, { ore: 1 }, { ore: 0.5 }), // ground 0.5, index 0
      body(TEMPERATE, { ore: 1 }, { ore: 0.9 }), // ground 0.9, index 1 — must sort first
      body(TEMPERATE, { ore: 1 }, { ore: 0.5 }), // ground 0.5, index 2 — ties index 0
    ];
    const slots = depositSlotOrder(bodies, "ore");
    expect(slots.map((s) => s.bodyIndex)).toEqual([1, 0, 2]);
  });

  it("excludes tech-locked archetype classes from slots", () => {
    const bodies: SlottedBody[] = [
      body(VOLCANIC, { ore: 5 }, { ore: 0.9 }),
      body(TEMPERATE, { ore: 1 }, { ore: 0.1 }),
    ];
    const slots = depositSlotOrder(bodies, "ore");
    expect(slots).toHaveLength(1);
    expect(slots[0].bodyIndex).toBe(1);
  });
});

describe("workedYieldFold", () => {
  it("n=0 with deposits reads the best slot on all three outputs; a no-deposit resource reads 1.0", () => {
    const bodies: SlottedBody[] = [
      body(TEMPERATE, { ore: 3 }, { ore: 0.8 }),
      body(BARREN, { ore: 3 }, { ore: 0.5 }),
    ];
    const slots = depositSlotOrder(bodies, "ore");
    const fold = workedYieldFold(slots, 0);
    // Best slot: temperate ore, modifier 1.0, quality 0.8 -> ground value 0.8.
    expect(fold.eff).toBeCloseTo(1.0, 10);
    expect(fold.yieldMult).toBeCloseTo(0.8, 10);
    expect(fold.realised).toBeCloseTo(0.8, 10);

    // No-deposit resource (e.g. gas, no counts at all) reads neutral 1.0 on all outputs.
    const noDepositSlots = depositSlotOrder(bodies, "gas");
    const noDepositFold = workedYieldFold(noDepositSlots, 0);
    expect(noDepositFold.eff).toBeCloseTo(1.0, 10);
    expect(noDepositFold.yieldMult).toBeCloseTo(1.0, 10);
    expect(noDepositFold.realised).toBeCloseTo(1.0, 10);
  });

  it("n past the slot total clamps at the all-slots mean", () => {
    const bodies: SlottedBody[] = [
      body(TEMPERATE, { ore: 2 }, { ore: 0.8 }),
      body(BARREN, { ore: 2 }, { ore: 0.4 }),
    ];
    const slots = depositSlotOrder(bodies, "ore");
    // Ground values: temperate 0.8*1.0=0.8 (x2), barren 0.4*0.7=0.28 (x2).
    const allSlotsFold = workedYieldFold(slots, slots.length);
    const overrunFold = workedYieldFold(slots, slots.length + 50);
    expect(overrunFold.realised).toBeCloseTo(allSlotsFold.realised, 10);
    expect(overrunFold.eff).toBeCloseTo(allSlotsFold.eff, 10);
    expect(overrunFold.yieldMult).toBeCloseTo(allSlotsFold.yieldMult, 10);
    const expectedMean = (0.8 + 0.8 + 0.28 + 0.28) / 4;
    expect(allSlotsFold.realised).toBeCloseTo(expectedMean, 10);
  });

  it("eff x yieldMult equals the mean of ground values exactly, distinct from the product of means", () => {
    // Anti-correlated: high quality pairs with low modifier and vice versa.
    const bodies: SlottedBody[] = [
      body(TEMPERATE, { ore: 1 }, { ore: 0.2 }), // modifier 1.0, quality 0.2 -> ground 0.2
      body(BARREN, { ore: 1 }, { ore: 0.9 }),    // modifier 0.7, quality 0.9 -> ground 0.63
    ];
    const slots = depositSlotOrder(bodies, "ore");
    const fold = workedYieldFold(slots, 2);
    const meanGroundValue = (0.2 + 0.63) / 2; // 0.415
    const meanModifier = (1.0 + 0.7) / 2; // 0.85
    const meanQuality = (0.2 + 0.9) / 2; // 0.55
    const productOfMeans = meanModifier * meanQuality; // 0.4675, differs from 0.415

    expect(fold.realised).toBeCloseTo(meanGroundValue, 10);
    expect(fold.eff).toBeCloseTo(meanModifier, 10);
    expect(fold.eff * fold.yieldMult).toBeCloseTo(fold.realised, 10);
    expect(fold.realised).not.toBeCloseTo(productOfMeans, 2);
  });

  it("inserting a high-value slot never lowers realised (front, mid, back insertion at fixed n)", () => {
    const baseBodies: SlottedBody[] = [
      body(TEMPERATE, { ore: 1 }, { ore: 0.5 }), // ground 0.5
      body(BARREN, { ore: 1 }, { ore: 0.5 }),    // ground 0.35
      body(ASTEROID, { ore: 1 }, { ore: 0.3 }),  // ground 0.18
    ];
    const baseSlots = depositSlotOrder(baseBodies, "ore");
    const n = 2;
    const baseRealised = workedYieldFold(baseSlots, n).realised;

    // Front insertion: a very high ground-value slot (best modifier, high quality).
    const frontBodies: SlottedBody[] = [
      body(TEMPERATE, { ore: 1 }, { ore: 0.99 }), // ground 0.99, sorts first
      ...baseBodies,
    ];
    const frontRealised = workedYieldFold(depositSlotOrder(frontBodies, "ore"), n).realised;
    expect(frontRealised).toBeGreaterThanOrEqual(baseRealised);

    // Mid insertion: ground value between the existing slots (0.5 and 0.35).
    const midBodies: SlottedBody[] = [
      baseBodies[0],
      body(TEMPERATE, { ore: 1 }, { ore: 0.44 }), // ground 0.44, sorts between 0.5 and 0.35
      baseBodies[1],
      baseBodies[2],
    ];
    const midRealised = workedYieldFold(depositSlotOrder(midBodies, "ore"), n).realised;
    expect(midRealised).toBeGreaterThanOrEqual(baseRealised);

    // Back insertion: lowest ground value, sorts last.
    const backBodies: SlottedBody[] = [
      ...baseBodies,
      body(TEMPERATE, { ore: 1 }, { ore: 0.01 }), // ground 0.01, sorts last
    ];
    const backRealised = workedYieldFold(depositSlotOrder(backBodies, "ore"), n).realised;
    expect(backRealised).toBeGreaterThanOrEqual(baseRealised);
  });

  it("empty slot list returns neutral vectors, not NaN", () => {
    const fold = workedYieldFold([], 0);
    expect(fold.eff).toBe(1);
    expect(fold.yieldMult).toBe(1);
    expect(fold.realised).toBe(1);
    expect(Number.isFinite(fold.eff)).toBe(true);
    expect(Number.isFinite(fold.yieldMult)).toBe(true);
    expect(Number.isFinite(fold.realised)).toBe(true);

    const foldN5 = workedYieldFold([], 5);
    expect(foldN5.eff).toBe(1);
    expect(foldN5.yieldMult).toBe(1);
    expect(foldN5.realised).toBe(1);
  });
});

describe("workedYieldVectors", () => {
  it("returns neutral vectors for an empty body list, no NaN", () => {
    const { eff, yieldMult } = workedYieldVectors([], {});
    for (const type of RESOURCE_TYPES) {
      expect(Number.isFinite(eff[type])).toBe(true);
      expect(Number.isFinite(yieldMult[type])).toBe(true);
      expect(eff[type]).toBe(1);
      expect(yieldMult[type]).toBe(1);
    }
  });

  it("derives n from extractorsOnResource over the buildings bag — two different counts read two different folds", () => {
    // One slot per body (not three identical ones) — a fixture where every slot in the prefix
    // shares one body's ground value can't tell n=1 from n=2 or n=3 apart (they'd all read the
    // same number), so the count genuinely has to move the fold for this test to discriminate a
    // wrong-n implementation from a right one.
    const bodies: SlottedBody[] = [
      body(TEMPERATE, { ore: 1 }, { ore: 0.9 }), // ground 0.9 (modifier 1.0) — the best slot
      body(BARREN, { ore: 1 }, { ore: 0.5 }), // ground 0.35 (modifier 0.7) — strictly poorer
    ];
    // "ore" is the real tier-0 building keyed on the ore resource.
    const n1 = workedYieldVectors(bodies, { ore: 1 });
    const n2 = workedYieldVectors(bodies, { ore: 2 });

    // n=1: the single best slot, exactly.
    expect(n1.eff.ore).toBeCloseTo(1.0, 10);
    expect(n1.eff.ore * n1.yieldMult.ore).toBeCloseTo(0.9, 10);

    // n=2: both slots fold in — a genuinely different mean (not a coincidental match with n=1),
    // pinned to the exact expected value.
    expect(n2.eff.ore).toBeCloseTo((1.0 + 0.7) / 2, 10);
    expect(n2.eff.ore * n2.yieldMult.ore).toBeCloseTo((0.9 + 0.35) / 2, 10);
    expect(n1.eff.ore).not.toBeCloseTo(n2.eff.ore, 6);
    expect(n1.yieldMult.ore).not.toBeCloseTo(n2.yieldMult.ore, 6);
  });
});

describe("marginalSlot", () => {
  it("returns the (n+1)th slot, or null once fully worked", () => {
    const bodies: SlottedBody[] = [
      body(TEMPERATE, { ore: 1 }, { ore: 0.9 }),
      body(BARREN, { ore: 1 }, { ore: 0.5 }),
    ];
    const slots = depositSlotOrder(bodies, "ore");
    const marginal0 = marginalSlot(slots, 0);
    expect(marginal0?.bodyIndex).toBe(0);
    const marginal1 = marginalSlot(slots, 1);
    expect(marginal1?.bodyIndex).toBe(1);
    const marginal2 = marginalSlot(slots, 2);
    expect(marginal2).toBeNull();
  });
});

describe("workedByBody", () => {
  it("reports per-body worked/total for a partially worked resource", () => {
    const bodies: SlottedBody[] = [
      body(TEMPERATE, { ore: 2 }, { ore: 0.9 }), // best -> worked first
      body(BARREN, { ore: 2 }, { ore: 0.3 }),
    ];
    const result = workedByBody(bodies, { ore: 3 });
    expect(result[0].ore.total).toBe(2);
    expect(result[0].ore.worked).toBe(2);
    expect(result[1].ore.total).toBe(2);
    expect(result[1].ore.worked).toBe(1);
  });

  it("empty body list returns an empty map, no NaN", () => {
    const result = workedByBody([], {});
    expect(Object.keys(result)).toHaveLength(0);
  });
});

describe("potentialSlotOrder", () => {
  it("includes tech-locked archetype classes' slots — the opposite of depositSlotOrder", () => {
    const bodies: SlottedBody[] = [
      body(VOLCANIC, { ore: 5 }, { ore: 0.9 }), // locked
      body(TEMPERATE, { ore: 1 }, { ore: 0.1 }), // unlocked
    ];
    const worked = depositSlotOrder(bodies, "ore");
    const potential = potentialSlotOrder(bodies, "ore");
    // depositSlotOrder (unchanged): only the unlocked body's single slot.
    expect(worked).toHaveLength(1);
    expect(worked[0].bodyIndex).toBe(1);
    // potentialSlotOrder: both bodies' slots, still ground-value sorted (volcanic's 0.9*0.4=0.36
    // beats temperate's 0.1*1.0=0.1, so the locked body sorts first here).
    expect(potential).toHaveLength(6);
    expect(potential[0].bodyIndex).toBe(0);
  });
});

describe("potentialYieldByResource", () => {
  it("a locked body's slots move the potential figure while the worked fold on the same fixture is untouched — pins the two folds apart", () => {
    const bodies: SlottedBody[] = [
      body(TEMPERATE, { ore: 1 }, { ore: 0.5 }), // unlocked, ground 0.5
      body(VOLCANIC, { ore: 1 }, { ore: 0.9 }),  // locked, ground 0.36 (0.9 * 0.4)
    ];
    const buildings = { ore: 5 };

    // The worked fold (depositSlotOrder-backed) reads exactly as if the locked body weren't there.
    const withLocked = workedYieldVectors(bodies, buildings);
    const withoutLocked = workedYieldVectors([bodies[0]], buildings);
    expect(withLocked.eff.ore).toBeCloseTo(withoutLocked.eff.ore, 10);
    expect(withLocked.yieldMult.ore).toBeCloseTo(withoutLocked.yieldMult.ore, 10);

    // The potential figure DOES include the locked body — mean of both ground values, not just
    // the unlocked one's 0.5.
    const rows = potentialYieldByResource(bodies);
    const oreRow = rows.find((r) => r.resource === "ore");
    expect(oreRow).toBeDefined();
    expect(oreRow!.slotCount).toBe(2);
    expect(oreRow!.yieldMult).toBeCloseTo((0.5 + 0.36) / 2, 10);
    expect(oreRow!.yieldMult).not.toBeCloseTo(0.5, 6); // would equal 0.5 if the locked slot were dropped
  });

  it("a resource with no slots anywhere (locked or unlocked) renders no row", () => {
    const bodies: SlottedBody[] = [
      body(TEMPERATE, { ore: 1 }, { ore: 0.5 }),
      body(VOLCANIC, { minerals: 1 }, { minerals: 0.5 }),
    ];
    const rows = potentialYieldByResource(bodies);
    // "gas" has no deposit on either body.
    expect(rows.find((r) => r.resource === "gas")).toBeUndefined();
    // "ore" and "minerals" each have exactly one slot, so both DO render.
    expect(rows.find((r) => r.resource === "ore")).toBeDefined();
    expect(rows.find((r) => r.resource === "minerals")).toBeDefined();
  });

  it("marks a locked body's breakdown entry as locked, an unlocked one as not", () => {
    const bodies: SlottedBody[] = [
      body(TEMPERATE, { ore: 1 }, { ore: 0.5 }), // unlocked
      body(VOLCANIC, { ore: 2 }, { ore: 0.9 }),  // locked
    ];
    const rows = potentialYieldByResource(bodies);
    const oreRow = rows.find((r) => r.resource === "ore")!;
    const temperateEntry = oreRow.byBody.find((b) => b.bodyIndex === 0)!;
    const volcanicEntry = oreRow.byBody.find((b) => b.bodyIndex === 1)!;
    expect(temperateEntry.locked).toBe(false);
    expect(volcanicEntry.locked).toBe(true);
    expect(volcanicEntry.slotCount).toBe(2);
  });
});
