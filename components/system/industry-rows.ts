/**
 * Pure view-model for the Industry tab's tables — per-resource deposit rows and the
 * general-land partition. No DOM, no React. Row health is grounded in the decay engine
 * (`buildingHealth`). The only health this file computes is a deposit row's, and an extractor has no
 * recipe gate — `buildIndustryReadout` never names its idle reason "inputs" for a tier-0 building —
 * so a deposit row's health can never read "idle"; every indicator here still matches what actually
 * decays exactly (see `buildingHealth`).
 */
import type { ResourceType, QualityBandId } from "@/lib/types/game";
import { BUILDING_TYPES } from "@/lib/constants/industry";
import { buildingHealth, housingUsed } from "@/lib/engine/industry";
import type { SystemDepositSummary, SystemIndustryReadout, IndustryHealth, IdleReason } from "@/lib/engine/industry";
import { buildProblems, type ProblemItem } from "@/components/system/needs-view";

/** Severity ordering for the worst-of-contributors aggregation (collapsing is worst, idle sits
 *  between stable and contracting — real idleness, but not a state decay will act on). */
const SEVERITY: Record<IndustryHealth, number> = { stable: 0, idle: 1, contracting: 2, collapsing: 3 };

/**
 * The Staffed-column figure for one building entry — the single definition shared by the deposit
 * table (`depositRows`, below) and the general-land table (`BuildingRow` in industry-panel.tsx), so
 * the two feeds can't drift back apart the way the old `used`-column rename did.
 *
 * Housing (`tier === -1`, the readout's own housing sentinel — see `industry.ts:569-570`, also used
 * this way at `industry-panel.tsx`'s buildingGroups filter) is the one row type that must NOT read
 * `staffedFraction × count`: housing's `staffedFraction` is deliberately uncapped bare occupancy
 * (`industry.ts:745-749`), so it can read past `count` on an overcrowded system. Nor does it read
 * `used` any more — `used` (`capacityUsed`, `industry.ts:406-415`) folds a vacancy allowance
 * (`VACANCY_SLACK`) into the display figure, which is exactly the case "An allowance never goes
 * inside a displayed number" (`docs/active/glossary.md`) forbids: a system at 91% real occupancy
 * read `379 / 379`. Given a `population`, housing instead reads the true figure,
 * `min(count, housingUsed(population))` — the allowance stays inside decay, invisible on screen. The
 * row's health colouring is unaffected: `buildingHealth` is called elsewhere with `used` directly,
 * never through this function. Without a `population` (a caller with no occupancy figure to hand,
 * e.g. a bare fixture) housing falls back to `used`. Every other row type keeps
 * `staffedFraction × count` regardless of `population`: for academies/complexes/support
 * `staffedFraction` is already defined as `used / count`, so this is a no-op there; for
 * producers/extractors it is pure staffed labour, not gated by selling — the intended change.
 */
export function staffedLevels(
  b: Pick<SystemIndustryReadout["buildings"][number], "tier" | "used" | "staffedFraction" | "count">,
  population?: number,
): number {
  if (b.tier === -1) {
    return population === undefined ? b.used : Math.min(b.count, housingUsed(population));
  }
  return b.staffedFraction * b.count;
}

/**
 * Whole idle levels across a system's buildings, split by whether infrastructure decay can SEE the
 * idleness — exactly the two arguments `industryHealth` takes, named to match so a call site cannot
 * cross them.
 *
 * A level sheds only when a WHOLE level is idle (`floor(built − used) ≥ 1`) for a reason decay can
 * see. "inputs" is the one reason it cannot: `computeSystemDecay`'s context carries no market stock,
 * so a factory idle purely for want of a recipe input will never shed. Counting those levels into
 * `idleLevels` would make the system chip claim a shed is coming when nothing will shed, which is the
 * whole reason the split exists.
 */
export interface IdleLevelSplit {
  /** Whole levels idle for a decay-visible reason (labour, a skill ceiling, a stalled sell-through,
   *  housing occupancy) — the levels decay actually sheds. Reads "contracting". */
  idleLevels: number;
  /** Whole levels idle ONLY because recipe inputs never arrived — real idleness that decay cannot
   *  see and will never act on. Reads "idle". */
  idleOnlyLevels: number;
}

export function idleLevelSplit(
  buildings: readonly Pick<SystemIndustryReadout["buildings"][number], "count" | "used" | "idleReason">[],
): IdleLevelSplit {
  let idleLevels = 0;
  let idleOnlyLevels = 0;
  for (const b of buildings) {
    const levels = Math.max(0, Math.floor(b.count - b.used));
    if (levels <= 0) continue;
    if (b.idleReason === "inputs") idleOnlyLevels += levels;
    else idleLevels += levels;
  }
  return { idleLevels, idleOnlyLevels };
}

/** One catalog extractor type's contribution to a shared deposit — the per-type breakdown under a
 *  resource worked by more than one building type. Zeroed with health "stable" when nothing's built. */
export interface DepositTypeRow {
  buildingType: string;
  /**
   * The good this type extracts (`BUILDING_TYPES[buildingType].outputGood`) — carried rather than
   * left for the caller to assume it equals `buildingType`. `buildingType → outputGood` is
   * deliberately many-to-one (`lib/constants/industry.ts`) so a denser `*_mk2` type can be a pure
   * data addition, and the moment one exists, keying a per-good lookup (pop needs, supply chain) by
   * the building type would silently miss. `undefined` only for a type that produces no good, which
   * no extractor is — the optionality mirrors the catalog field's own.
   */
  outputGood?: string;
  built: number;
  /** Staffed capacity for this type (`staffedLevels`) — pure labour, not gated by selling. */
  staffed: number;
  output: number;
  health: IndustryHealth;
  /**
   * This type's own staffing ratio and binding idle reason, carried straight off its `BuildingEntry`
   * (`staffed` above is `staffedFraction × built`, so this is the same ratio, not a second figure) —
   * exactly the shape `buildProblems` (`needs-view.ts`) needs for its `staffing` argument. `idleReason`
   * is `undefined` for the zeroed catalog entry `depositRows` emits when nothing of this type is built
   * (see below) — there is nothing to explain for a building that doesn't exist. Tier-0 extractors
   * carry no skilled labour and no recipe, so this only ever names "labour" (unskilled short) or
   * "selling" (glut) — never skill1/skill2, and never "inputs" (`inputGate` is 1 with no recipe,
   * `industry.ts:787`) — so `health` below can never read "idle" for an extractor either.
   */
  staffedFraction: number;
  idleReason?: IdleReason;
}

export interface DepositRow {
  resource: ResourceType;
  /** Worked-prefix mean GROUND VALUE — the number production actually uses, and the row's sole
   *  table-cell figure (`SystemDepositSummary["yieldMult"]`'s own docstring covers the units). */
  yieldMult: number;
  /** The ground value the NEXT extractor built here would realise, and which body hosts it — the
   *  tooltip's closing line, never the table cell. `null` once every slot is worked. Typed off
   *  `SystemDepositSummary` rather than re-declared so the two can never drift apart. */
  marginal: SystemDepositSummary["marginal"];
  band: QualityBandId;
  /** The worked prefix broken out by hosting body — the tooltip's per-body breakdown. Typed off
   *  `SystemDepositSummary` for the same reason as `marginal`. */
  workedByBody: SystemDepositSummary["workedByBody"];
  /** Total deposit slots — the capacity ceiling. */
  depositCounts: number;
  /** Extractor levels built on this resource's slots. */
  built: number;
  /**
   * Staffed capacity across the built levels (Σ `staffedLevels` — pure labour, not gated by
   * selling). NOT the decay-relevant amount — that stays `used` (health below is grounded in it),
   * so a row can read fully staffed while its health chip still shows contracting/collapsing from a
   * stalled sell-through.
   */
  staffed: number;
  /** Real output this cycle across the resource's extractors. */
  output: number;
  /** Worst health across the resource's extractors — drives the row indicator. */
  health: IndustryHealth;
  /**
   * One entry per catalog extractor type on this resource (BUILDING_TYPES[t].resource === resource),
   * in catalog order. A resource worked by a single type carries exactly one entry; a resource shared
   * by several types (e.g. arable → food + textiles) surfaces each type separately — including a type
   * with nothing built yet — so the player can see it exists and quick-add it.
   */
  types: DepositTypeRow[];
}

/**
 * Per-resource deposit rows, joining the per-resource deposit summary (slots, yield) to the
 * per-building extractor readout (built count, staffed capacity, output, health). A resource shared
 * by several goods (food + textiles → arable) sums their levels/working/output for the aggregate
 * fields and takes the worst contributor's health, while `types` keeps each contributing type's
 * own numbers so the shared pool doesn't hide how much of each good exists. Deposits arrive
 * richest-cap-first (summariseDeposits).
 *
 * `staffed` is `staffedLevels` (pure labour), not the staffed-and-selling `used` — a glutting
 * extractor still reads its full labour here; `used` remains the input to `buildingHealth` so the
 * row's health indicator never disagrees with what actually decays (and, since an extractor's
 * `idleReason` is never "inputs", `buildingHealth` never hands this row back "idle" either).
 */
export function depositRows(
  deposits: SystemDepositSummary[],
  extractors: SystemIndustryReadout["buildings"],
  unrest: number,
  unrestThreshold: number,
): DepositRow[] {
  type DepositResourceAgg = { built: number; staffed: number; output: number; health: IndustryHealth };
  const byResource = new Map<ResourceType, DepositResourceAgg>();
  // Keyed by buildingType: buildIndustryReadout emits at most one BuildingEntry per buildingType
  // (one push per `Object.entries(buildings)` key), so a type can never overwrite another's entry here.
  const byType = new Map<string, DepositTypeRow>();
  for (const b of extractors) {
    const def = BUILDING_TYPES[b.buildingType];
    const resource = def?.resource;
    if (!resource) continue;
    const h = buildingHealth({ used: b.used, built: b.count, unrest, unrestDecayThreshold: unrestThreshold, idleReason: b.idleReason });
    const staffed = staffedLevels(b);
    const acc: DepositResourceAgg = byResource.get(resource) ?? { built: 0, staffed: 0, output: 0, health: "stable" };
    acc.built += b.count;
    acc.staffed += staffed;
    acc.output += b.output ?? 0;
    if (SEVERITY[h] > SEVERITY[acc.health]) acc.health = h;
    byResource.set(resource, acc);
    byType.set(b.buildingType, {
      buildingType: b.buildingType,
      outputGood: def.outputGood,
      built: b.count,
      staffed,
      output: b.output ?? 0,
      health: h,
      staffedFraction: b.staffedFraction,
      idleReason: b.idleReason,
    });
  }
  return deposits
    .filter((d) => d.depositCounts > 0)
    .map((d) => {
      const agg: DepositResourceAgg = byResource.get(d.resource) ?? { built: 0, staffed: 0, output: 0, health: "stable" };
      const types = Object.keys(BUILDING_TYPES)
        .filter((t) => BUILDING_TYPES[t].resource === d.resource)
        .map((t): DepositTypeRow => byType.get(t) ?? { buildingType: t, outputGood: BUILDING_TYPES[t].outputGood, built: 0, staffed: 0, output: 0, health: "stable", staffedFraction: 0, idleReason: undefined });
      return { resource: d.resource, yieldMult: d.yieldMult, marginal: d.marginal, workedByBody: d.workedByBody, band: d.band, depositCounts: d.depositCounts, ...agg, types };
    });
}

/**
 * One extractor type's problem chips — the deposit-table analogue of `BuildingRow`'s
 * `buildProblems({ staffedFraction: b.staffedFraction, idleReason: b.idleReason }, supply, popNeed, label)`
 * call. Two of `buildProblems`'s three data arguments are meaningful here and one is not:
 *
 * - `supply` (input-gate throttle) is never meaningful for a tier-0 extractor: `buildIndustryReadout`
 *   only emits a `supplyChain` entry for a good with a recipe (`GOOD_RECIPES[goodId]`), and extractors
 *   have none — "tier-0 — always gated at 1, no signal" (industry.ts:817). Passed as `undefined`
 *   outright rather than looked up, so the always-empty lookup isn't mistaken for a real check.
 * - `popNeed` IS meaningful: every tier-0 good (food, water, ore, minerals, biomass, gas, textiles)
 *   carries a `GOOD_CONSUMPTION` rate, so pops draw on extracted goods directly, same as any producer's
 *   output.
 *
 * An unbuilt type (`built === 0` — the zeroed catalog entry `depositRows` emits for a not-yet-built
 * extractor type) never produces a chip: there is nothing to explain for a building that doesn't
 * exist, and `idleReason` is already `undefined` for it, but `staffedFraction` reads 0 (`needSeverity`
 * would call that "critical") — the explicit `built <= 0` guard, not a reliance on `idleReason` alone,
 * is what keeps an unbuilt row silent.
 */
export function depositTypeProblems(
  t: DepositTypeRow,
  popNeed: { satisfaction: number } | undefined,
  inputLabel: (goodId: string) => string,
): ProblemItem[] {
  if (t.built <= 0) return [];
  return buildProblems({ staffedFraction: t.staffedFraction, idleReason: t.idleReason }, undefined, popNeed, inputLabel);
}

/**
 * Parent-row problem chips for a deposit row. A resource worked by a single catalog type (the common
 * case) IS that type — its parent row carries that type's own chips verbatim (`row.types[0]`).
 *
 * A resource shared by several types (e.g. arable → food + textiles) is different: `health` already
 * aggregates that case with a worst-of-contributors reduction (`SEVERITY`, above) — the obvious
 * candidate to mirror here too. Rejected: health's worst-of picks a bare enum with no borrowed
 * magnitude or attribution, so "collapsing" is truthfully a property of the whole deposit regardless
 * of which contributor is collapsing. A problem chip is not that — its label carries a percentage and
 * sometimes a grade/good name that belongs to exactly one contributing type (`t.staffedFraction`,
 * `t.idleReason`, and its `popNeed` are all per-type). Reusing one type's figures on the parent row
 * would present that type's own shortfall as if it explained the whole shared deposit — the
 * misattribution this task calls out as a lie worth avoiding. Blending them instead (e.g. one type's
 * `idleReason` paired with the row's aggregate `staffed ÷ built`) is not a fix: the two are causally
 * linked per building, so pairing figures from different types produces a claim neither type actually
 * supports. So a multi-type deposit's parent row shows no chip; each type's own, correctly-attributed
 * chip renders on its own sub-row (`depositTypeProblems`) instead.
 */
export function depositRowProblems(
  row: DepositRow,
  popNeed: { satisfaction: number } | undefined,
  inputLabel: (goodId: string) => string,
): ProblemItem[] {
  if (row.types.length !== 1) return [];
  return depositTypeProblems(row.types[0], popNeed, inputLabel);
}
