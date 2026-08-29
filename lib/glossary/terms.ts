/**
 * The player-facing glossary as pure data — no JSX, no React import, no dependency on
 * `components/`. A definition's body is a sequence of segments rather than a rendered node
 * specifically so a component can render one level at a time: the `family` / `specialisation
 * complex` cycle below is real (each names the other), and eager rendering of a body's own
 * references would recurse forever. A segment is either plain text or a reference to another
 * `TermId`, which is what lets `components/ui/term-label.tsx` open a chain — this file only ever
 * describes the chain, it never walks it.
 *
 * Copy is quoted verbatim from `docs/planned/glossary.md` — this is the minimum set the industry
 * panel's own chains need, plus `family` and `specialisation complex`, the glossary's one
 * documented cycle, needed to exercise it for real rather than hypothetically.
 */

export type TermId =
  | "realisedYield"
  | "potentialYield"
  | "resourceSlot"
  | "worked"
  | "locked"
  | "body"
  | "archetype"
  | "qualityBand"
  | "resource"
  | "building"
  | "family"
  | "specialisationComplex";

/**
 * One piece of a definition body: literal text, or a reference to another term. A reference
 * carries its own display text (`label`) rather than always falling back to the referenced term's
 * name, because the glossary's prose inflects a term mid-sentence ("resources", "body's") and the
 * quoted text must stay exact.
 */
export type TermBodySegment =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "term"; readonly id: TermId; readonly label: string };

export interface TermDefinition {
  readonly id: TermId;
  /** The term's name, as it appears bolded in the glossary — the trigger's default label. */
  readonly term: string;
  readonly body: readonly TermBodySegment[];
}

function text(value: string): TermBodySegment {
  return { kind: "text", text: value };
}

function ref(id: TermId, label: string): TermBodySegment {
  return { kind: "term", id, label };
}

export const TERMS: Readonly<Record<TermId, TermDefinition>> = {
  realisedYield: {
    id: "realisedYield",
    term: "Realised yield",
    body: [
      text(
        "The multiplier a system's extractors actually get, across the slots they sit on. Extractors take the best ground first, so it sits above ",
      ),
      ref("potentialYield", "potential yield"),
      text(" while only the best ground is worked and moves toward it as more slots are worked. "),
      ref("locked", "Locked"),
      text(" slots count toward "),
      ref("potentialYield", "potential yield"),
      text(" and can never be worked, so it need never arrive."),
    ],
  },
  potentialYield: {
    id: "potentialYield",
    term: "Potential yield",
    body: [
      text("The multiplier a "),
      ref("resource", "resource"),
      text("'s ground would give with every slot in the system "),
      ref("worked", "worked"),
      text(", "),
      ref("locked", "locked"),
      text(" bodies included."),
    ],
  },
  resourceSlot: {
    id: "resourceSlot",
    term: "Resource slot",
    body: [
      text("One workable place on a "),
      ref("body", "body"),
      text(" holding one "),
      ref("resource", "resource"),
      text(". A "),
      ref("body", "body"),
      text("'s slot count for a "),
      ref("resource", "resource"),
      text(" is how many it holds, and one extractor level works one slot."),
    ],
  },
  worked: {
    id: "worked",
    term: "Worked",
    body: [text("Marks the slots a system's built extractor levels are on, best ground first.")],
  },
  locked: {
    id: "locked",
    term: "Locked",
    body: [
      text("Marks a "),
      ref("body", "body"),
      text(" no technology can reach yet. Its slots count toward "),
      ref("potentialYield", "potential yield"),
      text(" and can never be worked."),
    ],
  },
  body: {
    id: "body",
    term: "Body",
    body: [
      text(
        "A planet, belt or gas giant in a system. Everything physical a system has to offer sits on one.",
      ),
    ],
  },
  archetype: {
    id: "archetype",
    term: "Archetype",
    body: [
      text("A "),
      ref("body", "body"),
      text(
        "'s climate class, on a spectrum from frozen through temperate to volcanic. It fixes the ",
      ),
      ref("body", "body"),
      text("'s habitability, its habitable land, and which "),
      ref("resource", "resource"),
      text("s it can hold."),
    ],
  },
  qualityBand: {
    id: "qualityBand",
    term: "Quality band",
    body: [
      text("How rich a "),
      ref("body", "body"),
      text("'s slots of a "),
      ref("resource", "resource"),
      text(" are: poor, average, good or rich. It multiplies what an extractor working them yields."),
    ],
  },
  resource: {
    id: "resource",
    term: "Resource",
    body: [
      text("One of the seven kinds of thing a "),
      ref("body", "body"),
      text("'s ground holds: gas, minerals, ore, biomass, arable, water or radioactive."),
    ],
  },
  building: {
    id: "building",
    term: "Building",
    body: [
      text(
        "One kind of works a system has put up: an extractor, a factory, housing, an academy, a ",
      ),
      ref("specialisationComplex", "specialisation complex"),
      text(" or a construction centre. A building's count is its number of levels."),
    ],
  },
  family: {
    id: "family",
    term: "Family",
    body: [
      text(
        "One of the five groups the processed and advanced goods fall into: heavy industry, chemicals, electronics, armaments and consumer. Each has its own ",
      ),
      ref("specialisationComplex", "specialisation complex"),
      text("."),
    ],
  },
  specialisationComplex: {
    id: "specialisationComplex",
    term: "Specialisation complex",
    body: [
      text("A "),
      ref("building", "building"),
      text(" that produces nothing and raises the yield of every good in its "),
      ref("family", "family"),
      text(" made in that system. A system may hold one complex, of one "),
      ref("family", "family"),
      text("."),
    ],
  },
};
