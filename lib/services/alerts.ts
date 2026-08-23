/**
 * Alert bar read service — all sixteen categories: the six state-derived ones (Famine, Deprived
 * worlds, Strike, Unrest rising, Overcrowded, No housing headroom), Survival stock falling, Demand
 * unservable, Build blocked, Industry idle, the faction-level Maintenance unfunded, the two
 * automation-gated opportunity categories (Build opportunity, Colony opportunity), and the three
 * event bands (Crisis, Disruption, Windfall).
 *
 * The system-scoped categories are scoped to the player faction's DEVELOPED systems, which is also
 * their `denominator` — the flyout footer's "N of D developed systems". A world with no player seat
 * has nothing to alert on: reads empty rather than throwing, the same posture `getTrackerData` takes
 * for the same reason (lib/services/tracker.ts:34-37). Colony opportunity is scoped to a DIFFERENT
 * population — the player's controlled, not-yet-developed systems — and carries that count as its own
 * denominator, since a colony candidate is never in the developed set; it says so at its own block.
 * Two kinds of category count something else and carry no denominator at all: the three event
 * categories count EVENTS, and the faction-level Maintenance unfunded counts the FACTION — see
 * `AlertCategory`'s own contract for why neither is a share of any systems total.
 *
 * Categories are emitted in the registry's authored tier + order: every `toSystemCategory(...)` /
 * `toEventCategory(...)` call below carries its own literal id, and the final array sorts on
 * `ALERT_CATEGORIES[id].tier` then `.order` — so the order is read from the registry, never
 * hand-duplicated here.
 *
 * Within a category, `instances` sort ascending by `sortKey`: smaller sorts first, and every
 * category picks its own `sortKey` so ascending always reads worst-first — except the two
 * opportunity categories, where "worst" is inverted to "best opportunity first" (negated, the same
 * convention Overcrowded and No housing headroom already use for "biggest number is most urgent").
 * Build opportunity goes one step further and packs a SECOND key (survival band) ahead of score,
 * following `buildBlockedSortKey`'s own two-key precedent — see `buildOpportunitySortKey`. See each
 * category's block below for its measure and why smaller is worse (or, for opportunities, why
 * smaller is better).
 *
 * Demand unservable, Build opportunity and Colony opportunity read persisted planner terms
 * (`WorldMarket.unservedShortfall`, `WorldSystem.buildOpportunity`, `WorldSystem.colonyOpportunity`)
 * rather than re-deriving anything: the planner already computes and discards these every run, and
 * persisting them is what keeps this service off read-time proxies (a demand RATE standing in for an
 * unserved LEVEL, an addable-level count standing in for a planner score, and a cost ratio standing
 * in for the planner's own value/work ROI).
 */
import { getWorld } from "@/lib/world/store";
import { formatDuration } from "@/lib/utils/calendar";
import { CYCLE_LENGTH } from "@/lib/constants/tick-cadence";
import { DEFAULT_ALERT_CATEGORIES } from "@/lib/constants/attention";
import type { WorldSystem, World } from "@/lib/world/types";
import { buildingsBySystem, marketsBySystem, systemNameById } from "@/lib/services/world-index";
import { depositCountsOf } from "@/lib/engine/resources";
import { isEconomicallyActive } from "@/lib/engine/control";
import {
  habitableHousingHeadroom, queuedBuildLevelsBySystem,
  type BuildSystemState, type BuildDropReason,
} from "@/lib/engine/directed-build";
import { readSystemIndustry } from "@/lib/services/system-industry-readout";
import { strikeMultiplier } from "@/lib/engine/population";
import { readExpectation } from "@/lib/engine/expectation";
import { bandShortfall } from "@/lib/engine/treasury";
import { STRIKE_PARAMS, EXPECTATION_PARAMS, ABANDON_POP_FLOOR } from "@/lib/constants/population";
import { HOUSING_TYPE } from "@/lib/constants/industry";
import { SURVIVAL_GOODS } from "@/lib/constants/physical-economy";
import { ALERT_CATEGORIES, BUILD_DROP_SEVERITY } from "@/lib/constants/alerts";
import { EVENT_BAND } from "@/lib/constants/ui";
import { EVENT_DEFINITIONS } from "@/lib/constants/events";
import type { AlertTier, AlertCategoryId } from "@/lib/types/alerts";
import type {
  AlertData, AlertCategory, AlertInstance, SystemScopedAlertCategory,
  ControlledSystemsAlertCategory, EventAlertCategory, FactionAlertCategory,
} from "@/lib/types/api";

// No seat means no stored preference to read; the bar has nothing to show either way.
const EMPTY_ALERT_DATA: AlertData = {
  categories: [],
  categorySettings: DEFAULT_ALERT_CATEGORIES,
};

/** Band order, worst first, for the final categories array — critical chips lead, then important,
 *  then info. Not the event bands' own `EVENT_BAND_ORDER` (lib/constants/ui.ts): that ranks Crisis /
 *  Disruption / Windfall against each other as event TYPES; this ranks the sixteen alert CATEGORIES
 *  against each other by their authored `AlertTier`. */
const TIER_RANK: Record<AlertTier, number> = { critical: 0, important: 1, info: 2 };

/** Cycles-to-empty threshold for Survival stock falling — authored from remedy time (one logistics
 *  cycle for the matcher to route a haul, one for the goods to land, one of margin for the player to
 *  notice and act), not read off a distribution. */
const SURVIVAL_STOCK_CYCLES_THRESHOLD = 3;

/**
 * Famine's non-shrinking branch sorts after every shrinking world: a famine world that is not
 * shrinking carries no countdown at all, and sorts after the shrinking ones, by shortfall depth.
 * The real countdown (`ln(population / ABANDON_POP_FLOOR) / k`) is unbounded
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
 * reasons: `droppedRoi` is annotated "Ordering only" at its own definition, summing served quantity
 * over route cost across goods whose `OUTPUT_PER_UNIT` differs by orders of magnitude, so it was
 * never a value comparable between systems, let alone between reasons.
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

/**
 * No housing headroom's queue-adjusted headroom read. `habitableHousingHeadroom`
 * (lib/engine/directed-build.ts) takes a `BuildSystemState`, and its `buildings` here is folded
 * with `queued` — the system's open BUILD-kind project levels — before the read, the same fold the
 * planner's own `effectiveBuildSystems` applies before its housing pass
 * (lib/engine/directed-build.ts:297-333).
 *
 * `habitableHousingHeadroom` now reads the people-land bound ALONE (housing bills to people land;
 * industry land is a separate, disjoint budget that no longer bounds housing — the build rule's
 * separation). So the only queued level that can move this read is queued HOUSING itself, and that
 * is excluded by the caller's separate conjunct before this function is even reached: a queued
 * factory, academy or complex claims industry land, which this category no longer looks at. The
 * fold is kept (rather than dropped) because it costs nothing and keeps this function agnostic to
 * which queued type, if any, turns out to matter — but today, with the caller's housing conjunct in
 * place, folding the queue changes nothing this function reads.
 *
 * The buildings roster is shallow-copied before the fold because the fold WRITES to it — the record
 * the world index hands back is shared with every other reader this tick (see
 * `SystemIndustryReadoutResult.buildings`, which is deliberately handed out uncopied precisely
 * because none of its readers write).
 *
 * `goods: []` and a real `depositCounts` (unused by `habitableHousingHeadroom`, but not fabricated either)
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
    depositCounts: depositCountsOf(system),
    industryLand: system.industryLand,
    peopleLand: system.peopleLand,
    goods: [],
  };
  return habitableHousingHeadroom(state) < 1;
}

/**
 * Industry idle's per-system idle-capacity read. Goes through the full industry readout — the ONLY
 * place a producer's `used` folds `inputGate` locally (lib/engine/industry.ts:826-830), which is what
 * lets an input-starved factory read idle here; the infrastructure-decay engine's own `used` cannot
 * see this (its `SystemDecayInput` carries no market stock), so there is no cheaper persisted signal
 * to read instead. The readout comes from `readSystemIndustry`, the same shared context assembly the
 * Industry panel's own read uses, so this category and that panel can never disagree about which
 * levels are running. Only the `buildings` roster of the result is read here — no
 * popNeeds/deposits/space.
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
  // Cheap index lookup ahead of the readout so a system with nothing built never pays for one.
  if (Object.keys(buildingsBySystem().get(system.id) ?? {}).length === 0) return null;
  const { readout } = readSystemIndustry(system);

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

/** A category whose count is systems, out of the shared developed-systems denominator. */
function toSystemCategory(
  id: AlertCategoryId, instances: AlertInstance[], denominator: number,
): SystemScopedAlertCategory {
  return { id, unit: "developed_systems", count: instances.length, denominator, instances: sortedInstances(instances) };
}

/** A category whose count is systems the faction holds but has not developed — its own denominator,
 *  because those systems are not in the developed set the categories above are a share of. */
function toControlledSystemCategory(
  id: AlertCategoryId, instances: AlertInstance[], denominator: number,
): ControlledSystemsAlertCategory {
  return { id, unit: "controlled_systems", count: instances.length, denominator, instances: sortedInstances(instances) };
}

/** A category whose count is EVENTS, with no denominator — an event count is not a share of the
 *  developed-systems total and can exceed it (a region phase covers many systems from one instance;
 *  the relations-spawned pair events have no system at all). */
function toEventCategory(id: AlertCategoryId, instances: AlertInstance[]): EventAlertCategory {
  return { id, unit: "events", count: instances.length, instances: sortedInstances(instances) };
}

/** The one faction-level category, counting the FACTION and carrying no denominator — the same bare
 *  count the event categories take, for the same reason: its count (0 or 1, one settlement per
 *  faction) is not a share of the developed-systems total, and rendering it against one would read
 *  "1 of 253 developed systems" about a row that names no system. */
function toFactionCategory(id: AlertCategoryId, instances: AlertInstance[]): FactionAlertCategory {
  return { id, unit: "faction", count: instances.length, instances: sortedInstances(instances) };
}

export function getAlertData(): AlertData {
  const world: World = getWorld();
  const player = world.player;
  if (!player) return EMPTY_ALERT_DATA;

  // Every system-scoped category here is scoped to the player faction's DEVELOPED systems, which is
  // also the shared `denominator` — a controlled-but-undeveloped system is inert
  // (lib/engine/control.ts:4-9) and cannot carry most of these conditions. Colony opportunity (the
  // controlled systems, which are exactly the ones this set excludes) and the event categories read
  // other scopes; each says so at its own block.
  const developed = world.systems.filter(
    (s) => s.factionId === player.controlledFactionId && isEconomicallyActive(s.control),
  );
  const denominator = developed.length;

  // Indexed once, ahead of the loop, the same way `marketsBySystem()`/`buildingsBySystem()` are used
  // below — the per-system fold would otherwise rescan every construction project in the galaxy for
  // each overcrowded system.
  const queuedBuildLevels = queuedBuildLevelsBySystem(world.constructionProjects);

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
    // ── Famine: supplyBand === "famine" (lib/engine/population.ts:174) ──
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
        // ln(population / floor) / k — the exponential time-to-abandonment, not the linear form that
        // was tried and rejected (it collapses to ordering by unrest, not by collapse speed).
        // Denominated per reference cycle, matching `populationChange`'s own
        // denomination (lib/world/types.ts:143-148).
        const countdown = Math.log(system.population / ABANDON_POP_FLOOR) / k;
        sortKey = countdown;
        measure = `${formatDuration(countdown * CYCLE_LENGTH)} to abandonment`;
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

    // ── Unrest rising: Provision below the floored expectation, not yet striking.
    // Requires a REAL stored memory — a system with no `provisionExpectation`
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

    // ── Overcrowded: population > popCap, definitional — NOT a rate. The
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
      const queued = queuedBuildLevels.get(system.id) ?? {};
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
    // countdown carries the whole condition. A system short in BOTH water
    // and food counts once, at its worse (smaller) reading — instances are systems here, same as
    // every other system-scoped category. Sorts by cycles-to-empty ascending, soonest first — the
    // sortKey is that raw cycle figure; the displayed measure renders it as a calendar-scaled
    // duration (`formatDuration`), never the cycle count itself. ──
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
        measure: `${worstSurvivalGood} empties in ${formatDuration(worstCyclesToEmpty * CYCLE_LENGTH)}`,
        sortKey: worstCyclesToEmpty,
      });
    }

    // ── Demand unservable: any market row carrying a positive `WorldMarket.unservedShortfall` — the
    // LEVEL the deficit is left short after every reachable donor's remaining capacity, written on
    // the DEFICIT endpoint only, so a donor never carries one. The level IS the classification: the
    // logistics engine only records one where that residue is strictly positive, so absent-or-zero
    // means servable and there is no separate bit to agree with. A system unservable in three goods
    // counts once — the chip counts systems, not (system, good) pairs — at its largest (worst)
    // shortfall, never the sum across goods. Sorts by that shortfall descending (negated, biggest
    // unserved deficit first). ──
    let worstShortfall: number | undefined;
    let worstUnservableGood: string | undefined;
    for (const row of marketRows) {
      if (row.unservedShortfall === undefined || row.unservedShortfall <= 0) continue;
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

    // ── Build blocked: the planner's best-ranked dropped opportunity this run
    // (`WorldSystem.buildBlocked`, written by the directed-build planner). Sorts by
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
    // skill licence, or missing recipe inputs. See industryIdleForSystem's own docstring for why
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

  // ── Maintenance unfunded: one faction-level row (systemId: null), present only when the last
  // settlement could not pay the maintenance band it was ASKED to pay. `bandShortfall` owns that
  // test and its reasoning (both terms frozen at the settlement, never against the live slider; a
  // legal slider below 1.0 is not insolvency; a faction that has never settled, or a settlement
  // predating the charge, reads as never-assessed) — this reads the amount and says how big it is.
  // The same helper backs the "shorted" tag on the treasury and construction cards, so the bar and
  // those cards cannot disagree about the same faction. Sort order is vacuous — the count is always
  // 0 or 1, which is also why this category counts the FACTION and carries no developed-systems
  // denominator (`toFactionCategory`). ──
  const maintenanceUnfunded: AlertInstance[] = [];
  const settlement = world.treasuries.find((t) => t.factionId === player.controlledFactionId)?.lastSettlement;
  const maintenanceShort = bandShortfall(settlement, "maintenance");
  if (maintenanceShort !== null) {
    const factionName = world.factions.find((f) => f.id === player.controlledFactionId)?.name ?? "Treasury";
    maintenanceUnfunded.push({
      systemId: null,
      name: factionName,
      measure: `${Math.round(maintenanceShort)} short of maintenance`,
      sortKey: 0,
    });
  }

  // ── Build opportunity: self-gates on world.player.automation.build, independent of the settings
  // checkbox — while automation is ON the planner is already acting on this domain, so nothing
  // surfaces here regardless of anything else. While OFF, reads
  // WorldSystem.buildOpportunity — the planner's own best-ranked SCORED opportunity this run, already
  // chosen survival-first by the engine's own recordScoredOpportunity (see buildOpportunitySortKey):
  // a system with any survival-serving opportunity persists that one rather than its highest-scoring
  // one, so this service bands a STORED row, never re-deriving the choice from scratch. Absent means
  // the planner scored nothing here this run — absence-not-zero. `score` is documented "Ordering
  // only" (lib/engine/directed-build.ts:596-597) and carries a 13× unit spread across goods
  // across goods: never normalised, rescaled or read as a value here,
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
  // from the settings checkbox as Build opportunity. Reads WorldSystem.colonyOpportunity —
  // the planner's pre-gate assessment terms this run (`value`, the ROI numerator; `work`, the
  // establish-plus-housing denominator) — a genuine ROI, unlike the build side. Presence of the field
  // already means "a controlled, not-yet-developed candidate the pre-gate assessment kept this run"
  // (the field's own docstring): the money and settler-supply gates shape only what gets founded, so
  // a site the treasury cannot yet cover keeps its row here and the system panel quotes the cost the
  // verb is blocked on. No separate eligibility re-check belongs here — the alert and the planner's
  // assessment can never disagree about what counts as a candidate. Sorts by value / work descending
  // (negated, best ROI first).
  //
  // Scoped — and denominated — to the player's CONTROLLED systems, never `developed`: a colony
  // candidate is by definition not developed yet, so the two populations are disjoint and the shared
  // denominator would render "Colony opportunity, 3 of 1 developed systems". `controlled` is the same
  // population the colonisation planner draws its candidates from (lib/world/tick.ts's
  // `developProvider` filters on exactly this control state), which is what makes this count a share
  // of it. Walking that list rather than every player-owned system is scoping, not a re-check: it is
  // what keeps the count a subset of the number it is rendered against.
  //
  // The `work <= 0` guard below is **unreachable against today's constants and deliberately kept**.
  // `sizeColonyEstablish` (lib/engine/directed-build.ts:1301-1319) returns null rather than a
  // proposal unless `housingLevels >= 1`, and `work` is `establishWork + housingLevels ×
  // workCostPerLevel(HOUSING_TYPE)` — both terms non-negative constants — so the planner cannot emit
  // a non-positive `work`. It is a divide-by-zero guard against a constants change, not a live
  // branch, which is why no test pins it: a red-proof here could only be written by breaking the
  // engine's own sizing invariant. Delete it only alongside that invariant. ──
  const controlled = world.systems.filter(
    (s) => s.factionId === player.controlledFactionId && s.control === "controlled",
  );
  // A colony starting to form CLEARS the row (the spec's own clearing condition), and the stored
  // signal only learns that at the next planner run — so the forming exclusion is derived here, at
  // read time, from the projects themselves. That makes the row drop the moment the player orders
  // the colony and return the moment a cancel deletes the project, with no cycle lag either way.
  const formingColonyAt = new Set<string>();
  for (const p of world.constructionProjects) {
    if (p.kind === "colony_establish") formingColonyAt.add(p.systemId);
  }
  const colonyOpportunity: AlertInstance[] = [];
  if (!player.automation.colonisation) {
    for (const system of controlled) {
      if (system.colonyOpportunity === undefined) continue;
      if (formingColonyAt.has(system.id)) continue;
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

  // ── The three event categories: Crisis / Disruption / Windfall. Scoped
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

    // EVENT_DEFINITIONS and EVENT_BAND are both total Records over the event-type union, so both
    // index bare — only the phase LOOKUP inside a definition can miss (a row carrying a phase name
    // its definition no longer lists), and that one keeps its guard.
    const def = EVENT_DEFINITIONS[event.type];
    const phaseLabel = def.phases.find((p) => p.name === event.phase)?.displayName ?? event.phase;
    const eventName = def.name;
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
        measure: `${formatDuration(ticksRemaining)} remaining`,
        sortKey: ticksRemaining,
      });
    }
  }

  const categories: AlertCategory[] = [
    toSystemCategory("famine", famine, denominator),
    toSystemCategory("strike", strike, denominator),
    toFactionCategory("maintenance_unfunded", maintenanceUnfunded),
    toEventCategory("crisis", crisis),
    toSystemCategory("deprived_worlds", deprivedWorlds, denominator),
    toSystemCategory("unrest_rising", unrestRising, denominator),
    toSystemCategory("survival_stock_falling", survivalStockFalling, denominator),
    toSystemCategory("demand_unservable", demandUnservable, denominator),
    toSystemCategory("overcrowded", overcrowded, denominator),
    toSystemCategory("no_housing_headroom", noHousingHeadroom, denominator),
    toSystemCategory("build_blocked", buildBlocked, denominator),
    toSystemCategory("industry_idle", industryIdle, denominator),
    toEventCategory("disruption", disruption),
    toSystemCategory("build_opportunity", buildOpportunity, denominator),
    toControlledSystemCategory("colony_opportunity", colonyOpportunity, controlled.length),
    toEventCategory("windfall", windfall),
  ];

  // Registry-driven order: tier first, then the authored `order` within it — read from
  // ALERT_CATEGORIES rather than hand-duplicated, so the two can never drift apart.
  categories.sort((a, b) => {
    const defA = ALERT_CATEGORIES[a.id];
    const defB = ALERT_CATEGORIES[b.id];
    return TIER_RANK[defA.tier] - TIER_RANK[defB.tier] || defA.order - defB.order;
  });

  return { categories, categorySettings: player.alertCategories };
}
