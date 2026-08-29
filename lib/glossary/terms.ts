/**
 * The player-facing glossary as pure data — no JSX, no React import, no dependency on
 * `components/`. A definition's body is a sequence of segments rather than a rendered node
 * specifically so a component can render one level at a time: the `family` / `specialisation
 * complex` cycle below is real (each names the other), and eager rendering of a body's own
 * references would recurse forever. A segment is either plain text or a reference to another
 * `TermId`, which is what lets `components/ui/term-label.tsx` open a chain — this file only ever
 * describes the chain, it never walks it.
 *
 * Copy is quoted verbatim from `docs/planned/glossary.md` — this carries the whole written
 * glossary, one entry per bolded term in that doc's "## Definitions" section, grouped in the
 * doc's own order.
 */

export type TermId =
  // Time and scale
  | "cycle"
  | "dayMonthYear"
  | "ust"
  | "developmentPoints"
  // People
  | "population"
  | "popCap"
  | "housing"
  | "occupancy"
  | "habitableLand"
  | "workforce"
  | "skillGrades"
  | "skillCeiling"
  | "academy"
  | "staffing"
  | "unemployed"
  | "migration"
  | "colonistDelivery"
  | "abandonment"
  // Wellbeing
  | "provision"
  | "expectation"
  | "grievance"
  | "provisionBands"
  | "famine"
  | "unrest"
  | "stability"
  | "strike"
  | "survivalGoods"
  | "need"
  | "satisfaction"
  // Ground
  | "body"
  | "archetype"
  | "settled"
  | "habitability"
  | "settledHabitability"
  | "resource"
  | "resourceSlot"
  | "qualityBand"
  | "potentialYield"
  | "realisedYield"
  | "worked"
  | "locked"
  | "orbitRing"
  | "starClass"
  | "danger"
  // Industry
  | "building"
  | "builtStaffedFree"
  | "decay"
  | "idleReason"
  | "recipe"
  | "inputGate"
  | "tier"
  | "family"
  | "specialisationComplex"
  | "healthStates"
  // Trade and money
  | "stock"
  | "price"
  | "demand"
  | "surplus"
  | "deficit"
  | "haul"
  | "treasury"
  | "taxLevel"
  | "budgetBand"
  | "fundedFraction"
  | "charterFee"
  | "manifest"
  // Territory and politics
  | "ownershipLadder"
  | "claim"
  | "colonise"
  | "colony"
  | "faction"
  | "government"
  | "doctrine"
  | "factionStatus"
  | "relationScore"
  | "relationTiers"
  | "alliance"
  | "region"
  | "jumpLane"
  | "fuelCost"
  | "gateway"
  // The player's layer
  | "automationSwitch"
  | "pin"
  | "trackerSection"
  | "alertCategory"
  | "alertTiers"
  | "fundedFront"
  | "ghostRow";

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
  // ── Time and scale ──
  cycle: {
    id: "cycle",
    term: "Cycle",
    body: [
      text(
        'Six days. The period all slow change is measured over, and the basis of any rate written "per cycle".',
      ),
    ],
  },
  dayMonthYear: {
    id: "dayMonthYear",
    term: "Day, month, year",
    body: [text("Thirty days to a month, twelve months to a year. Dates count from 2350.")],
  },
  ust: {
    id: "ust",
    term: "UST",
    body: [text("Universal Standard Time. The time standard kept across every world.")],
  },
  developmentPoints: {
    id: "developmentPoints",
    term: "Development points",
    body: [
      text("A measure of how built up a system is, counting "),
      ref("population", "population"),
      text(", licensed skilled work, "),
      ref("builtStaffedFree", "staffed"),
      text(" industry and a "),
      ref("specialisationComplex", "specialisation complex"),
      text(", weighted toward advanced industry."),
    ],
  },

  // ── People ──
  population: {
    id: "population",
    term: "Population",
    body: [
      text(
        "The people living in a system. It is a single pool that every job draws on; skill is not a kind of person.",
      ),
    ],
  },
  popCap: {
    id: "popCap",
    term: "Pop cap",
    body: [
      text("The "),
      ref("population", "population"),
      text(" a system's "),
      ref("housing", "housing"),
      text(" can hold."),
    ],
  },
  housing: {
    id: "housing",
    term: "Housing",
    body: [
      text("The "),
      ref("building", "buildings"),
      text(" people live in. They are the only "),
      ref("building", "buildings"),
      text(" that take "),
      ref("habitableLand", "habitable land"),
      text(", and the only thing that raises "),
      ref("popCap", "pop cap"),
      text("."),
    ],
  },
  occupancy: {
    id: "occupancy",
    term: "Occupancy",
    body: [
      text("How full a system's "),
      ref("housing", "housing"),
      text(" is: its "),
      ref("population", "population"),
      text(" against its "),
      ref("popCap", "pop cap"),
      text("."),
    ],
  },
  habitableLand: {
    id: "habitableLand",
    term: "Habitable land",
    body: [
      text("The ground a "),
      ref("body", "body"),
      text(" offers for settlement, and the budget "),
      ref("housing", "housing"),
      text(" is built against. Only "),
      ref("body", "bodies"),
      text(" habitable enough to settle carry any."),
    ],
  },
  workforce: {
    id: "workforce",
    term: "Workforce",
    body: [
      text("A system's "),
      ref("population", "population"),
      text(" counted as labour, at any grade."),
    ],
  },
  skillGrades: {
    id: "skillGrades",
    term: "Unskilled, technician, engineer",
    body: [
      text("The three grades of work a job can call for. A "),
      ref("building", "building"),
      text("'s "),
      ref("staffing", "staffing"),
      text(
        " is a fixed split across the three, and the same people fill whichever grade they are licensed for.",
      ),
    ],
  },
  skillCeiling: {
    id: "skillCeiling",
    term: "Skill ceiling",
    body: [
      text("The limit on how many people may work at a skilled grade, set by the system's "),
      ref("academy", "academies"),
      text(". Jobs above the ceiling stay empty however large the "),
      ref("population", "population"),
      text(" is."),
    ],
  },
  academy: {
    id: "academy",
    term: "Academy",
    body: [
      text("A vocational school or a research institute. Neither produces a good; each raises one "),
      ref("skillCeiling", "skill ceiling"),
      text(
        ", and together they are the licensing family in the industry and construction ledgers.",
      ),
    ],
  },
  staffing: {
    id: "staffing",
    term: "Staffing",
    body: [
      text("The people a "),
      ref("building", "building"),
      text(" needs to run. A "),
      ref("building", "building"),
      text(" whose jobs are half filled produces half as much."),
    ],
  },
  unemployed: {
    id: "unemployed",
    term: "Unemployed",
    body: [
      text(
        "People housed and fed but working no job, either because none is built or because no ",
      ),
      ref("skillCeiling", "skill ceiling"),
      text(" licenses them for it."),
    ],
  },
  migration: {
    id: "migration",
    term: "Migration",
    body: [
      ref("population", "Population"),
      text(" moving between a "),
      ref("faction", "faction"),
      text("'s own "),
      ref("ownershipLadder", "developed"),
      text(
        " systems, toward the calmer, emptier and more job-rich ones. Nobody moves toward a world in ",
      ),
      ref("famine", "Famine"),
      text("."),
    ],
  },
  colonistDelivery: {
    id: "colonistDelivery",
    term: "Colonist delivery",
    body: [
      text("Spare "),
      ref("population", "population"),
      text(" routed from a "),
      ref("faction", "faction"),
      text("'s "),
      ref("ownershipLadder", "developed"),
      text(" systems out to its emptiest ones, and the main way a newly "),
      ref("ownershipLadder", "developed"),
      text(" system fills."),
    ],
  },
  abandonment: {
    id: "abandonment",
    term: "Abandonment",
    body: [
      text("The end of a "),
      ref("ownershipLadder", "developed"),
      text(" system whose "),
      ref("population", "population"),
      text(" runs out, "),
      ref("famine", "famine"),
      text(" or not. Its "),
      ref("building", "buildings"),
      text(" are lost and the system reverts to "),
      ref("ownershipLadder", "unclaimed"),
      text(" frontier, claimable again."),
    ],
  },

  // ── Wellbeing ──
  provision: {
    id: "provision",
    term: "Provision",
    body: [
      text(
        "The share of what a world needs that actually arrives, weighted by how badly it needs each good.",
      ),
    ],
  },
  expectation: {
    id: "expectation",
    term: "Expectation",
    body: [
      text("The "),
      ref("provision", "Provision"),
      text(" a world's "),
      ref("population", "population"),
      text(" has grown accustomed to."),
    ],
  },
  grievance: {
    id: "grievance",
    term: "Grievance",
    body: [
      text("How far a world's "),
      ref("provision", "Provision"),
      text(" falls short of its own "),
      ref("expectation", "expectation"),
      text("."),
    ],
  },
  provisionBands: {
    id: "provisionBands",
    term: "Supplied, Strained, Rationing, Deprived",
    body: [
      text("The four bands a world's "),
      ref("provision", "Provision"),
      text(
        " falls into, best to worst. They are description only: no rate or effect keys off the band.",
      ),
    ],
  },
  famine: {
    id: "famine",
    term: "Famine",
    body: [
      text("Water or food arriving far short of what a world needs. It reads in place of "),
      ref("provisionBands", "the four bands"),
      text(" at any "),
      ref("provision", "Provision"),
      text(", and it drives "),
      ref("unrest", "unrest"),
      text(" at the steepest rate any shortage can."),
    ],
  },
  unrest: {
    id: "unrest",
    term: "Unrest",
    body: [
      text(
        "How angry a world is. It climbs and falls gradually toward the level its causes justify: ",
      ),
      ref("grievance", "grievance"),
      text(", tax pressure and crowding."),
    ],
  },
  stability: {
    id: "stability",
    term: "Stability",
    body: [
      text("The calm of a world, read as the inverse of its "),
      ref("unrest", "unrest"),
      text("."),
    ],
  },
  strike: {
    id: "strike",
    term: "Strike",
    body: [
      text("The work a world stops doing once "),
      ref("unrest", "unrest"),
      text(" is high enough. Production falls further the higher "),
      ref("unrest", "unrest"),
      text(" climbs; consumption never falls with it."),
    ],
  },
  survivalGoods: {
    id: "survivalGoods",
    term: "Survival goods",
    body: [
      text("Water and food. A world short of either is in "),
      ref("famine", "Famine"),
      text("."),
    ],
  },
  need: {
    id: "need",
    term: "Need",
    body: [
      text("One good a world's civilians want, and how much of it they want per "),
      ref("cycle", "cycle"),
      text(". Industry's draw on the same good is counted separately."),
    ],
  },
  satisfaction: {
    id: "satisfaction",
    term: "Satisfaction",
    body: [
      text("The share of one good's "),
      ref("demand", "demand"),
      text(" that was delivered last "),
      ref("cycle", "cycle"),
      text("."),
    ],
  },

  // ── Ground ──
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
      text("'s "),
      ref("habitability", "habitability"),
      text(", its "),
      ref("habitableLand", "habitable land"),
      text(", and which "),
      ref("resource", "resource"),
      text("s it can hold."),
    ],
  },
  settled: {
    id: "settled",
    term: "Settled",
    body: [text("Marks a "), ref("body", "body"), text(" people live on.")],
  },
  habitability: {
    id: "habitability",
    term: "Habitability",
    body: [
      text("How well a "),
      ref("body", "body"),
      text(
        "'s ground supports ordinary life, as a percentage of normal. A ",
      ),
      ref("body", "body"),
      text(" below the settleable line offers no "),
      ref("habitableLand", "habitable land"),
      text(" at all."),
    ],
  },
  settledHabitability: {
    id: "settledHabitability",
    term: "Settled habitability",
    body: [
      text("A system's own "),
      ref("habitability", "habitability"),
      text(" figure: the land-weighted mean across the "),
      ref("body", "bodies"),
      text(" its "),
      ref("population", "population"),
      text(" actually occupies, best "),
      ref("body", "body"),
      text(" first. It falls as "),
      ref("population", "population"),
      text(" spreads onto worse worlds, and it multiplies "),
      ref("population", "population"),
      text(" growth."),
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
  orbitRing: {
    id: "orbitRing",
    term: "Orbit ring",
    body: [
      text("Which ring out from the star a "),
      ref("body", "body"),
      text(" is drawn on. Decoration: nothing in the game reads it."),
    ],
  },
  starClass: {
    id: "starClass",
    term: "Star class",
    body: [
      text(
        "A system's sun, from red dwarf through orange and yellow to blue-white. It decides which ",
      ),
      ref("archetype", "archetypes"),
      text(" can form there, and two of the four classes can hold no settleable "),
      ref("body", "body"),
      text(" at all."),
    ],
  },
  danger: {
    id: "danger",
    term: "Danger",
    body: [
      text("A system's hazard rating, from its "),
      ref("government", "government"),
      text(" and the kinds of "),
      ref("body", "body"),
      text(" it holds. A readout only; nothing acts on it yet."),
    ],
  },

  // ── Industry ──
  building: {
    id: "building",
    term: "Building",
    body: [
      text("One kind of works a system has put up: an extractor, a factory, "),
      ref("housing", "housing"),
      text(", an "),
      ref("academy", "academy"),
      text(", a "),
      ref("specialisationComplex", "specialisation complex"),
      text(" or a construction centre. A building's count is its number of levels."),
    ],
  },
  builtStaffedFree: {
    id: "builtStaffedFree",
    term: "Built, staffed, free",
    body: [
      text("Built is the levels a "),
      ref("building", "building"),
      text(
        " has standing, staffed the levels actually worked; an industry row reads staffed over built. Free is the room left to build into, and it sits on the panel's land cards rather than on a row. For ",
      ),
      ref("housing", "housing"),
      text(" the staffed figure is "),
      ref("occupancy", "occupancy"),
      text(" carrying "),
      ref("decay", "decay"),
      text("'s vacancy allowance; for "),
      ref("academy", "academies"),
      text(" and "),
      ref("specialisationComplex", "complexes"),
      text(" it is the draw on the "),
      ref("skillCeiling", "skill ceiling"),
      text(" or "),
      ref("family", "family"),
      text(" yield they provide."),
    ],
  },
  decay: {
    id: "decay",
    term: "Decay",
    body: [
      text("The steady loss of "),
      ref("building", "building"),
      text(
        " levels a system is not using. It only ever removes levels, and high ",
      ),
      ref("unrest", "unrest"),
      text(" tears them down even while they are in use."),
    ],
  },
  idleReason: {
    id: "idleReason",
    term: "Idle reason",
    body: [
      text("The one constraint holding a "),
      ref("building", "building"),
      text("'s idle levels back: "),
      ref("staffing", "staffing"),
      text(", a "),
      ref("skillCeiling", "skill ceiling"),
      text(", missing "),
      ref("recipe", "recipe"),
      text(" inputs, output it cannot sell, or empty "),
      ref("housing", "housing"),
      text("."),
    ],
  },
  recipe: {
    id: "recipe",
    term: "Recipe",
    body: [
      text("What one unit of a good is made from. Every good above "),
      ref("tier", "raw"),
      text(" has one."),
    ],
  },
  inputGate: {
    id: "inputGate",
    term: "Input gate",
    body: [
      text("How far below full output a "),
      ref("building", "building"),
      text(" runs for want of a "),
      ref("recipe", "recipe"),
      text(
        " input. A shortage passes down the chain, throttling every good made from the good it throttled.",
      ),
    ],
  },
  tier: {
    id: "tier",
    term: "Tier: raw, processed, advanced",
    body: [
      text(
        "What a good is made from. Raw goods come out of the ground, processed goods are made from raw ones, advanced goods from processed. Everything above raw needs skilled work.",
      ),
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
  healthStates: {
    id: "healthStates",
    term: "Stable, idle, contracting, collapsing",
    body: [
      text("The four health states of a "),
      ref("building", "building"),
      text(
        ". Stable is holding; idle is a whole level doing nothing for want of a ",
      ),
      ref("recipe", "recipe"),
      text(" input, which "),
      ref("decay", "decay"),
      text(" cannot see; contracting is a whole level "),
      ref("decay", "decay"),
      text(" is about to shed; collapsing is "),
      ref("unrest", "unrest"),
      text(" tearing levels down."),
    ],
  },

  // ── Trade and money ──
  stock: {
    id: "stock",
    term: "Stock",
    body: [text("How much of a good a system's market is holding.")],
  },
  price: {
    id: "price",
    term: "Price",
    body: [
      text("What a good fetches at one system's market. It rises as "),
      ref("stock", "stock"),
      text(" falls short of what that system "),
      ref("demand", "demands"),
      text(" and falls as "),
      ref("stock", "stock"),
      text(" builds up, within a floor and a ceiling that market sets itself."),
    ],
  },
  demand: {
    id: "demand",
    term: "Demand",
    body: [
      text("How much of a good a system wants per "),
      ref("cycle", "cycle"),
      text(", its people's "),
      ref("need", "needs"),
      text(" and its factories' "),
      ref("recipe", "recipe"),
      text(" draw together."),
    ],
  },
  surplus: {
    id: "surplus",
    term: "Surplus",
    body: [
      text("More of a good than a system needs to keep in hand, and so drawable by a "),
      ref("haul", "haul"),
      text("."),
    ],
  },
  deficit: {
    id: "deficit",
    term: "Deficit",
    body: [
      text("Less of a good than a system needs in hand, and so a target for a "),
      ref("haul", "haul"),
      text("."),
    ],
  },
  haul: {
    id: "haul",
    term: "Haul",
    body: [
      text("One shipment of a good from a "),
      ref("faction", "faction"),
      text("'s own "),
      ref("surplus", "surplus"),
      text(" to one of its own "),
      ref("deficit", "deficits"),
      text(". Hauls are the only way goods move between systems."),
    ],
  },
  treasury: {
    id: "treasury",
    term: "Treasury",
    body: [
      text("A "),
      ref("faction", "faction"),
      text("'s money: what its taxes collect, what its bills drain, and what it has left. Every "),
      ref("faction", "faction"),
      text(" runs one."),
    ],
  },
  taxLevel: {
    id: "taxLevel",
    term: "Tax level",
    body: [
      text("A "),
      ref("faction", "faction"),
      text(
        "'s tax stance, in five steps from very low to very high. A higher step collects more from the same activity and raises ",
      ),
      ref("unrest", "unrest"),
      text(" on every world the "),
      ref("faction", "faction"),
      text(" owns."),
    ],
  },
  budgetBand: {
    id: "budgetBand",
    term: "Budget band",
    body: [
      text("One of the three things a "),
      ref("faction", "faction"),
      text(
        " spends on: maintenance, logistics and construction. Each has a slider setting what share of that band's bill the ",
      ),
      ref("faction", "faction"),
      text(
        " is willing to pay, and the three are settled in that order with nothing on credit.",
      ),
    ],
  },
  fundedFraction: {
    id: "fundedFraction",
    term: "Funded fraction",
    body: [
      text("The share of a "),
      ref("budgetBand", "band"),
      text("'s bill that was actually paid, and the share of that "),
      ref("budgetBand", "band"),
      text("'s work that runs the following "),
      ref("cycle", "cycle"),
      text("."),
    ],
  },
  charterFee: {
    id: "charterFee",
    term: "Charter fee",
    body: [
      text("The one-off price of committing to a "),
      ref("colonise", "colonisation"),
      text(", taken off the "),
      ref("treasury", "treasury"),
      text(" before the "),
      ref("budgetBand", "budget bands"),
      text(" divide anything."),
    ],
  },
  manifest: {
    id: "manifest",
    term: "Manifest",
    body: [
      text("The goods a "),
      ref("colony", "colony"),
      text(" is stocked with while it is being "),
      ref("colonise", "colonised"),
      text(", staged and paid for "),
      ref("cycle", "cycle"),
      text(" by "),
      ref("cycle", "cycle"),
      text(" and credited to its market when it opens."),
    ],
  },

  // ── Territory and politics ──
  ownershipLadder: {
    id: "ownershipLadder",
    term: "Unclaimed, controlled, developed",
    body: [
      text("The three states a system can be in. Unclaimed is open frontier, controlled is "),
      ref("claim", "claimed"),
      text(
        " ground with nobody on it, and developed is a working system. Only a developed system has ",
      ),
      ref("population", "population"),
      text(", a market or industry."),
    ],
  },
  claim: {
    id: "claim",
    term: "Claim",
    body: [
      text("Stake an "),
      ref("ownershipLadder", "unclaimed"),
      text(" system as "),
      ref("ownershipLadder", "controlled"),
      text(
        ". A claim is cheap and near-instant, and it takes the ground without putting anyone on it.",
      ),
    ],
  },
  colonise: {
    id: "colonise",
    term: "Colonise",
    body: [
      text("Take a "),
      ref("ownershipLadder", "controlled"),
      text(" system to "),
      ref("ownershipLadder", "developed"),
      text(", bringing its first "),
      ref("population", "population"),
      text(". It is paid for with a "),
      ref("charterFee", "charter fee"),
      text(", a "),
      ref("manifest", "manifest"),
      text(" and construction work, and it takes time to finish."),
    ],
  },
  colony: {
    id: "colony",
    term: "Colony",
    body: [
      text("A "),
      ref("ownershipLadder", "controlled"),
      text(" system with a "),
      ref("colonise", "colonisation"),
      text(
        " under way, from the moment the work is commissioned to the moment it completes and the system turns ",
      ),
      ref("ownershipLadder", "developed"),
      text("."),
    ],
  },
  faction: {
    id: "faction",
    term: "Faction",
    body: [
      text("One of the powers dividing the galaxy, the player's own included. Each holds territory and runs a "),
      ref("treasury", "treasury"),
      text("."),
    ],
  },
  government: {
    id: "government",
    term: "Government",
    body: [
      text("A "),
      ref("faction", "faction"),
      text("'s form of rule, one of eight. It shapes the "),
      ref("faction", "faction"),
      text("'s economic character, its default "),
      ref("taxLevel", "tax level"),
      text(" and which events find it."),
    ],
  },
  doctrine: {
    id: "doctrine",
    term: "Doctrine",
    body: [
      text("A "),
      ref("faction", "faction"),
      text("'s political temperament, one of five. It biases who a "),
      ref("faction", "faction"),
      text(" will ally with and how readily it reaches for force."),
    ],
  },
  factionStatus: {
    id: "factionStatus",
    term: "Faction status",
    body: [
      text("How large a "),
      ref("faction", "faction"),
      text(
        " stands against every other: dominant, major, regional or minor. It follows from expansion.",
      ),
    ],
  },
  relationScore: {
    id: "relationScore",
    term: "Relation score",
    body: [
      text("How two "),
      ref("faction", "factions"),
      text(" regard each other, from -100 to +100. It drifts on shared borders, "),
      ref("doctrine", "doctrine"),
      text(", "),
      ref("government", "government"),
      text(", trade and standing "),
      ref("alliance", "alliances"),
      text(", and peace left unmaintained drifts downward on its own."),
    ],
  },
  relationTiers: {
    id: "relationTiers",
    term: "Allied, friendly, neutral, unfriendly, hostile",
    body: [
      text("The five tiers a "),
      ref("relationScore", "relation score"),
      text(
        " falls into. Dropping to unfriendly opens border conflicts; holding high enough for long enough allows an ",
      ),
      ref("alliance", "alliance"),
      text("."),
    ],
  },
  alliance: {
    id: "alliance",
    term: "Alliance",
    body: [
      text("A standing agreement between two "),
      ref("faction", "factions"),
      text(", formed after a period of negotiation at a high "),
      ref("relationScore", "relation score"),
      text(" and dissolved when the score falls back."),
    ],
  },
  region: {
    id: "region",
    term: "Region",
    body: [
      text(
        "A named division of the map that a system belongs to. It orients the player and carries a dominant-economy label; it does not bound anyone's territory.",
      ),
    ],
  },
  jumpLane: {
    id: "jumpLane",
    term: "Jump lane",
    body: [
      text(
        "A connection between two systems. Goods, people and ships all move along lanes and nowhere else.",
      ),
    ],
  },
  fuelCost: {
    id: "fuelCost",
    term: "Fuel cost",
    body: [
      text("What crossing one "),
      ref("jumpLane", "jump lane"),
      text(" costs. It sets how far "),
      ref("haul", "hauls"),
      text(" and "),
      ref("migration", "migration"),
      text(" reach, and "),
      ref("gateway", "gateway"),
      text(" lanes cost the most."),
    ],
  },
  gateway: {
    id: "gateway",
    term: "Gateway",
    body: [
      text("A system holding the lanes between two "),
      ref("region", "regions"),
      text(", and the chokepoint anything crossing that border must pass."),
    ],
  },

  // ── The player's layer ──
  automationSwitch: {
    id: "automationSwitch",
    term: "Automation switch",
    body: [
      text("A per-domain toggle on the player's "),
      ref("faction", "faction"),
      text(". With building or "),
      ref("colonise", "colonising"),
      text(" switched off the "),
      ref("faction", "faction"),
      text(
        " proposes no new work of that kind; work already committed carries on, and orders given by hand always do.",
      ),
    ],
  },
  pin: {
    id: "pin",
    term: "Pin",
    body: [text("A system the player has marked to keep in the Tracker.")],
  },
  trackerSection: {
    id: "trackerSection",
    term: "Tracker section",
    body: [
      text("One of the Tracker's three lists — "),
      ref("pin", "pinned"),
      text(" systems, building, "),
      ref("colonise", "colonising"),
      text(" — each of which can be shown or hidden."),
    ],
  },
  alertCategory: {
    id: "alertCategory",
    term: "Alert category",
    body: [
      text(
        "One condition the alert bar watches for. Its chip appears the moment anything matches and clears the moment nothing does.",
      ),
    ],
  },
  alertTiers: {
    id: "alertTiers",
    term: "Critical, important, informational",
    body: [
      text("The three tiers "),
      ref("alertCategory", "alert categories"),
      text(" are ordered by. Critical is always shown and cannot be hidden."),
    ],
  },
  fundedFront: {
    id: "fundedFront",
    term: "Funded front",
    body: [
      text("The construction work a "),
      ref("faction", "faction"),
      text("'s pool is actually paying for this "),
      ref("cycle", "cycle"),
      text(". Anything behind the front is queued but not progressing."),
    ],
  },
  ghostRow: {
    id: "ghostRow",
    term: "Ghost row",
    body: [
      text("A "),
      ref("building", "building"),
      text(
        " still under construction, shown in the industry ledger where it will sit once it is finished, with its progress and an estimated finish.",
      ),
    ],
  },
};
