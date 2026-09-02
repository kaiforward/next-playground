import { describe, expect, test } from "vitest";
import { TERMS, type TermId } from "../terms";

/**
 * Hand-maintained, independent of `TERMS` — deriving this list from `Object.keys(TERMS)` would
 * make the "union and record can't drift" test pass for any record, since it would just be
 * checking a value against itself.
 */
const EXPECTED_TERM_IDS: readonly TermId[] = [
  // Time and scale
  "cycle",
  "dayMonthYear",
  "ust",
  "developmentPoints",
  // People
  "population",
  "popCap",
  "housing",
  "occupancy",
  "habitableLand",
  "workforce",
  "skillGrades",
  "skillCeiling",
  "academy",
  "staffing",
  "unemployed",
  "migration",
  "colonistDelivery",
  "abandonment",
  // Wellbeing
  "provision",
  "expectation",
  "grievance",
  "provisionBands",
  "famine",
  "unrest",
  "stability",
  "strike",
  "survivalGoods",
  "need",
  "satisfaction",
  // Ground
  "body",
  "archetype",
  "settled",
  "habitability",
  "settledHabitability",
  "resource",
  "resourceSlot",
  "qualityBand",
  "potentialYield",
  "realisedYield",
  "worked",
  "locked",
  "orbitRing",
  "starClass",
  "danger",
  // Industry
  "building",
  "builtStaffedFree",
  "decay",
  "idleReason",
  "recipe",
  "inputGate",
  "tier",
  "family",
  "specialisationComplex",
  "healthStates",
  // Trade and money
  "stock",
  "price",
  "demand",
  "surplus",
  "deficit",
  "haul",
  "treasury",
  "taxLevel",
  "budgetBand",
  "fundedFraction",
  "charterFee",
  "manifest",
  // Territory and politics
  "ownershipLadder",
  "claim",
  "colonise",
  "colony",
  "faction",
  "government",
  "doctrine",
  "factionStatus",
  "relationScore",
  "relationTiers",
  "alliance",
  "region",
  "jumpLane",
  "crossingLane",
  "fuelCost",
  "gateway",
  // The player's layer
  "automationSwitch",
  "pin",
  "trackerSection",
  "alertCategory",
  "alertTiers",
  "fundedFront",
  "ghostRow",
];

describe("TERMS", () => {
  test("has exactly the entries the TermId union names, no more and no fewer", () => {
    expect(Object.keys(TERMS).sort()).toEqual([...EXPECTED_TERM_IDS].sort());
  });

  test("every entry's own id field matches the key it is stored under", () => {
    for (const [key, definition] of Object.entries(TERMS)) {
      expect(definition.id).toBe(key);
    }
  });

  test("every term reference inside a body points at a real entry", () => {
    for (const definition of Object.values(TERMS)) {
      for (const segment of definition.body) {
        if (segment.kind === "term") {
          expect(TERMS[segment.id]).toBeDefined();
        }
      }
    }
  });

  test("a body with no term segments is a leaf that opens nothing further", () => {
    const bodyDefinition = TERMS.body;
    expect(bodyDefinition.body.every((segment) => segment.kind === "text")).toBe(true);
  });

  test("a body referencing another term makes a chain possible", () => {
    const resourceSlotDefinition = TERMS.resourceSlot;
    expect(resourceSlotDefinition.body.some((segment) => segment.kind === "term")).toBe(true);
  });

  test("family and specialisation complex define each other — a real cycle, not a hypothetical one", () => {
    const familyReferencesComplex = TERMS.family.body.some(
      (segment) => segment.kind === "term" && segment.id === "specialisationComplex",
    );
    const complexReferencesFamily = TERMS.specialisationComplex.body.some(
      (segment) => segment.kind === "term" && segment.id === "family",
    );
    expect(familyReferencesComplex).toBe(true);
    expect(complexReferencesFamily).toBe(true);
  });

  test("segment text concatenates back to the glossary's exact wording for a multi-reference body", () => {
    const rendered = TERMS.realisedYield.body
      .map((segment) => (segment.kind === "text" ? segment.text : segment.label))
      .join("");
    expect(rendered).toBe(
      "The multiplier a system's extractors actually get, across the slots they sit on. Extractors take the best ground first, so it sits above potential yield while only the best ground is worked and moves toward it as more slots are worked. Locked slots count toward potential yield and can never be worked, so it need never arrive.",
    );
  });

  test("segment text concatenates back to the glossary's exact wording for settled habitability", () => {
    const rendered = TERMS.settledHabitability.body
      .map((segment) => (segment.kind === "text" ? segment.text : segment.label))
      .join("");
    expect(rendered).toBe(
      "A system's own habitability figure: the land-weighted mean across the bodies its population actually occupies, best body first. It falls as population spreads onto worse worlds, and it multiplies population growth.",
    );
  });

  test("every entry has a non-empty term name and a non-empty body", () => {
    for (const definition of Object.values(TERMS)) {
      expect(definition.term.length).toBeGreaterThan(0);
      const rendered = definition.body
        .map((segment) => (segment.kind === "text" ? segment.text : segment.label))
        .join("");
      expect(rendered.length).toBeGreaterThan(0);
    }
  });
});
