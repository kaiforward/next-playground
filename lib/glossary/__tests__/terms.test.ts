import { describe, expect, test } from "vitest";
import { TERMS, type TermId } from "../terms";

/**
 * Hand-maintained, independent of `TERMS` — deriving this list from `Object.keys(TERMS)` would
 * make the "union and record can't drift" test pass for any record, since it would just be
 * checking a value against itself.
 */
const EXPECTED_TERM_IDS: readonly TermId[] = [
  "realisedYield",
  "potentialYield",
  "resourceSlot",
  "worked",
  "locked",
  "body",
  "archetype",
  "qualityBand",
  "resource",
  "building",
  "family",
  "specialisationComplex",
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
});
