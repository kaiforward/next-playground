/**
 * Alert bar read service — all sixteen categories (docs/build-plans/alert-bar.md tier table, lines
 * 98-115): the six state-derived categories (Famine, Deprived worlds, Strike, Unrest rising,
 * Overcrowded, No housing headroom), Survival stock falling, Demand unservable, Build blocked,
 * Industry idle, the faction-level Maintenance unfunded, the two automation-gated opportunity
 * categories (Build opportunity, Colony opportunity), and the three event bands (Crisis, Disruption,
 * Windfall).
 *
 * Everything is scoped to the player faction's DEVELOPED systems (alert-bar.md:293), which is also
 * `denominator` — the flyout footer's "N of D developed systems" (alert-bar.md:290-291). A world
 * with no player seat has nothing to alert on: reads empty rather than throwing, the same posture
 * `getTrackerData` takes for the same reason (lib/services/tracker.ts:34-37). The event categories and
 * Colony opportunity read a wider scope than `developed` (any system in the pair for a relations-owned
 * event; every player-owned system carrying a persisted candidacy reading for Colony opportunity) —
 * each says so at its own block — but every category still shares the one `denominator`, per
 * `AlertCategory`'s own contract.
 *
 * Categories are emitted in the registry's authored tier + order (alert-bar.md:343-345): every
 * `toCategory(...)` call below carries its own literal id, and the final array sorts on
 * `ALERT_CATEGORIES[id].tier` then `.order` — so the order is read from the registry, never
 * hand-duplicated here.
 *
 * Within a category, `instances` sort ascending by `sortKey`: smaller sorts first, and every
 * category picks its own `sortKey` so ascending always reads worst-first, per the tier table's own
 * "sorts by …" column — except the two opportunity categories, where "worst" is inverted to "best
 * opportunity first" (negated, the same convention Overcrowded and No housing headroom already use
 * for "biggest number is most urgent"). Build opportunity goes one step further and packs a SECOND
 * key (survival band) ahead of score, following `buildBlockedSortKey`'s own two-key precedent — see
 * `buildOpportunitySortKey`. See each category's block below for its measure and why smaller is worse
 * (or, for opportunities, why smaller is better).
 *
 * Demand unservable, Build opportunity and Colony opportunity read persisted planner terms
 * (`WorldMarket.unservedShortfall`, `WorldSystem.buildOpportunity`, `WorldSystem.colonyOpportunity`)
 * rather than re-deriving anything: the planner already computed and discarded these every run, and
 * an amendment to this task persisted them instead of the read-service proxies the first cut shipped
 * with (a demand RATE standing in for an unserved LEVEL, an addable-level count standing in for a
 * planner score, and a cost ratio standing in for the planner's own value/work ROI).
 */
import { getWorld } from "@/lib/world/store";
import type { WorldSystem, World } from "@/lib/world/types";
import { buildingsBySystem, marketsBySystem, systemNameById } from "@/lib/services/world-index";
import { resourceVectorFromColumns } from "@/lib/engine/resources";
import { isEconomicallyActive } from "@/lib/engine/control";
import {
  habitableHousingHeadroom, queuedBuildLevelsAt,
  type BuildSystemState, type BuildDropReason,
} from "@/lib/engine/directed-build";
import { buildIndustryReadout } from "@/lib/engine/industry";
import { useRatesByGood, type UseRate } from "@/lib/engine/honest-demand";
import { strikeMultiplier } from "@/lib/engine/population";
import { readExpectation } from "@/lib/engine/expectation";
import { STRIKE_PARAMS, EXPECTATION_PARAMS, ABANDON_POP_FLOOR } from "@/lib/constants/population";
import { HOUSING_TYPE } from "@/lib/constants/industry";
import { SURVIVAL_GOODS } from "@/lib/constants/physical-economy";
import { ALERT_CATEGORIES, BUILD_DROP_SEVERITY } from "@/lib/constants/alerts";
import { EVENT_BAND } from "@/lib/constants/ui";
import { EVENT_DEFINITIONS } from "@/lib/constants/events";
import type { AlertTier } from "@/lib/types/alerts";
import type { AlertData, AlertCategory, AlertInstance } from "@/lib/types/api";

const EMPTY_ALERT_DATA: AlertData = { categories: [] };

/** Band order, worst first, for the final categories array — critical chips lead, then important,
 *  then info. Not the event bands' own `EVENT_BAND_ORDER` (lib/constants/ui.ts): that ranks Crisis /
 *  Disruption / Windfall against each other as event TYPES; this ranks the sixteen alert CATEGORIES
 *  against each other by their authored `AlertTier`. */
const TIER_RANK: Record<AlertTier, number> = { critical: 0, important: 1, info: 2 };

/** Cycles-to-empty threshold for Survival stock falling — authored from remedy time (one logistics
 *  cycle for the matcher to route a haul, one for the goods to land, one of margin for the player to
 *  notice and act), not read off a distribution (alert-bar.md:1039-1067, settled at Gate 1). */
const SURVIVAL_STOCK_CYCLES_THRESHOLD = 3;

/**
 * Famine's non-shrinking branch sorts after every shrinking world (alert-bar.md:499-507: "a famine
 * world that is not shrinking carries no countdown at all, and sorts after the shrinking ones, by
 * shortfall depth"). The real countdown (`ln(population / ABANDON_POP_FLOOR) / k`) is unbounded
 * above as the decline rate k approaches zero, so no additive offset is a mathematical guarantee —
 * this is a practical separation, not a proof: any famine world whose countdown would exceed this
 * (a decline rate below roughly 1e-6 of itself per cycle) sorts as if it were non-shrinking. That is
 * judged an acceptable trade over the alternative (an unbounded two-key sort the flat `sortKey:
 * number` interface cannot express) rather than a silent bug.
 */
const FAMINE_NON_SHRINKING_SORT_BASE = 1_000_000;

/**
 * Build blocked's sortKey packs two numbers into one flat number, honestly, following this file's own
 * `FAMINE_NON_SHRINKING_SORT_BASE` precedent: `BUILD_DROP_SEVERITY[reason]` (1..5, worst first) is
 * the PRIMARY key, and `droppedRoi` is a tiebreak WITHIN one reason only — never comparable across
 * reasons (alert-bar.md:558-584: `droppedRoi` is annotated "Ordering only" at its own definition,
 * summing served quantity over route cost across goods whose `OUTPUT_PER_UNIT` differs by orders of
 * magnitude, so it was never a value comparable between systems, let alone between reasons).
 *
 * The tiebreak term squashes `droppedRoi` through `-x / (x + 1)`, monotonic and bounded in `(-1, 0]`
 * for any non-negative `droppedRoi` — so a bigger dropped opportunity (worse) always produces a
 * smaller (more negative) offset, and the offset can never reach -1 and spill into the
 * next-more-severe reason's bucket below it: reason `n`'s sortKey range is `(n-1, n]`, so reason
 * `n`'s worst case (`droppedRoi → ∞`, offset → -1, sortKey → n-1 exclusive) never reaches reason
 * `n-1`'s best case (`droppedRoi = 0`, sortKey = n-1 exactly). The squash's cost: `droppedRoi` values
 * of, say, 1,000 and 1,000,000 land almost identically close to -1 — relative order is still exactly
 * preserved (the function is strictly monotonic for `droppedRoi > 0`), so nothing sorts wrong, but
 * very large `droppedRoi` differences read as near-ties rather than far apart. Where `droppedRoi` is
 * 0 for every row in a reason, every offset is 0 and the order within that reason is the stable
 * authored one — array order, per `Array.prototype.sort`'s stability.
 */
function buildBlockedSortKey(reason: BuildDropReason, droppedRoi: number): number {
  const severity = BUILD_DROP_SEVERITY[reason];
  const offset = droppedRoi > 0 ? -droppedRoi / (droppedRoi + 1) : 0;
  return severity + offset;
}

/**
 * Build opportunity's sortKey packs band and score into one flat number, following this file's own
 * `buildBlockedSortKey` precedent for a flat `sortKey: number` carrying two keys honestly. Band is
 * the PRIMARY key — a survival-serving opportunity (band 0: `SURVIVAL_GOODS.includes(goodId)`) sorts
 * ahead of every other opportunity (band 1), matching the engine's own `recordScoredOpportunity`
 * (`lib/engine/directed-build.ts:778-788`), which makes the identical `SURVIVAL_GOODS.includes`
 * check to choose what to persist in the first place — this is a SECOND, independent consultation of
 * the same table, over the stored `goodId`, and nothing pins the two together except the shared
 * import and the coupling test in alerts.test.ts ("Build opportunity — banding coupled to the
 * engine's own choice"). `score` is a SECONDARY, within-band-only tiebreak — never comparable across
 * bands or systems, per its own "Ordering only" annotation (`lib/engine/directed-build.ts:596-597`).
 *
 * The tiebreak squashes `score` through the identical bounded, monotonic `-x / (x + 1)` transform
 * `buildBlockedSortKey` uses for `droppedRoi`, for the identical reason: the planner only ever
 * persists a positive score (it drops non-positive candidates before recording one,
 * `lib/engine/directed-build.ts:762`), so the squash stays in `(-1, 0]` and strictly monotonic — a
 * higher score always yields a smaller (more negative) offset, and reason `n`'s range `(n, n+1]`
 * never overlaps reason `n+1`'s. This is packing the pre-decided band into the key, not "improving"
 * `score` itself: the relative order within a band is exactly the order `score` already gives, never
 * rescaled or normalised.
 */
function buildOpportunitySortKey(goodId: string, score: number): number {
  const band = SURVIVAL_GOODS.includes(goodId) ? 0 : 1;
  const offset = score > 0 ? -score / (score + 1) : 0;
  return band + offset;
}

/** The extractor-slot ResourceVector `hasNoHousingHeadroom`'s per-system feasibility read needs. */
function systemSlotCap(system: WorldSystem) {
  return resourceVectorFromColumns(
    {
      slotGas: system.slotGas,
      slotMinerals: system.slotMinerals,
      slotOre: system.slotOre,
      slotBiomass: system.slotBiomass,
      slotArable: system.slotArable,
      slotWater: system.slotWater,
      slotRadioactive: system.slotRadioactive,
    },
    "slot",
  );
}

/**
 * No housing headroom's queue-adjusted headroom read. `habitableHousingHeadroom`
 * (lib/engine/directed-build.ts:213) takes a `BuildSystemState`, and its `buildings` here is folded
 * with `queued` — the system's open BUILD-kind project levels (`queuedBuildLevelsAt`) — before the
 * read, the same fold the planner's own `effectiveBuildSystems` applies before its housing pass
 * (lib/engine/directed-build.ts:297-333).
 *
 * The fold is monotonically DOWNWARD, never up: `habitableHousingHeadroom` only ever subtracts
 * standing housing from both the habitable and general bounds, and `generalSpaceUsed` only ever
 * adds, so folding queued levels in can only lower headroom — this read can only move a system INTO
 * this category, never out of it (alert-bar.md's "The queued-housing conjunct, and the direction of
 * the queue adjustment"). Queued HOUSING itself is excluded by the caller's separate conjunct before
 * this function is even reached, so what the fold actually earns its keep on here is a committed
 * FACTORY: general space a queued production building has already claimed, which would otherwise
 * still read as free room for the housing this category cares about.
 *
 * `goods: []` and a real `slotCap` (unused by `habitableHousingHeadroom`, but not fabricated either)
 * fill out the rest of the interface honestly.
 */
function hasNoHousingHeadroom(system: WorldSystem, queued: Record<string, number>): boolean {
  const buildings = { ...(buildingsBySystem().get(system.id) ?? {}) };
  for (const [buildingType, levels] of Object.entries(queued)) {
    buildings[buildingType] = (buildings[buildingType] ?? 0) + levels;
  }
  const state: BuildSystemState = {
    systemId: system.id,
    factionId: system.factionId,
    control: system.control,
    population: system.population,
    buildings,
    slotCap: systemSlotCap(system),
    generalSpace: system.generalSpace,
    habitableSpace: system.habitableSpace,
    goods: [],
  };
  return habitableHousingHeadroom(state) < 1;
}

/**
 * Industry idle's per-system idle-capacity read. Calls `buildIndustryReadout` directly — the ONLY
 * place a producer's `used` folds `inputGate` locally (lib/engine/industry.ts:826-830), which is what
 * lets an input-starved factory read idle here; the infrastructure-decay engine's own `used` cannot
 * see this (its `SystemDecayInput` carries no market stock), so there is no cheaper persisted signal
 * to read instead. Mirrors `getSystemIndustry`'s accessor setup (lib/services/universe.ts:171-256)
 * trimmed to just the `buildings` roster this category needs — no popNeeds/deposits/space.
 *
 * Housing is excluded from both the idle-level count and the built-level denominator: this category
 * is "built capacity not running" (production/capacity buildings), not housing vacancy, which reads
 * through its own `occupancy` idleReason for an unrelated purpose (the panel's health colouring).
 *
 * Returns `null` when nothing is built (no denominator) or nothing is idle (condition not met) —
 * absence-not-zero for a system the category has nothing to say about, matching every other
 * category's convention in this file.
 */
function industryIdleForSystem(system: WorldSystem): { idleShare: number } | null {
  const buildings = buildingsBySystem().get(system.id) ?? {};
  if (Object.keys(buildings).length === 0) return null;

  const marketStock: Record<string, number> = {};
  const demandRateByGood: Record<string, number> = {};
  const honestUseRateByGood = new Map<string, number>();
  const anchorMultByGood = new Map<string, number>();
  const logisticsFundingBoundByGood: Record<string, boolean> = {};
  let rowSuppressRate: number | undefined;
  for (const row of marketsBySystem().get(system.id) ?? []) {
    marketStock[row.goodId] = row.stock;
    demandRateByGood[row.goodId] = row.demandRate;
    if (typeof row.honestUseRate === "number" && Number.isFinite(row.honestUseRate)) {
      honestUseRateByGood.set(row.goodId, row.honestUseRate);
    }
    anchorMultByGood.set(row.goodId, row.anchorMult);
    rowSuppressRate ??= row.productionSuppressRate;
    logisticsFundingBoundByGood[row.goodId] = row.logisticsFundingBound ?? false;
  }

  const yields = resourceVectorFromColumns(
    {
      yieldGas: system.yieldGas,
      yieldMinerals: system.yieldMinerals,
      yieldOre: system.yieldOre,
      yieldBiomass: system.yieldBiomass,
      yieldArable: system.yieldArable,
      yieldWater: system.yieldWater,
      yieldRadioactive: system.yieldRadioactive,
    },
    "yield",
  );

  // A row with no persisted use figure (a legacy save, or a fixture that never set it) recomputes
  // live — never 0, which would misread a real draw as none. Same fallback `getSystemIndustry` uses.
  let recomputedUse: Map<string, UseRate> | undefined;
  const honestUseRateOf = (goodKey: string): number => {
    const persisted = honestUseRateByGood.get(goodKey);
    if (persisted !== undefined) return persisted;
    recomputedUse ??= useRatesByGood({
      buildings,
      population: system.population,
      yields,
      productionSuppress: rowSuppressRate ?? 1,
    });
    return recomputedUse.get(goodKey)?.total ?? 0;
  };

  const readout = buildIndustryReadout(buildings, system.population, marketStock, yields, {
    demandRateOf: (goodKey) => demandRateByGood[goodKey] ?? 0,
    honestUseRateOf,
    anchorMultOf: (goodKey) => anchorMultByGood.get(goodKey) ?? 1,
    logisticsFundingBoundOf: (goodKey) => logisticsFundingBoundByGood[goodKey] ?? false,
  });

  let idleLevelsTotal = 0;
  let builtLevelsTotal = 0;
  for (const b of readout.buildings) {
    if (b.buildingType === HOUSING_TYPE) continue;
    builtLevelsTotal += b.count;
    idleLevelsTotal += Math.max(0, Math.floor(b.count - b.used));
  }
  if (builtLevelsTotal <= 0 || idleLevelsTotal < 1) return null;
  return { idleShare: idleLevelsTotal / builtLevelsTotal };
}

function sortedInstances(instances: AlertInstance[]): AlertInstance[] {
  return [...instances].sort((a, b) => a.sortKey - b.sortKey);
}

function toCategory(id: AlertCategory["id"], instances: AlertInstance[], denominator: number): AlertCategory {
  return { id, count: instances.length, denominator, instances: sortedInstances(instances) };
}

export function getAlertData(): AlertData {
  const world: World = getWorld();
  const player = world.player;
  if (!player) return EMPTY_ALERT_DATA;

  // Every system-scoped category here is scoped to the player faction's DEVELOPED systems, which is
  // also the shared `denominator` (alert-bar.md:290-296) — a controlled-but-undeveloped system is
  // inert (lib/engine/control.ts:4-9) and cannot carry most of these conditions. Colony opportunity
  // and the event categories read a wider scope; each says so at its own block.
  const developed = world.systems.filter(
    (s) => s.factionId === player.controlledFactionId && isEconomicallyActive(s.control),
  );
  const denominator = developed.length;

  const famine: AlertInstance[] = [];
  const strike: AlertInstance[] = [];
  const deprivedWorlds: AlertInstance[] = [];
  const unrestRising: AlertInstance[] = [];
  const overcrowded: AlertInstance[] = [];
  const noHousingHeadroom: AlertInstance[] = [];
  const survivalStockFalling: AlertInstance[] = [];
  const demandUnservable: AlertInstance[] = [];
  const buildBlocked: AlertInstance[] = [];
  const industryIdle: AlertInstance[] = [];

  for (const system of developed) {
    // ── Famine: supplyBand === "famine" (lib/engine/population.ts:174, alert-bar.md:100) ──
    // `provision`/`supplyBand` are written together every economy cycle (lib/world/types.ts:108-126)
    // — never assessed means both are absent, so a famine reading implies `provision` is defined
    // too; this is an invariant check, not a `?? 0` default.
    if (system.supplyBand === "famine" && system.provision !== undefined) {
      // Shrinking only when `populationChange` is present, negative, AND population is positive —
      // the last guard keeps k = -delta/population from dividing by zero; a developed famine system
      // reading population 0 is a degenerate state no formula here should extrapolate from.
      const delta = system.populationChange;
      let sortKey: number;
      let measure: string;
      if (delta !== undefined && delta < 0 && system.population > 0) {
        const k = -delta / system.population; // fractional decline rate per reference cycle
        // ln(population / floor) / k — the exponential time-to-abandonment, not the linear form
        // alert-bar.md:499-507 tried and rejected (it collapses to ordering by unrest, not by
        // collapse speed). Denominated per reference cycle, matching `populationChange`'s own
        // denomination (lib/world/types.ts:143-148).
        const countdown = Math.log(system.population / ABANDON_POP_FLOOR) / k;
        sortKey = countdown;
        measure = `${countdown.toFixed(1)} cycles to abandonment`;
      } else {
        const shortfallDepth = 1 - system.provision;
        // Sorts after every shrinking world (see FAMINE_NON_SHRINKING_SORT_BASE), deepest shortfall
        // first within this group.
        sortKey = FAMINE_NON_SHRINKING_SORT_BASE - shortfallDepth;
        measure = `not shrinking — ${Math.round(shortfallDepth * 100)}% short`;
      }
      famine.push({ systemId: system.id, name: system.name, measure, sortKey });
    }

    // ── Strike: unrest past STRIKE_PARAMS.threshold (lib/constants/population.ts:79), matching the
    // engine's own strict comparison (lib/services/system-population.ts:119). Sorts by suppression —
    // strikeMultiplier ascending (lowest multiplier = most suppressed = worst = sorts first). ──
    if (system.unrest > STRIKE_PARAMS.threshold) {
      const multiplier = strikeMultiplier(system.unrest, STRIKE_PARAMS);
      strike.push({
        systemId: system.id,
        name: system.name,
        measure: `production at ${Math.round(multiplier * 100)}%`,
        sortKey: multiplier,
      });
    }

    // ── Deprived worlds: supplyBand === "deprived". Sorts by Provision ascending (lower = worse). ──
    if (system.supplyBand === "deprived" && system.provision !== undefined) {
      deprivedWorlds.push({
        systemId: system.id,
        name: system.name,
        measure: `${Math.round(system.provision * 100)}% Provisioned`,
        sortKey: system.provision,
      });
    }

    // ── Unrest rising: Provision below the floored expectation, not yet striking
    // (alert-bar.md:105). Requires a REAL stored memory — a system with no `provisionExpectation`
    // is excluded outright, never seeded from its own `provision` the way `readExpectation` would
    // for a genuinely corrupt stored value (lib/engine/expectation.ts:34-41,43-52) — a fresh colony
    // must not report grievance against a floor it has no memory of. ──
    if (
      system.provisionExpectation !== undefined &&
      system.provision !== undefined &&
      system.unrest <= STRIKE_PARAMS.threshold
    ) {
      const { effective } = readExpectation(system.provisionExpectation, system.provision, EXPECTATION_PARAMS);
      if (system.provision < effective) {
        // Grievance depth = effective - provision (> 0 here); negated so ascending sortKey still
        // reads worst-first (deepest grievance sorts first).
        unrestRising.push({
          systemId: system.id,
          name: system.name,
          measure: `${Math.round(system.provision * 100)}% Provisioned, expects ${Math.round(effective * 100)}%`,
          sortKey: system.provision - effective,
        });
      }
    }

    // ── Overcrowded: population > popCap, definitional (alert-bar.md:960-994) — NOT a rate. The
    // popCap > 0 guard matches lib/services/tracker.ts:60's own convention: a popCap of 0 reads as
    // not overcrowded here rather than an undefined/infinite utilisation. Sorts by cap utilisation,
    // most over first. ──
    if (system.popCap > 0 && system.population > system.popCap) {
      const utilisation = system.population / system.popCap;
      overcrowded.push({
        systemId: system.id,
        name: system.name,
        measure: `${Math.round(utilisation * 100)}% of housing`,
        sortKey: -utilisation,
      });

      // ── No housing headroom: Overcrowded, AND no housing level standing in the construction
      // queue for this system (a system already building relief housing is building its way out,
      // which is exactly what this category means is impossible), AND no room to build more
      // (habitableHousingHeadroom < 1, evaluated against queue-adjusted buildings — see
      // hasNoHousingHeadroom). Sorts by population over cap, most over first. ──
      const queued = queuedBuildLevelsAt(world.constructionProjects, system.id);
      const hasQueuedHousing = (queued[HOUSING_TYPE] ?? 0) > 0;
      if (!hasQueuedHousing && hasNoHousingHeadroom(system, queued)) {
        const over = system.population - system.popCap;
        noHousingHeadroom.push({
          systemId: system.id,
          name: system.name,
          measure: `${Math.round(over)} over cap, no room to build`,
          sortKey: -over,
        });
      }
    }

    const marketRows = marketsBySystem().get(system.id) ?? [];

    // ── Survival stock falling: a SURVIVAL_GOODS market row whose cycles-to-empty
    // (stock / -stockChange) is below SURVIVAL_STOCK_CYCLES_THRESHOLD. A rising or flat stock
    // (stockChange >= 0, including absent) never qualifies — only a falling stock has a
    // cycles-to-empty at all, and simply falling is meaningless on its own (stocks oscillate); the
    // countdown carries the whole condition (alert-bar.md:1039-1067). A system short in BOTH water
    // and food counts once, at its worse (smaller) reading — instances are systems here, same as
    // every other system-scoped category. Sorts by cycles remaining ascending, soonest first — the
    // sortKey IS the measure. ──
    let worstCyclesToEmpty: number | undefined;
    let worstSurvivalGood: string | undefined;
    for (const goodId of SURVIVAL_GOODS) {
      const row = marketRows.find((m) => m.goodId === goodId);
      if (!row || row.stockChange === undefined || row.stockChange >= 0) continue;
      const cyclesToEmpty = row.stock / -row.stockChange;
      if (cyclesToEmpty >= SURVIVAL_STOCK_CYCLES_THRESHOLD) continue;
      if (worstCyclesToEmpty === undefined || cyclesToEmpty < worstCyclesToEmpty) {
        worstCyclesToEmpty = cyclesToEmpty;
        worstSurvivalGood = goodId;
      }
    }
    if (worstCyclesToEmpty !== undefined && worstSurvivalGood !== undefined) {
      survivalStockFalling.push({
        systemId: system.id,
        name: system.name,
        measure: `${worstSurvivalGood} empties in ${worstCyclesToEmpty.toFixed(1)} cycles`,
        sortKey: worstCyclesToEmpty,
      });
    }

    // ── Demand unservable: any market row with demandUnservable === true (Task 4, written on the
    // DEFICIT endpoint only — a donor never carries this) AND a persisted unservedShortfall (Task 16,
    // WorldMarket.unservedShortfall — the deficit's own LEVEL, `max(0, target − stock)`, present iff
    // the bit is true; a row carrying the bit with no shortfall reads as absent-not-zero here, same
    // as every other category's convention, rather than assumed to be the row's demandRate or 0). A
    // system unservable in three goods counts once — the chip counts systems, not (system, good)
    // pairs (alert-bar.md:546) — at its largest (worst) shortfall, never the sum across goods. Sorts
    // by that shortfall descending (negated, biggest unserved deficit first). ──
    let worstShortfall: number | undefined;
    let worstUnservableGood: string | undefined;
    for (const row of marketRows) {
      if (!row.demandUnservable || row.unservedShortfall === undefined) continue;
      if (worstShortfall === undefined || row.unservedShortfall > worstShortfall) {
        worstShortfall = row.unservedShortfall;
        worstUnservableGood = row.goodId;
      }
    }
    if (worstShortfall !== undefined && worstUnservableGood !== undefined) {
      demandUnservable.push({
        systemId: system.id,
        name: system.name,
        measure: `${worstUnservableGood} unserved by ${worstShortfall.toFixed(1)}`,
        sortKey: -worstShortfall,
      });
    }

    // ── Build blocked: the planner's best-ranked dropped opportunity this run (Task 3). Sorts by
    // authored reason severity, worst first; droppedRoi tiebreaks within one reason only — see
    // buildBlockedSortKey's own docstring for the packing and its limits. ──
    if (system.buildBlocked !== undefined) {
      const { reason, droppedRoi } = system.buildBlocked;
      buildBlocked.push({
        systemId: system.id,
        name: system.name,
        measure: `${reason.replace(/-/g, " ")} (dropped ROI ${droppedRoi.toFixed(2)})`,
        sortKey: buildBlockedSortKey(reason, droppedRoi),
      });
    }

    // ── Industry idle: at least one whole non-housing level idle for any reason — no staff, no
    // skill licence, or (Task 5) missing inputs. See industryIdleForSystem's own docstring for why
    // this must call buildIndustryReadout directly rather than reading a cheaper persisted signal.
    // Sorts by idle share, most idle first. ──
    const idle = industryIdleForSystem(system);
    if (idle !== null) {
      industryIdle.push({
        systemId: system.id,
        name: system.name,
        measure: `${Math.round(idle.idleShare * 100)}% idle capacity`,
        sortKey: -idle.idleShare,
      });
    }
  }

  // ── Maintenance unfunded: one faction-level row (systemId: null), present only once the faction
  // has settled at least once (`lastSettlement` non-null — alert-bar.md:398-399), and only when the
  // settlement could not pay the maintenance band it was ASKED to pay: paid.maintenance <
  // maintenanceBill × the CURRENT slider — not the full bill, so a legal slider setting below 1.0
  // (floored at 0.5) never fires this on its own (lib/engine/treasury.ts:126-131, settleLadder:
  // charge = bill × slider; pay = min(charge, available); insolvency is pay < charge). Sort order is
  // vacuous — the count is always 0 or 1. ──
  const maintenanceUnfunded: AlertInstance[] = [];
  const treasury = world.treasuries.find((t) => t.factionId === player.controlledFactionId);
  const settlement = treasury?.lastSettlement;
  if (treasury !== undefined && settlement !== null && settlement !== undefined) {
    const charge = settlement.maintenanceBill * treasury.bands.maintenance;
    if (settlement.paid.maintenance < charge) {
      const factionName = world.factions.find((f) => f.id === player.controlledFactionId)?.name ?? "Treasury";
      maintenanceUnfunded.push({
        systemId: null,
        name: factionName,
        measure: `${Math.round(charge - settlement.paid.maintenance)} short of maintenance`,
        sortKey: 0,
      });
    }
  }

  // ── Build opportunity: self-gates on world.player.automation.build, independent of the settings
  // checkbox (alert-bar.md:113, :415-418) — while automation is ON the planner is already acting on
  // this domain, so nothing surfaces here regardless of anything else. While OFF, reads Task 17's
  // WorldSystem.buildOpportunity — the planner's own best-ranked SCORED opportunity this run, already
  // chosen survival-first by the engine's own recordScoredOpportunity (see buildOpportunitySortKey):
  // a system with any survival-serving opportunity persists that one rather than its highest-scoring
  // one, so this service bands a STORED row, never re-deriving the choice from scratch. Absent means
  // the planner scored nothing here this run — absence-not-zero. `score` is documented "Ordering
  // only" (lib/engine/directed-build.ts:596-597) and carries a 13× unit spread across goods
  // (alert-bar.md's Build opportunity section): never normalised, rescaled or read as a value here,
  // and the measure string says so rather than implying otherwise. ──
  const buildOpportunity: AlertInstance[] = [];
  if (!player.automation.build) {
    for (const system of developed) {
      if (system.buildOpportunity === undefined) continue;
      const { score, goodId } = system.buildOpportunity;
      buildOpportunity.push({
        systemId: system.id,
        name: system.name,
        measure: `${goodId} opportunity — planner score ${score.toFixed(2)} (ordering only)`,
        sortKey: buildOpportunitySortKey(goodId, score),
      });
    }
  }

  // ── Colony opportunity: self-gates on world.player.automation.colonisation, same independence
  // from the settings checkbox as Build opportunity. Reads Task 17's WorldSystem.colonyOpportunity —
  // the planner's own ColonyProposal terms this run (`value`, the ROI numerator; `work`, the
  // establish-plus-housing denominator) — a genuine ROI, unlike the build side. Scoped to every
  // player-owned system (not `developed`: a colony candidate is by definition not developed yet), but
  // presence of the field already means "a controlled, not-yet-developed candidate the colonisation
  // planner actually proposed establishing this run" (the field's own docstring), so no separate
  // control or eligibility re-check belongs here — the alert and the planner's own founding decision
  // can never disagree about what counts as a candidate. Sorts by value / work descending (negated,
  // best ROI first).
  //
  // The `work <= 0` guard below is **unreachable against today's constants and deliberately kept**.
  // `sizeColonyEstablish` (lib/engine/directed-build.ts:1301-1319) returns null rather than a
  // proposal unless `housingLevels >= 1`, and `work` is `establishWork + housingLevels ×
  // workCostPerLevel(HOUSING_TYPE)` — both terms non-negative constants — so the planner cannot emit
  // a non-positive `work`. It is a divide-by-zero guard against a constants change, not a live
  // branch, which is why no test pins it: a red-proof here could only be written by breaking the
  // engine's own sizing invariant. Delete it only alongside that invariant. ──
  const colonyOpportunity: AlertInstance[] = [];
  if (!player.automation.colonisation) {
    for (const system of world.systems) {
      if (system.factionId !== player.controlledFactionId || system.colonyOpportunity === undefined) continue;
      const { value, work } = system.colonyOpportunity;
      if (work <= 0) continue;
      const roi = value / work;
      colonyOpportunity.push({
        systemId: system.id,
        name: system.name,
        measure: `ROI ${roi.toFixed(2)} (value ${value.toFixed(1)} / work ${work.toFixed(1)})`,
        sortKey: -roi,
      });
    }
  }

  // ── The three event categories: Crisis / Disruption / Windfall (alert-bar.md:375-389). Scoped
  // wider than `developed` — events in the player's developed systems, PLUS the relations-owned pair
  // events (border_conflict, pact_under_negotiation, alliance_dissolved — the only WorldEvent rows
  // carrying `metadata`) where the player's faction is one of the pair, regardless of which system
  // (or no system at all) the event carries. The count is INSTANCES, not systems — a region-target
  // phase applies to a whole region from one instance, and the two metadata-only types spawn with no
  // system at all, so counting systems would misreport both. Crisis/Disruption sort by the authored
  // impactRank (EVENT_BAND, lib/constants/ui.ts) ascending — band is already fixed by which category
  // array an instance lands in, so this is compareEventSeverity's ordering restricted to one band,
  // where it reduces to the impactRank comparison alone. Windfall sorts by ticksRemaining ascending,
  // soonest to expire first. ──
  const developedIds = new Set(developed.map((s) => s.id));
  const crisis: AlertInstance[] = [];
  const disruption: AlertInstance[] = [];
  const windfall: AlertInstance[] = [];
  for (const event of world.events) {
    const belongsToPlayer =
      event.metadata !== null
        ? event.metadata.factionAId === player.controlledFactionId ||
          event.metadata.factionBId === player.controlledFactionId
        : event.systemId !== null && developedIds.has(event.systemId);
    if (!belongsToPlayer) continue;

    const def = EVENT_DEFINITIONS[event.type];
    const phaseLabel = def?.phases.find((p) => p.name === event.phase)?.displayName ?? event.phase;
    const eventName = def?.name ?? event.type;
    const name = event.systemId !== null ? (systemNameById().get(event.systemId) ?? event.systemId) : eventName;
    const bandInfo = EVENT_BAND[event.type];

    if (bandInfo.band === "crisis") {
      crisis.push({
        systemId: event.systemId,
        name,
        measure: `${eventName} — ${phaseLabel}`,
        sortKey: bandInfo.impactRank,
      });
    } else if (bandInfo.band === "disruption") {
      disruption.push({
        systemId: event.systemId,
        name,
        measure: `${eventName} — ${phaseLabel}`,
        sortKey: bandInfo.impactRank,
      });
    } else {
      const ticksRemaining = Math.max(0, event.phaseStartTick + event.phaseDuration - world.meta.currentTick);
      windfall.push({
        systemId: event.systemId,
        name,
        measure: `${ticksRemaining} ticks remaining`,
        sortKey: ticksRemaining,
      });
    }
  }

  const categories: AlertCategory[] = [
    toCategory("famine", famine, denominator),
    toCategory("strike", strike, denominator),
    toCategory("maintenance_unfunded", maintenanceUnfunded, denominator),
    toCategory("crisis", crisis, denominator),
    toCategory("deprived_worlds", deprivedWorlds, denominator),
    toCategory("unrest_rising", unrestRising, denominator),
    toCategory("survival_stock_falling", survivalStockFalling, denominator),
    toCategory("demand_unservable", demandUnservable, denominator),
    toCategory("overcrowded", overcrowded, denominator),
    toCategory("no_housing_headroom", noHousingHeadroom, denominator),
    toCategory("build_blocked", buildBlocked, denominator),
    toCategory("industry_idle", industryIdle, denominator),
    toCategory("disruption", disruption, denominator),
    toCategory("build_opportunity", buildOpportunity, denominator),
    toCategory("colony_opportunity", colonyOpportunity, denominator),
    toCategory("windfall", windfall, denominator),
  ];

  // Registry-driven order: tier first, then the authored `order` within it (alert-bar.md:343-345) —
  // read from ALERT_CATEGORIES rather than hand-duplicated, so the two can never drift apart.
  categories.sort((a, b) => {
    const defA = ALERT_CATEGORIES[a.id];
    const defB = ALERT_CATEGORIES[b.id];
    return TIER_RANK[defA.tier] - TIER_RANK[defB.tier] || defA.order - defB.order;
  });

  return { categories };
}
