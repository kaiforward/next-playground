/**
 * Alert bar read service — the six state-derived categories that read only persisted system state
 * (docs/build-plans/alert-bar.md tier table, lines 98-115): Famine, Deprived worlds, Strike, Unrest
 * rising, Overcrowded, No housing headroom. The remaining ten categories (events, Maintenance
 * unfunded, Survival stock falling, Demand unservable, Build blocked, Industry idle, the two
 * opportunity categories, Windfall) have no read implemented here yet and are simply absent from
 * `categories` until they do — there is no placeholder row for an unbuilt category.
 *
 * Everything is scoped to the player faction's DEVELOPED systems (alert-bar.md:293), which is also
 * `denominator` — the flyout footer's "N of D developed systems" (alert-bar.md:290-291). A world
 * with no player seat has nothing to alert on: reads empty rather than throwing, the same posture
 * `getTrackerData` takes for the same reason (lib/services/tracker.ts:34-37).
 *
 * Categories are emitted in a fixed order — critical tier first, then important, matching the
 * registry's authored `order` among just these six (`lib/constants/alerts.ts`). Composing the full
 * sixteen-category order (alert-bar.md:343-345, "categories are ordered by the registry's authored
 * tier + order") needs every category's read to exist first, so this service exposes only the six
 * it computes, each already carrying its own authored tier + order, ready to fold into that fuller
 * run once the rest are built.
 *
 * Within a category, `instances` sort ascending by `sortKey`: smaller sorts first, and every
 * category picks its own `sortKey` so ascending always reads worst-first, per the tier table's own
 * "sorts by …" column. See each category's block below for its measure and why smaller is worse.
 */
import { getWorld } from "@/lib/world/store";
import type { WorldSystem } from "@/lib/world/types";
import { buildingsBySystem } from "@/lib/services/world-index";
import { resourceVectorFromColumns } from "@/lib/engine/resources";
import { isEconomicallyActive } from "@/lib/engine/control";
import {
  habitableHousingHeadroom, queuedBuildLevelsAt, type BuildSystemState,
} from "@/lib/engine/directed-build";
import { strikeMultiplier } from "@/lib/engine/population";
import { readExpectation } from "@/lib/engine/expectation";
import { STRIKE_PARAMS, EXPECTATION_PARAMS, ABANDON_POP_FLOOR } from "@/lib/constants/population";
import { HOUSING_TYPE } from "@/lib/constants/industry";
import type { AlertData, AlertCategory, AlertInstance } from "@/lib/types/api";

const EMPTY_ALERT_DATA: AlertData = { categories: [] };

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
    slotCap: resourceVectorFromColumns(
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
    ),
    generalSpace: system.generalSpace,
    habitableSpace: system.habitableSpace,
    goods: [],
  };
  return habitableHousingHeadroom(state) < 1;
}

function sortedInstances(instances: AlertInstance[]): AlertInstance[] {
  return [...instances].sort((a, b) => a.sortKey - b.sortKey);
}

function toCategory(id: AlertCategory["id"], instances: AlertInstance[], denominator: number): AlertCategory {
  return { id, count: instances.length, denominator, instances: sortedInstances(instances) };
}

export function getAlertData(): AlertData {
  const world = getWorld();
  const player = world.player;
  if (!player) return EMPTY_ALERT_DATA;

  // Every category here is scoped to the player faction's DEVELOPED systems, which is also the
  // shared `denominator` (alert-bar.md:290-296) — a controlled-but-undeveloped system is inert
  // (lib/engine/control.ts:4-9) and cannot carry any of these six conditions.
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
  }

  return {
    categories: [
      toCategory("famine", famine, denominator),
      toCategory("strike", strike, denominator),
      toCategory("deprived_worlds", deprivedWorlds, denominator),
      toCategory("unrest_rising", unrestRising, denominator),
      toCategory("overcrowded", overcrowded, denominator),
      toCategory("no_housing_headroom", noHousingHeadroom, denominator),
    ],
  };
}
