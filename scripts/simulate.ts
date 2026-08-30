/**
 * CLI entry point for running economy simulations.
 *
 * Usage:
 *   npm run simulate                                            # Quick sanity check
 *   npm run simulate -- --config experiments/examples/baseline.yaml  # Real experiment
 *   npm run --silent simulate -- --json                         # Quick run, JSON output
 *
 * Options:
 *   --config PATH    Load experiment from YAML config file
 *   --pin PATH       Cohort this run against a baseline run's role partition
 *   --json           Output raw JSON instead of formatted table
 *   --help           Show this help message
 *
 * The two output modes emit different JSON shapes: --config emits one bare
 * HarnessResults, the quick run emits `{ startup, equilibrium }` keyed by horizon
 * and omits the `marketSnapshots` trajectory (see HorizonReport).
 *
 * Redirecting --json needs `npm run --silent`: npm prints its own "> script" banner to
 * stdout, which lands inside the document and makes it unparseable. The script's own
 * progress output already goes to stderr.
 */

// Load `.env` FIRST — before any import that reads process.env at module load (economy-scale.ts resolves
// ECONOMY_SCALE on import). The browser worker resolves the same value from its boot config before the
// constants graph is imported (`resolveHostConfig`), so this keeps the headless harness matched to the
// live game's scale instead of silently diverging. (The code default is 100; this honours an override.)
import "dotenv/config";
import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { parse as parseYaml } from "yaml";
import { runTickHarness } from "../lib/tick-harness/runner";
import {
  ExperimentConfigSchema,
  experimentToHarnessConfig,
  buildExperimentResult,
  parsePinnedRoles,
  pinnedRolesFor,
} from "../lib/tick-harness/experiment";
import type { PinnedRolesDocument } from "../lib/tick-harness/experiment";
import { summarisePopulation, detectPingPong, summariseInfrastructure, summariseSupplyRegimes } from "../lib/tick-harness/population-analysis";
import { summariseColonisation, summariseConstructionPool, CONSTRUCTION_WARMUP_TICKS } from "../lib/tick-harness/build-analysis";
import type { TierZeroIdleSummary } from "../lib/tick-harness/build-analysis";
import { LOGISTICS_WARMUP_TICKS } from "../lib/tick-harness/logistics-analysis";
import { conservationGateFailure } from "../lib/tick-harness/conservation-analysis";
import type { ConservationReport } from "../lib/tick-harness/conservation-analysis";
import { renderTable } from "../lib/tick-harness/table";
import { STRIKE_PARAMS, POPULATION_PARAMS } from "@/lib/constants/population";
import { DEFAULT_SYSTEM_COUNT } from "@/lib/constants/universe-gen";
import { ECONOMY_SCALE, resolveHostConfig, assertHostConfigResolved } from "@/lib/constants/economy-scale";
import { ECONOMY_CONSTANTS } from "@/lib/constants/economy";
import { CYCLE_LENGTH } from "@/lib/constants/tick-cadence";
import { toTickSystems } from "../lib/world/tick";
import { MARKET_ROLES } from "../lib/tick-harness/types";
import type { HarnessConfig, HarnessResults, MarketRole } from "../lib/tick-harness/types";

/**
 * Quick-run horizons. The startup read is early enough that founding and provisioning
 * behaviour is still visible; the equilibrium read is past the economy's ~300-cycle
 * startup transient, which is the only point a constant may be tuned against. Neither
 * substitutes for the other — a short-horizon number is not evidence of an equilibrium
 * fault, and an equilibrium number cannot see a founding fault at all.
 */
const STARTUP_TICKS = 1000;
const EQUILIBRIUM_TICKS = 10000;

type HorizonLabel = "startup" | "equilibrium";

/** What `--json` reports per horizon: the full results minus the market trajectory. */
type HorizonReport = Omit<HarnessResults, "marketSnapshots">;

/**
 * Drop the market trajectory before serialising. It is the bulk of the document at the
 * equilibrium horizon — snapshot row density grows with the galaxy, so it outweighs the
 * startup horizon's copy many times over — and nothing downstream reads it; `marketHealth`
 * is the derived report. Dropped rather than downsampled so the omission is one stated
 * rule instead of a silent sample.
 */
function toHorizonReport(results: HarnessResults): HorizonReport {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- omit-by-rest-destructure
  const { marketSnapshots, ...report } = results;
  return report;
}

// Enforce the import-order invariant the dotenv import above depends on. ES modules
// evaluate imports in source order, and economy-scale.ts resolves ECONOMY_SCALE at
// module load via `resolveHostConfig()` (Node branch: `process.env`) — so an import
// placed above `dotenv/config` that transitively reaches it would bake in the code
// default before .env was read, and every magnitude the run reports would silently
// belong to a different economy than the one requested. Comparing the resolved
// constant against a freshly-read host config (by now, post-dotenv) turns that into
// a crash — retargeted at `resolveHostConfig`, the seam Task 4 introduced, but the
// fault it detects (and the crash it produces) is unchanged.
assertHostConfigResolved(resolveHostConfig(), ECONOMY_SCALE);

// ── Argument parsing ────────────────────────────────────────────

function parseArgs(argv: string[]): {
  json: boolean;
  help: boolean;
  config?: string;
  pin?: string;
} {
  const result: { json: boolean; help: boolean; config: string | undefined; pin: string | undefined } = {
    json: false,
    help: false,
    config: undefined,
    pin: undefined,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--json":
        result.json = true;
        break;
      case "--config":
        result.config = argv[++i];
        break;
      case "--pin":
        result.pin = argv[++i];
        break;
      case "--help":
      case "-h":
        result.help = true;
        break;
    }
  }

  return result;
}

/**
 * Load a baseline arm's role partition off a saved results JSON. `lib/tick-harness` stays fs-free,
 * so the read lives here and the narrowing lives in `experiment.ts`. Exits on any problem: a pin
 * that silently failed to load would produce an arm cohorted against its own membership while
 * reporting itself as pinned, which is the one way this instrument can lie.
 */
function loadPinnedRoles(pinPath: string): PinnedRolesDocument {
  const resolved = path.resolve(pinPath);
  if (!fs.existsSync(resolved)) {
    console.error(`Pin file not found: ${resolved}`);
    process.exit(1);
  }
  const parsed = parsePinnedRoles(fs.readFileSync(resolved, "utf-8"));
  if (!parsed.ok) {
    console.error(`Cannot pin roles from ${resolved}: ${parsed.error}`);
    process.exit(1);
  }
  // An empty partition would "pin" zero markets while the report prints PINNED — refuse it here,
  // where the filename is still in hand.
  const partitions = [parsed.document.single, ...Object.values(parsed.document.byHorizon)];
  if (partitions.every((p) => p === null || Object.keys(p).length === 0)) {
    console.error(
      `Cannot pin roles from ${resolved}: every marketRoles partition in the file is empty — ` +
        `there is nothing to pin to.`,
    );
    process.exit(1);
  }
  return parsed.document;
}

// ── Formatting ──────────────────────────────────────────────────

/** A conservation residual, where the interesting range is float dust — `fmtNum` would round every
 *  one of them to "0" and hide the difference between exact and nearly-exact. */
function fmtResidual(n: number): string {
  if (n === 0) return "0";
  if (!Number.isFinite(n)) return String(n);
  return n.toExponential(2);
}

function fmtNum(n: number): string {
  if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (Math.abs(n) >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toFixed(0);
}

/**
 * Print lines for the tier-0 (extractor) idle-level read — one of the per-body-industry feature's
 * two second-order health reads (the other, shed levels, is `episodeCosts`). A running idle
 * countdown IS one whole idle level (`summariseTierZeroIdle`'s docstring), so the planner's
 * assumed-1.0 tier-0 sizing over-serving a deficit under the worked-prefix fold shows up here as a
 * nonzero count. Exported as its own function (rather than inlined into `formatTable`) so the
 * printed text is unit-testable without constructing a full `HarnessResults` fixture.
 */
export function formatTierZeroIdle(t: TierZeroIdleSummary): string[] {
  return [
    "",
    "Tier-0 Idle Levels — extractor levels currently sitting idle (whole run's final state):",
    `  homeworld: ${fmtNum(t.homeworld.idleLevels)} idle levels over ${t.homeworld.systemsWithIdleTier0} ` +
      `of ${t.homeworld.systemCount} systems`,
    `  colony: ${fmtNum(t.colony.idleLevels)} idle levels over ${t.colony.systemsWithIdleTier0} ` +
      `of ${t.colony.systemCount} systems`,
  ];
}

export function formatTable(results: HarnessResults): string {
  const { marketHealth, roleCoverLevels, worldCohorts, eventImpacts, logisticsActivity, regionOverview, elapsedMs, finalWorld, initialPopulationTotal, initialBuildingTotal, populationSnapshots } = results;

  // Computed once and reused by both the population/unrest and infrastructure
  // summaries below — they used to each call toTickSystems(finalWorld) separately.
  const finalTickSystems = toTickSystems(finalWorld);

  // Market Health and the role breakdown below share one good order, so a good flagged in the
  // first lines up row-for-row with the cohort decomposition that explains it. Alphabetical is
  // the tie-break, keeping the order total for goods with no dispersion reading.
  const dispersionByGood = new Map(marketHealth.priceDispersion.map((d) => [d.goodId, d.avgStdDev]));
  const byDispersion = (a: string, b: string): number =>
    (dispersionByGood.get(b) ?? 0) - (dispersionByGood.get(a) ?? 0) || a.localeCompare(b);

  const lines: string[] = [];

  // Region Overview
  if (regionOverview.length > 0) {
    lines.push("Region Overview:");
    lines.push(...renderTable(
      ["Region", "Government", "Systems"],
      [16, 16, 8],
      regionOverview.map((r) => [r.name, r.dominantGovernmentType, String(r.systemCount)]),
      ["l", "l", "r"],
    ));
    lines.push("");
  }

  lines.push(`Simulation completed in ${elapsedMs.toFixed(0)}ms`);

  // Market health summary
  lines.push("");
  lines.push("Market Health (end of simulation):");

  const dispMap = new Map(marketHealth.priceDispersion.map((d) => [d.goodId, d]));
  const driftMap = new Map(marketHealth.stockDrift.map((d) => [d.goodId, d]));
  const pinMap = new Map(marketHealth.stockPins.map((p) => [p.goodId, p]));
  const coverMap = new Map(marketHealth.coverLevels.map((c) => [c.goodId, c]));
  const allGoods = [...new Set([
    ...marketHealth.priceDispersion.map((d) => d.goodId),
    ...marketHealth.stockDrift.map((d) => d.goodId),
  ])].sort(byDispersion);

  lines.push(...renderTable(
    ["Good", "Price StdDev", "Stock Drift", "Cover", "Deficit %", "Surplus %", "Floor %", "Ceil %"],
    [12, 13, 13, 7, 9, 9, 8, 8],
    allGoods.map((goodId) => {
      const disp = dispMap.get(goodId);
      const drift = driftMap.get(goodId);
      const pin = pinMap.get(goodId);
      const cover = coverMap.get(goodId);
      return [
        goodId,
        disp ? disp.avgStdDev.toFixed(1) : "-",
        drift ? (drift.avgStockDrift >= 0 ? "+" : "") + drift.avgStockDrift.toFixed(1) : "-",
        cover ? cover.medianCover.toFixed(2) + "x" : "-",
        cover ? (cover.deficitFrac * 100).toFixed(0) + "%" : "-",
        cover ? (cover.surplusFrac * 100).toFixed(0) + "%" : "-",
        pin ? (pin.floorFrac * 100).toFixed(0) + "%" : "-",
        pin ? (pin.ceilingFrac * 100).toFixed(0) + "%" : "-",
      ];
    }),
  ));

  const inertTotal = roleCoverLevels.reduce((n, e) => n + e.countByRole.inert, 0);
  const marketTotal = roleCoverLevels.reduce(
    (n, e) => n + e.countByRole.exporter + e.countByRole["self-supplier"] + e.countByRole.consumer + e.countByRole.inert,
    0,
  );
  if (marketTotal > 0) {
    lines.push(
      `  medianCover is over ALL markets of a good — ${inertTotal} of ${marketTotal} ` +
      `(${((inertTotal / marketTotal) * 100).toFixed(1)}%) are inert. See "Cover & price by market role".`,
    );
  }

  // Whether the network is chasing a demand signal that moves under it. Read as an A/B delta,
  // not against a target — a busy network legitimately moves goods on.
  const dh = results.demandHunting;
  lines.push(
    `  demand hunting: ${(dh.flipRate * 100).toFixed(1)}% of decided industrial-input readings ` +
      `reversed the previous one | ${(dh.haulChurnRatio * 100).toFixed(1)}% of delivered tonnage left again`,
  );

  const pl = marketHealth.priceLevels;
  lines.push("");
  lines.push(
    `Price levels (price/base, all markets): median ${pl.median.toFixed(2)}x  ` +
      `p10 ${pl.p10.toFixed(2)}x  p90 ${pl.p90.toFixed(2)}x`,
  );
  lines.push(
    `  cheap <0.9x: ${(pl.cheapFrac * 100).toFixed(0)}%   ` +
      `near 0.9-1.1x: ${(pl.nearFrac * 100).toFixed(0)}%   ` +
      `expensive >1.1x: ${(pl.expensiveFrac * 100).toFixed(0)}%`,
  );

  // Cover by market role — separates "producers drained flat" from "consumers never served",
  // which the galaxy-wide median cannot distinguish because it medians both together.
  if (roleCoverLevels.length > 0) {
    lines.push("");
    lines.push("Cover & price by market role (end of simulation):");

    const cell = (n: number, med: number): string => (n === 0 ? "-" : `${n}/${med.toFixed(2)}`);

    lines.push(...renderTable(
      ["Good", "Exp n/med", "Self n/med", "Cons n/med", "Cons empty%", "Inert n", "Exp price x"],
      [16, 11, 11, 11, 12, 12, 12],
      [...roleCoverLevels]
        .sort((a, b) => byDispersion(a.goodId, b.goodId))
        .map((e) => [
          e.goodId,
          cell(e.countByRole.exporter, e.medianCoverByRole.exporter),
          cell(e.countByRole["self-supplier"], e.medianCoverByRole["self-supplier"]),
          cell(e.countByRole.consumer, e.medianCoverByRole.consumer),
          e.countByRole.consumer > 0 ? `${(e.consumerEmptyFrac * 100).toFixed(0)}%` : "-",
          `${e.countByRole.inert} (${e.trulyInertCount})`,
          e.countByRole.exporter > 0 ? e.exporterMedianPriceRatio.toFixed(2) : "-",
        ]),
    ));

    // Per-arm membership table. Every cover and price figure above is a median WITHIN a role, so
    // two arms are only comparable if their cohorts hold the same markets — read this before
    // reading any delta, and pin the second arm (--pin) when it does not match.
    const membership: Record<MarketRole, number> = {
      exporter: 0, "self-supplier": 0, consumer: 0, inert: 0,
    };
    for (const entry of roleCoverLevels) {
      for (const role of MARKET_ROLES) membership[role] += entry.countByRole[role];
    }
    lines.push(
      `  membership: exporter ${membership.exporter}, self-supplier ${membership["self-supplier"]}, ` +
        `consumer ${membership.consumer}, inert ${membership.inert}` +
        (results.config.pinnedRoles ? "  (PINNED to a baseline partition)" : ""),
    );
    lines.push("  inert = no production, local demand below the MIN_DEMAND pricing floor. Not the same");
    lines.push("  as no demand: a small world can floor for real. Inert n = total (of which 0-demand).");
  }

  // Which term set each producing market's brake geometry — BRAKE_OUTPUT_COVER's tuning
  // evidence. Counts per good sum to the good's producing-market count. Printed unconditionally
  // (even empty) — a silently-skipped section reads identically to a broken instrument.
  {
    lines.push("");
    lines.push("Brake knee binding term (producing markets, end of simulation):");
    if (results.kneeBinding.length === 0) {
      lines.push("  n = 0 producing markets (census empty — check the control/capacity filters).");
    } else {
      lines.push(...renderTable(
        ["Good", "Use", "Output", "Output %"],
        [16, 8, 8, 9],
        [...results.kneeBinding]
          .sort((a, b) => byDispersion(a.goodId, b.goodId))
          .map((e) => {
            const total = e.use + e.output;
            return [
              e.goodId,
              String(e.use),
              String(e.output),
              total > 0 ? `${((e.output / total) * 100).toFixed(0)}%` : "-",
            ];
          }),
        ["l", "r", "r", "r"],
      ));
      lines.push(
        `  output = the working-inventory term (BRAKE_OUTPUT_COVER × capacity) exceeds ` +
          `${ECONOMY_CONSTANTS.BRAKE_USE_COVER} cycles`,
      );
      lines.push(
        `  of the system's use figure (× the event anchor multiplier the use term rides) — the ` +
          `dedicated-exporter cohort BRAKE_OUTPUT_COVER (${ECONOMY_CONSTANTS.BRAKE_OUTPUT_COVER}) exists for.`,
      );
    }
  }

  // Population and unrest summary
  {
    const pop = summarisePopulation(
      finalTickSystems,
      initialPopulationTotal,
      STRIKE_PARAMS.threshold,
      POPULATION_PARAMS.crowdBrakeEnd,
    );
    lines.push("");
    lines.push("Population & Unrest (end of simulation):");

    const pingPong = detectPingPong(populationSnapshots);
    const pRows: [string, string][] = [
      ["Total start", fmtNum(pop.totalStart)],
      ["Total end", fmtNum(pop.totalEnd)],
      ["Growth %", pop.growthPct.toFixed(2) + "%"],
      ["Mean unrest", pop.meanUnrest.toFixed(3)],
      ["Max unrest", pop.maxUnrest.toFixed(3)],
      ["Occupancy (mean pop/cap)", pop.meanOccupancy.toFixed(3)],
      // Pop ≈ popCap is the crowd brake's healthy resting state now (growth runs full-rate to r =
      // 1, then brakes) — this is no longer a saturation pathology, just where a full world sits.
      ["Near cap (≥98%, healthy)", String(pop.saturatedCount)],
      // The actual pathology watch: pinned at the brake (crowdFactor ≤ 0.25) while relief housing
      // exists and land is available means the growth valve is blocked, not that land ran out.
      ["Braked (valve check)", String(pop.brakedCount)],
      ["Emptied (≤1)", String(pop.emptiedCount)],
      // Count and share together: the count alone reads differently as the galaxy grows, and
      // striking is meant to be a transient minority rather than the ambient state.
      ["Striking (≥threshold)", `${pop.strikingCount} (${(pop.strikingShare * 100).toFixed(1)}%)`],
      // Population holding on at popCap ≈ 0 — housing torn out from under residents. Near-absorbing:
      // growth is exactly zero at popCap 0, overshoot-death fires, and the relief valve cannot
      // rebuild until the system is fed. Should read 0; anything else is people who cannot be helped.
      ["Stranded (popCap ≈ 0)", `${pop.strandedCount} (${fmtNum(pop.strandedPopulation)} pop)`],
      ["Ping-pong (migration)", String(pingPong)],
    ];
    lines.push(...renderTable(["Metric", "Value"], [24, 16], pRows.map(([l, v]) => [l, v])));
    lines.push('  meanUnrest is over all settled systems — see "Supply & unrest by world cohort" for the split.');

    const regimes = summariseSupplyRegimes(finalTickSystems, finalWorld.markets, finalWorld.events);
    lines.push("");
    lines.push("Supply regimes (per settled system, end of simulation):");
    const rRows: [string, number, number][] = [
      ["Supplied", regimes.supplied, regimes.suppliedShare],
      ["Strained", regimes.strained, regimes.strainedShare],
      ["Rationing", regimes.rationing, regimes.rationingShare],
      ["Deprived", regimes.deprived, regimes.deprivedShare],
      ["Famine", regimes.famine, regimes.famineShare],
    ];
    lines.push(...renderTable(
      ["Regime", "Systems", "Share"],
      [24, 12, 12],
      rRows.map(([l, n, sh]) => [l, String(n), `${(sh * 100).toFixed(1)}%`]),
    ));
    lines.push(`  mean shortfall ${regimes.meanShortfall.toFixed(3)} over ${regimes.counted} settled systems`);
    lines.push('  mean shortfall and mean unrest average incomparable worlds — see "Supply & unrest by world cohort".');
    lines.push(
      `  Provision: median ${regimes.provisionLevels.median.toFixed(3)}, ` +
        `p10 ${regimes.provisionLevels.p10.toFixed(3)}, p90 ${regimes.provisionLevels.p90.toFixed(3)}`,
    );
    lines.push(
      `  Worst demanded good: median ${regimes.worstGoodLevels.median.toFixed(3)}, ` +
        `p10 ${regimes.worstGoodLevels.p10.toFixed(3)}, p90 ${regimes.worstGoodLevels.p90.toFixed(3)}`,
    );
    // Galaxy-wide adaptive-expectation reading — the harness addition the spec's "Calibration and
    // the gate" section names. A stale (emptyBasket) system is excluded from both distributions
    // rather than folded in with a frozen memory reading — see staleExpectationCount below.
    lines.push(
      `  Expectation (stored memory): median ${regimes.expectationLevels.median.toFixed(3)}, ` +
        `p10 ${regimes.expectationLevels.p10.toFixed(3)}, p90 ${regimes.expectationLevels.p90.toFixed(3)}`,
    );
    lines.push(
      `  Grievance (unrest's actual read): median ${regimes.grievanceLevels.median.toFixed(3)}, ` +
        `p10 ${regimes.grievanceLevels.p10.toFixed(3)}, p90 ${regimes.grievanceLevels.p90.toFixed(3)}` +
        `  |  stale (emptyBasket, excluded above): ${regimes.staleExpectationCount}`,
    );
  }

  // Cohorts overlap by design: a system is in one population band, one of homeworld/colony,
  // and additionally survival-short if it cannot feed itself. Each row's n is its own denominator.
  if (worldCohorts.length > 0) {
    lines.push("");
    lines.push("Supply & unrest by world cohort (end of simulation):");

    lines.push(...renderTable(
      ["Cohort", "n", "shortfall", "Provision", "worst-good", "unrest", "strike%", "Sup/Str/Rat/Dep/Fam %", "net growth%"],
      [16, 6, 9, 10, 11, 8, 9, 30, 12],
      worldCohorts.map((c) => [
        c.cohort,
        String(c.n),
        c.meanShortfall.toFixed(3),
        c.meanProvision.toFixed(3),
        c.worstGoodMedian.toFixed(3),
        c.meanUnrest.toFixed(3),
        `${(c.strikingShare * 100).toFixed(1)}%`,
        `${(c.suppliedShare * 100).toFixed(0)} / ` +
          `${(c.strainedShare * 100).toFixed(0)} / ` +
          `${(c.rationingShare * 100).toFixed(0)} / ` +
          `${(c.deprivedShare * 100).toFixed(0)} / ` +
          `${(c.famineShare * 100).toFixed(0)}`,
        c.netGrowthPct === null ? "n/a" : `${c.netGrowthPct.toFixed(1)}%`,
      ]),
    ));

    lines.push("  cohorts overlap — a system appears in its population band, in homeworld/colony,");
    lines.push("  and in survival-short if it has no arable slot. Each row's n is its own denominator.");
    lines.push("  net growth% is (end pop - start pop) / start pop over the cohort's END-of-run");
    lines.push("  membership, measured from tick 0; n/a only if no start reading was taken at all.");

    // Adaptive-expectation reading, cohorted — the spec's "Calibration and the gate" bullet on
    // expectation/grievance distributions. A cohort with every member stale (emptyBasket) reads
    // n=0/median 0 here rather than a divide-by-zero — see the stale count for why.
    lines.push("");
    lines.push("Adaptive expectation & grievance, by world cohort (end of simulation):");
    lines.push(...renderTable(
      ["Cohort", "n", "Expect median", "Expect p10", "Grievance median", "Grievance p10", "stale"],
      [16, 6, 14, 12, 18, 15, 7],
      worldCohorts.map((c) => [
        c.cohort,
        String(c.n),
        c.expectationLevels.median.toFixed(3),
        c.expectationLevels.p10.toFixed(3),
        c.grievanceLevels.median.toFixed(3),
        c.grievanceLevels.p10.toFixed(3),
        String(c.staleExpectationCount),
      ]),
    ));

    // Quality distribution + the pump watch, cohorted single- vs multi-people-land-body — the
    // fill-best-first fold's live audience. netPopulationChange and colonistDeliveryInflow are
    // deliberately both absolute (not a ratio) so a cohort with positive inflow and negative net
    // population reads as a visible sign disagreement, not a value a smoothing ratio could mask.
    const qualityCohorts = worldCohorts.filter(
      (c) => c.cohort === "quality: single-body" || c.cohort === "quality: multi-body",
    );
    if (qualityCohorts.length > 0) {
      lines.push("");
      lines.push("Habitability quality & the pump watch, by body-count cohort (end of simulation):");
      lines.push(...renderTable(
        ["Cohort", "n", "Quality median", "p10", "p90", "unassessed", "net pop chg", "delivery inflow"],
        [20, 6, 14, 8, 8, 11, 12, 15],
        qualityCohorts.map((c) => [
          c.cohort,
          String(c.n),
          c.qualityLevels.median.toFixed(3),
          c.qualityLevels.p10.toFixed(3),
          c.qualityLevels.p90.toFixed(3),
          String(c.qualityUnassessedCount),
          c.netPopulationChange === null ? "n/a" : fmtNum(c.netPopulationChange),
          fmtNum(c.colonistDeliveryInflow),
        ]),
      ));
      lines.push("  net pop chg and delivery inflow are absolute (not %) so a cohort can show positive");
      lines.push("  delivery alongside negative net population — the pump-watch disagreement signature.");
    }
  }

  // Abandonment by cause (whole run) — Rule 2 fires on below-floor population alone, no famine
  // conjunct; this splits which of the two paths actually drove each abandonment: famine-collapse (Rule 1's
  // crisis term) vs decline-to-empty (marginal-land stress alone, no famine). Printed
  // unconditionally, like episode costs — 0/0 is itself evidence, not a skipped section.
  {
    const ac = results.abandonmentByCause;
    lines.push("");
    lines.push("Abandonment by cause (whole run):");
    lines.push(
      `famine-collapse: ${ac.famineCollapse}, decline-to-empty: ${ac.declineToEmpty}, total: ${ac.total}`,
    );
  }

  // Episode costs — an episode's cost is real and irreversible (teardown, overshoot death), so the
  // gate reads cumulative totals rather than only peak unrest (promise 5). Printed unconditionally:
  // a run with nothing to report reads 0, which is itself evidence, not a skipped section.
  {
    const ec = results.episodeCosts;
    lines.push("");
    lines.push("Episode Costs — cumulative teardown + overshoot death (whole run):");
    lines.push(
      `Galaxy-wide: ${fmtNum(ec.totalTeardownLevels)} building levels torn down, ` +
        `${fmtNum(ec.totalOvershootDeaths)} population lost to overshoot death`,
    );
    if (ec.byCohort.length > 0) {
      lines.push(...renderTable(
        ["Cohort", "n", "Teardown lvls", "w/ teardown", "Overshoot death", "w/ overshoot"],
        [16, 6, 14, 12, 16, 13],
        ec.byCohort.map((c) => [
          c.cohort,
          String(c.n),
          fmtNum(c.teardownLevels),
          String(c.systemsWithTeardown),
          fmtNum(c.overshootDeaths),
          String(c.systemsWithOvershootDeath),
        ]),
      ));
    }
  }

  lines.push(...formatTierZeroIdle(results.tierZeroIdle));

  // The ratchet check — a positive slope (higher trailing Provision variance -> higher mean
  // grievance, at comparable Provision) is the memory rectifying jitter into permanent grievance,
  // a defect per the spec, not a reading. Bucket 0 = calmest quartile, 3 = jitteriest, WITHIN cohort.
  {
    const pr = results.provisionRatchet;
    lines.push("");
    lines.push(`Provision Ratchet Check (trailing window = ${pr.window} periodic samples):`);
    if (pr.buckets.length > 0) {
      lines.push(...renderTable(
        ["Cohort", "Bucket", "n", "mean variance", "mean grievance"],
        [16, 8, 6, 15, 15],
        pr.buckets.map((b) => [
          b.cohort,
          String(b.bucket),
          String(b.n),
          b.meanVariance.toExponential(2),
          b.meanGrievance.toFixed(3),
        ]),
      ));
      lines.push("  bucket 0 = calmest quartile by trailing Provision variance, 3 = jitteriest — WITHIN");
      lines.push("  each cohort. A positive slope (rising mean grievance across 0->3) is the rectifier firing.");
    } else {
      lines.push("  NO READINGS — no settled system carried enough trailing samples this run (short horizon).");
    }
  }

  // Migration throughput (whole run) — reads most meaningfully on a land-tight seed, where colony
  // housing is sized to the seed's own need with no spare level, so growth must lean on the crowd
  // brake + migration push rather than housing absorbing it directly; on a generous-headroom seed, a
  // low number here does not mean the push is broken — housing is doing the absorbing instead.
  {
    const mt = results.migrationThroughput;
    lines.push("");
    lines.push("Migration Throughput (whole run):");
    lines.push(
      `People moved: ${fmtNum(mt.totalColonists + mt.totalDiffusion)} total ` +
        `(colonists ${fmtNum(mt.totalColonists)}, diffusion ${fmtNum(mt.totalDiffusion)}) ` +
        `over ${mt.cycleCount} cycles, mean ${mt.meanPerCycle.toFixed(1)}/cycle`,
    );
  }

  // Strike-suppression rate (whole run) — the number that says how much a strike narrows the
  // planner's second exit (the feedback-gap channel). Read the RATE, never the raw counts: the
  // denominator grows with the galaxy.
  {
    const ss = results.strikeSuppression;
    lines.push("");
    lines.push("Strike-Suppressed Proposals (whole run):");
    lines.push(
      `Rate: ${(ss.ratePerEligible * 100).toFixed(2)}% (${fmtNum(ss.suppressed)} suppressed / ` +
        `${fmtNum(ss.eligible)} eligible pairs)`,
    );
  }

  // Infrastructure decay summary
  {
    const infra = summariseInfrastructure(finalTickSystems, initialBuildingTotal);
    lines.push("");
    lines.push("Infrastructure (end of simulation):");
    const iRows: [string, string][] = [
      ["Built start", fmtNum(infra.builtStart)],
      ["Built end", fmtNum(infra.builtEnd)],
      ["Decayed %", infra.decayedPct.toFixed(2) + "%"],
      ["Collapsed systems (≈0)", String(infra.collapsedCount)],
    ];
    lines.push(...renderTable(["Metric", "Value"], [24, 16], iRows.map(([l, v]) => [l, v])));
  }

  // Colonisation / build-loop health — does a colonised system actually get built out?
  {
    const homeworldIds = new Set(finalWorld.factions.map((f) => f.homeworldId));
    const col = summariseColonisation(finalTickSystems, homeworldIds, finalWorld.constructionProjects);
    lines.push("");
    lines.push("Colonisation & Build Loop (end of simulation):");
    const cRows: [string, number, number][] = [
      ["Developed systems", col.homeworld.count, col.colony.count],
      ["  with tier-0 extraction", col.homeworld.withTier0, col.colony.withTier0],
      ["  with tier-1+ industry", col.homeworld.withTier1Plus, col.colony.withTier1Plus],
      ["  with housing", col.homeworld.withHousing, col.colony.withHousing],
      ["  populated, NO industry", col.homeworld.populatedButNoIndustry, col.colony.populatedButNoIndustry],
      ["  popCap-starved (pop, cap≈0)", col.homeworld.popCapStarved, col.colony.popCapStarved],
      ["  deposits idle (no tier-0)", col.homeworld.depositsIdle, col.colony.depositsIdle],
    ];
    lines.push(...renderTable(
      ["Metric", "Homeworld", "Colony"],
      [30, 12, 12],
      cRows.map(([label, hw, cl]) => [label, String(hw), String(cl)]),
    ));
    lines.push(
      `Construction queue: homeworld ${col.queue.homeworldProjects} projects (${col.queue.homeworldLevels} lvls), ` +
        `colony ${col.queue.colonyProjects} projects (${col.queue.colonyLevels} lvls, ` +
        `mean progress ${(col.queue.colonyMeanProgress * 100).toFixed(0)}%)`,
    );
    const kinds = Object.entries(col.queue.colonyByKind);
    if (kinds.length > 0) {
      lines.push(`  colony projects by kind: ${kinds.map(([k, n]) => `${k}=${n}`).join(", ")}`);
    }
    const fs = results.foundingStock;
    lines.push(
      `Founding stock: ${fs.foundedCount} colonies founded (${fs.sampledCount} reached a first assessment)`,
    );
    // How far the burst SPREAD, which the count alone cannot show: a pacing change slides this mark
    // by hundreds of ticks while the founded count barely moves.
    lines.push(
      `  cadence: ${(fs.cadenceMarkShare * 100).toFixed(0)}% mark ` +
        (fs.cadenceMarkTick !== null
          ? `t=${fs.cadenceMarkTick} — the tick by which ${(fs.cadenceMarkShare * 100).toFixed(0)}% ` +
            `of this run's ${fs.foundedCount} colonies had been founded`
          : "n/a (no colonies founded this run)"),
    );
    if (fs.sampledCount > 0) {
      lines.push(
        `  opening satisfaction (demand-weighted): mean ${fs.meanOpeningSatisfaction.toFixed(2)}, ` +
          `shortfall ${fs.meanOpeningShortfall.toFixed(3)} | ` +
          `opened deprived (<0.50): ${fs.openingDeprivedCount} | ` +
          // The measured floor under promise 1's p10 — a percentile bounds only 90% of the cohort,
          // so the sub-p10 tail is checked against this literal minimum, not inferred from p10.
          `min opening Provision: ${fs.minOpeningProvision !== null ? fs.minOpeningProvision.toFixed(2) : "n/a"}`,
      );
      // A different weighting from the line above (necessity × demand, not demand alone) — reported
      // on its own line so the two quantities are never read as the same number.
      if (fs.meanOpeningProvision !== null && fs.p10OpeningProvision !== null) {
        lines.push(
          `  opening Provision (necessity+demand-weighted): mean ${fs.meanOpeningProvision.toFixed(2)}, ` +
            `p10 ${fs.p10OpeningProvision.toFixed(2)}`,
        );
      }
    }
    // Founding trajectory — unrest promise 1's window half (docs/active/gameplay/economy.md): does
    // the colony stay calm through manifest exhaustion, not just at opening? Buckets by cycles since
    // FOUNDING, not absolute tick, so every colony's own age-60 window lands in the same six rows.
    const ft = results.foundingTrajectory;
    if (ft.buckets.some((b) => b.n > 0)) {
      lines.push("");
      lines.push("  Founding trajectory — Provision & unrest by colony age (samples, not colony count):");
      lines.push(...renderTable(
        ["Age (cycles)", "samples", "Provision mean", "Provision p10", "unrest mean", "unrest p10"],
        [14, 9, 15, 14, 12, 11],
        ft.buckets.map((b) => [
          `${b.ageStartCycles}-${b.ageEndCycles}`,
          String(b.n),
          b.n > 0 ? b.meanProvision.toFixed(3) : "-",
          b.n > 0 ? b.p10Provision.toFixed(3) : "-",
          b.n > 0 ? b.meanUnrest.toFixed(3) : "-",
          b.n > 0 ? b.p10Unrest.toFixed(3) : "-",
        ]),
      ));
    }
    if (fs.foundedCount > 0) {
      lines.push(
        `  cost to founders: mean manifest ${fmtNum(fs.meanManifestTonnage)} t/colony, ` +
          `materials ${fmtNum(fs.meanFoundingMoneyCost)} cr/colony | ` +
          `median founder cover after (binding good, worst staging draw) ` +
          (fs.medianFounderCoverAfter !== null
            ? `${fs.medianFounderCoverAfter.toFixed(2)}×`
            : "n/a (no measurable manifest)"),
      );
    }
    // Founding money and pacing — the two reads that separate "the gate refused" from "the
    // construction pool got smaller", which the founding count alone cannot.
    {
      const era = results.foundingEra;
      const fl = results.foundingLifecycle;
      const fw = era.fixedWindow;
      lines.push(
        `  founding spend: ${fmtNum(era.foundingSpend)} cr over this arm's founding era ` +
          `(t=${era.startupTailEndTick + 1}–${era.eraEndTick ?? results.config.tickCount}` +
          (era.eraCensored ? ", STILL OPEN at run end — censored" : "") +
          `) = ${(era.spendShare * 100).toFixed(2)}% of that era's income (${fmtNum(era.income)} cr)` +
          (era.totalFoundingSpend > era.foundingSpend
            ? ` | ${fmtNum(era.totalFoundingSpend)} cr whole run`
            : "") +
          (fs.foundedCount > 0
            ? ` | ${fmtNum(era.totalFoundingSpend / fs.foundedCount)} cr per colony founded ` +
              `(charter + materials, in-flight staging included)`
            : ""),
      );
      // The arm-comparable half: identical ticks whatever an arm's own founding did, so a baseline
      // and a treatment are measured over the same window by construction.
      lines.push(
        `    fixed window t=${fw.startTick}–${fw.endTick ?? results.config.tickCount} ` +
          `(ARM-COMPARABLE): ${fmtNum(fw.foundingSpend)} cr = ` +
          `${(fw.spendShare * 100).toFixed(2)}% of ${fmtNum(fw.income)} cr over ` +
          `${fmtNum(fw.factionCycles)} faction-cycles`,
      );
      lines.push(
        `  commitment → completion: median ${fl.medianCycles.toFixed(1)} cycles ` +
          `(mean ${fl.meanCycles.toFixed(1)}, max ${fl.maxCycles.toFixed(1)}) over ${fl.sampledCount} colonies` +
          (fl.unobservedCount > 0 ? `, ${fl.unobservedCount} never seen in queue` : "") +
          ` | in flight: mean ${fl.inFlight.meanPerCycle.toFixed(1)}, max ${fl.inFlight.max}` +
          (fl.inFlight.maxTick !== null ? ` @ t=${fl.inFlight.maxTick}` : "") +
          ` over ${fl.inFlight.sampledCycles} cycles`,
      );
      const st = fl.stalls;
      lines.push(
        `  what gated in-flight colonies (${fmtNum(st.observed)} colony-cycles): ` +
          `charter ${fmtNum(st.charter)} | funds ${fmtNum(st.funds)} | pool ${fmtNum(st.pool)} | ` +
          `ungated ${fmtNum(st.unGated)} | write-off counter advanced ${fmtNum(st.stalled)}`,
      );
      lines.push(
        `    founder could not spare the full want (informational — still builds): ` +
          `${fmtNum(st.materialsShort)}, of which ${fmtNum(st.materialsShortUnderEvent)} under an ` +
          `active founder event`,
      );
      const fc = results.founderCohort;
      lines.push(
        `  founders vs other developed systems: ` +
          `production ${fmtNum(fc.founder.meanRealisedProduction)} vs ` +
          `${fmtNum(fc.other.meanRealisedProduction)} /system | ` +
          `suppressed markets ${(fc.founder.productionSuppressedShare * 100).toFixed(1)}% vs ` +
          `${(fc.other.productionSuppressedShare * 100).toFixed(1)}% | ` +
          `disuse countdowns ${fc.founder.meanIdleTypes.toFixed(2)} vs ` +
          `${fc.other.meanIdleTypes.toFixed(2)} types/system ` +
          `(n=${fc.founder.systemCount} vs ${fc.other.systemCount})`,
      );
    }
    const cp = summariseConstructionPool(finalTickSystems, finalWorld.constructionProjects);
    lines.push(
      `Construction pool: base ${fmtNum(cp.poolBase)} + centres ${fmtNum(cp.poolCentres)} ` +
        `(${(cp.centreShare * 100).toFixed(1)}% centre) | centres built ${cp.centreLevels}, in flight ${cp.centreProjects}`,
    );
    lines.push(
      `  queue: ${fmtNum(cp.queueRemainingWork)} work remaining` +
        (cp.queueEtaCycles !== null ? ` ≈ ${cp.queueEtaCycles.toFixed(1)} cycles at current pool` : " (pool is zero — stalled)"),
    );
  }

  // Construction burst pacing (whole run) — proves the construction rate cap
  // (DIRECTED_BUILD.BUILD_RATE_CAP) actually bounds new-proposal velocity per cycle, per good.
  {
    const bb = results.buildBurstSummary;
    lines.push("");
    lines.push("Construction Burst Pacing (whole run):");
    if (bb.byGood.length > 0) {
      lines.push(`Worst burst: ${bb.worstGood} +${bb.globalMax} levels in one cycle @ t=${bb.worstTick}`);
      const top = bb.byGood
        .slice(0, 5)
        .map((g) => `${g.goodId} +${g.maxLevelsPerCycle} (t=${g.tick})`)
        .join(", ");
      lines.push(`  worst per good: ${top}`);
    } else {
      lines.push("  NOTHING COMMITTED — directed-build recorded no autonomic production proposals this run");
    }
    if (results.config.tickCount < CONSTRUCTION_WARMUP_TICKS) {
      lines.push(
        `  warm-up: ${results.config.tickCount} ticks is below the ~${CONSTRUCTION_WARMUP_TICKS}-tick construction ` +
        `warm-up window — a structural deficit only becomes a fundable proposal after the two-reference-cycle ` +
        `persistence window, and the first cycle lands at the construction interval, so read low activity as ` +
        `"too early", not "broken" (colony-driven bursts lag colonisation further; a matured read needs ~1500 ticks).`,
      );
    }
  }

  // Faction treasury health — the coarse health bar for money.
  {
    const ts = results.treasurySummary;
    lines.push("");
    lines.push("Treasury (end of simulation):");
    lines.push(
      `Treasury: ${ts.factionCount} factions | balance mean ${fmtNum(ts.meanBalance)} ` +
        `(min ${fmtNum(ts.minBalance)}, max ${fmtNum(ts.maxBalance)}) | ` +
        `income ${(ts.headsShare * 100).toFixed(0)}% heads / ${(ts.productionShare * 100).toFixed(0)}% production`,
    );
    lines.push(
      `  funded: maint ${(ts.fundedMeans.maintenance * 100).toFixed(0)}% | ` +
        `logi ${(ts.fundedMeans.logistics * 100).toFixed(0)}% | ` +
        `constr ${(ts.fundedMeans.construction * 100).toFixed(0)}%` +
        (ts.firstShortfallTick !== null ? ` | first shortfall t=${ts.firstShortfallTick}` : " | never shorted") +
        (ts.invalidRows > 0 ? ` | ⚠ ${ts.invalidRows} INVALID ROWS` : ""),
    );
    // Shortfalls split by whether the faction-cycle carried a founding charge. The roster means
    // above read ~1.000 while the shorted tail triples, and the startup tail shorts before the
    // first founding ever happens — neither is readable without this split.
    const era = results.foundingEra;
    lines.push(
      `  founding-era faction-cycles ` +
        `(t=${era.startupTailEndTick + 1}–${era.eraEndTick ?? results.config.tickCount}): ` +
        `${fmtNum(era.factionCycles)} | ` +
        `shorted WITH founding ${(era.withFounding.share * 100).toFixed(2)}% ` +
        `(${era.withFounding.shorted}/${era.withFounding.cycles}) vs ` +
        `WITHOUT ${(era.withoutFounding.share * 100).toFixed(2)}% ` +
        `(${era.withoutFounding.shorted}/${era.withoutFounding.cycles}) | ` +
        `outside the era: startup tail ${era.startupTail.shorted}/${era.startupTail.cycles}, ` +
        `post-era ${era.postEra.shorted}/${era.postEra.cycles} (in no bar)` +
        (era.invalidRows > 0 ? ` | ⚠ ${era.invalidRows} INVALID ROWS` : ""),
    );
    lines.push(
      `  founding-era funded fractions: maintenance ` +
        (era.fundedMaintenance !== null
          ? `median ${era.fundedMaintenance.median.toFixed(3)}, ` +
            `p10 ${era.fundedMaintenance.p10.toFixed(3)}, min ${era.fundedMaintenance.min.toFixed(3)}`
          : "n/a (no founding-era cycles)") +
        ` | construction ` +
        (era.fundedConstruction !== null
          ? `median ${era.fundedConstruction.median.toFixed(3)}, ` +
            `p10 ${era.fundedConstruction.p10.toFixed(3)}, ` +
            `min ${era.fundedConstruction.min.toFixed(3)} over ` +
            `${fmtNum(era.billedConstructionCycles)} BILLED cycles`
          : "n/a (no billed cycle)"),
    );
  }

  // Conservation identities — the pass/fail half of the acceptance bar. Printed whatever the run
  // did: a missing line is indistinguishable from a passing one, and these are the reads a broken
  // founding ledger shows up in rather than as a number someone has to judge.
  {
    const cons = results.conservation;
    lines.push("");
    lines.push(
      `Conservation identities (pass/fail, relative tolerance ${cons.tolerance.toExponential(0)}):`,
    );
    for (const c of cons.checks) {
      lines.push(
        `  ${c.pass ? "PASS" : "FAIL"} ${c.name.padEnd(42)} ` +
          `${fmtNum(c.left)} vs ${fmtNum(c.right)} | residual ${fmtResidual(c.residual)}`,
      );
      lines.push(`       ${c.note}`);
    }
    if (!cons.allPass) {
      lines.push("  ⚠ AN IDENTITY FAILED — the founding ledger is out, not merely mistuned.");
    }
  }

  // Logistics activity — did directed-logistics actually move anything?
  {
    const lg = logisticsActivity;
    lines.push("");
    lines.push("Logistics Activity (whole run):");
    const lRows: [string, string][] = [
      ["Transfers", fmtNum(lg.transferCount)],
      ["Ticks with transfers", String(lg.activeTicks)],
      ["Quantity moved", fmtNum(lg.totalQuantity)],
      ["Mean transfer size", lg.meanTransferSize.toFixed(1)],
      ["Systems participating", String(lg.participatingSystems)],
      ["Goods moved", String(lg.byGood.length)],
      ["Budget spent frac", lg.budgetSpentFrac.toFixed(3)],
      ["Funding-bound events", fmtNum(lg.fundingBoundEvents)],
      ["Funding-bound set rate", lg.fundingBoundFlagSetRate.toFixed(3)],
      ["Flow rows per cycle", lg.flowRowsPerCycle.toFixed(1)],
    ];
    lines.push(...renderTable(["Metric", "Value"], [24, 16], lRows.map(([l, v]) => [l, v])));
    if (lg.byGood.length > 0) {
      const top = lg.byGood.slice(0, 5).map((g) => `${g.goodId} ${fmtNum(g.quantity)}`).join(", ");
      lines.push(`  heaviest goods: ${top}`);
    } else {
      lines.push("  NOTHING MOVED — directed-logistics recorded no transfers this run");
    }
    if (results.config.tickCount < LOGISTICS_WARMUP_TICKS) {
      lines.push(
        `  warm-up: ${results.config.tickCount} ticks is below the ~${LOGISTICS_WARMUP_TICKS}-tick logistics ` +
        `warm-up window — directed-logistics is colonisation-gated and moves nothing before ~tick 4152 at ` +
        `default scale, so read low activity as "too early", not "broken" (a matured read needs ~5600 ticks).`,
      );
    }
  }

  // Event impact (top 20 only — full list in JSON output)
  if (eventImpacts.length > 0) {
    const topEvents = eventImpacts.slice(0, 20);
    lines.push("");
    lines.push(`Event Impact (top ${topEvents.length} of ${eventImpacts.length}):`);

    const eWidths = [20, 16, 12, 9, 30];

    lines.push(...renderTable(
      ["Type", "System", "Ticks", "Price Δ", "Top Movers"],
      eWidths,
      topEvents.map((e) => {
        const priceSign = e.weightedPriceImpactPct >= 0 ? "+" : "";
        const topMovers = [...e.goodPriceChanges]
          .sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct))
          .slice(0, 2)
          .map((g) => `${g.goodId} ${g.changePct >= 0 ? "+" : ""}${g.changePct.toFixed(0)}%`)
          .join(", ");
        return [
          e.eventType,
          e.systemName.length > eWidths[1] ? e.systemName.slice(0, eWidths[1] - 2) + ".." : e.systemName,
          `${e.startTick}-${e.endTick}`,
          `${priceSign}${e.weightedPriceImpactPct.toFixed(1)}%`,
          topMovers || "-",
        ];
      }),
      ["l", "l", "l", "r", "l"],
    ));
  } else {
    lines.push("");
    lines.push("Event Impact: no events occurred during simulation");
  }

  return lines.join("\n");
}

// ── Experiment runner ───────────────────────────────────────────

async function runExperiment(
  configPath: string,
  jsonOutput: boolean,
  pinned?: PinnedRolesDocument,
): Promise<ConservationReport> {
  const resolved = path.resolve(configPath);
  if (!fs.existsSync(resolved)) {
    console.error(`Config file not found: ${resolved}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(resolved, "utf-8");
  const parsed = parseYaml(raw);

  const validated = ExperimentConfigSchema.safeParse(parsed);
  if (!validated.success) {
    console.error("Invalid experiment config:");
    for (const issue of validated.error.issues) {
      console.error(`  ${issue.path.join(".")}: ${issue.message}`);
    }
    process.exit(1);
  }

  const { config, label } = experimentToHarnessConfig(validated.data);
  // `loadPinnedRoles` promises to exit on any problem — and a pin that silently applies to
  // nothing is exactly such a problem. A horizon-keyed document (the quick run's shape) carries
  // no single partition, and a --config run cannot choose a horizon on the user's behalf.
  let pinnedRoles: Record<string, MarketRole> | undefined;
  if (pinned) {
    pinnedRoles = pinnedRolesFor(pinned);
    if (pinnedRoles === undefined) {
      console.error(
        "The pin file is keyed by horizon (a quick-run --json report) and carries no single " +
          "partition, so a --config run cannot use it. Pin to a saved --config result " +
          "(experiments/*.json) or a bare --config --json document instead.",
      );
      process.exit(1);
    }
  }

  // Status goes to stderr so `--json > file` stays valid JSON, matching the quick-run path.
  console.error(
    `Running experiment${label ? ` "${label}"` : ""}: ` +
    `${config.tickCount} ticks, seed ${config.seed}, ${config.systemCount} systems, ` +
    `economy scale ${ECONOMY_SCALE}` +
    (pinnedRoles ? `, cohorts pinned to ${Object.keys(pinnedRoles).length} baseline markets` : "") +
    `\n`,
  );

  const results = await runTickHarness({ ...config, pinnedRoles }, label);

  if (jsonOutput) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    console.log(formatTable(results));
  }

  // Save result to experiments/ directory
  const experimentsDir = path.resolve("experiments");
  if (!fs.existsSync(experimentsDir)) {
    fs.mkdirSync(experimentsDir, { recursive: true });
  }

  const slug = (label ?? path.basename(configPath, path.extname(configPath)))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const outFile = path.join(experimentsDir, `${slug}-${timestamp}.json`);

  const result = buildExperimentResult(results);
  fs.writeFileSync(outFile, JSON.stringify(result, null, 2));
  console.error(`\nResult saved to ${path.relative(process.cwd(), outFile)}`);

  return { label: label ?? slug, summary: results.conservation };
}

// ── Main ────────────────────────────────────────────────────────

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  console.log(`
Economy Simulator — Stellar Trader

Usage:
  npm run simulate -- [options]

Options:
  --config PATH    Load experiment from YAML config file (saves result to experiments/)
  --pin PATH       Take cohort membership from a baseline run's saved JSON
                   (its "marketRoles") instead of classifying this run's markets
                   live. Cover and price are medians WITHIN a role, and the role
                   classifier reads the demand figure — so without a pin the two
                   arms of an A/B can differ by cohort mix alone. A horizon-keyed
                   document pins each horizon to its own. See --json below for
                   how to write the baseline file.
  --json           Output JSON instead of table. The quick run emits
                   { startup, equilibrium } keyed by horizon and omits the
                   marketSnapshots trajectory; --config emits one bare result.
                   Progress goes to stderr so stdout stays a clean document —
                   but redirecting still needs "npm run --silent", or npm's own
                   "> script" banner lands inside the JSON.
  --help           Show this help

Exit code:
  0 if every conservation identity held, 1 if any failed — in either mode, and
  after the run's own report is written. A failed identity means the founding
  ledger is out rather than mistuned, so nothing the run measured is evidence
  for anything until it holds.

Quick Run:
  Running with no flags generates the default-scale world (${DEFAULT_SYSTEM_COUNT}
  systems, seed 42) and runs it over TWO horizons, reporting market/population/
  infrastructure health for each:

    startup      ${STARTUP_TICKS} ticks (${Math.floor(STARTUP_TICKS / CYCLE_LENGTH)} cycles)  — founding + provisioning behaviour
    equilibrium  ${EQUILIBRIUM_TICKS} ticks (${Math.floor(EQUILIBRIUM_TICKS / CYCLE_LENGTH)} cycles) — the settled galaxy

  Both are reported because they answer different questions. The economy's startup
  transient runs ~300+ cycles, so a short read routinely shows a transient as a fault
  — never tune a constant against the startup horizon. Equally, the equilibrium read
  cannot see a founding fault at all. Takes ~2 minutes.

  For custom parameters, use --config with a YAML file — see experiments/examples/
  for templates.

Examples:
  npm run simulate                                                 # Quick sanity check
  npm run simulate -- --config experiments/examples/baseline.yaml  # Experiment from YAML
  npm run --silent simulate -- --json > run.json                   # Quick run, JSON output

  # A/B with cohort membership held fixed — write the baseline, then pin arm two to it:
  npm run --silent simulate -- --json > baseline.json
  npm run simulate -- --pin baseline.json
`);
  process.exit(0);
}

/**
 * Exit non-zero if any conservation identity failed, after the run's own output is written.
 *
 * `process.exitCode` rather than `process.exit()`: the JSON document on stdout is megabytes and its
 * write is asynchronous through a pipe, so exiting outright truncates it — the caller would be told
 * the run failed and handed an unparseable report of why.
 */
function failOnBrokenIdentities(reports: ReadonlyArray<ConservationReport>): void {
  const failure = conservationGateFailure(reports);
  if (failure === null) return;
  console.error(`\n${failure}`);
  process.exitCode = 1;
}

// Config mode vs quick-run mode
async function main(): Promise<void> {
  const pinnedDocument = args.pin ? loadPinnedRoles(args.pin) : undefined;

  // Every run this invocation performed, checked as one gate at the end. A failed identity is a
  // broken ledger rather than a mistuned number, so it exits non-zero instead of only printing FAIL
  // into a report someone has to read to the bottom of.
  const conservation: ConservationReport[] = [];

  if (args.config) {
    conservation.push(await runExperiment(args.config, args.json, pinnedDocument));
    failOnBrokenIdentities(conservation);
    return;
  }

  // Two horizons, because they answer different questions and neither is optional.
  // The startup read is the only place founding/provisioning faults are visible; the
  // equilibrium read is the only valid basis for tuning a constant. The economy's startup
  // transient runs ~300+ cycles, so anything shorter reports a transient as a fault —
  // see AGENTS.md, "Verifying changes".
  const horizons: { label: HorizonLabel; asks: string; config: HarnessConfig }[] = [
    {
      label: "startup",
      asks: "founding + provisioning behaviour — NOT a basis for tuning",
      config: { systemCount: DEFAULT_SYSTEM_COUNT, seed: 42, tickCount: STARTUP_TICKS },
    },
    {
      label: "equilibrium",
      asks: "the settled galaxy — the only valid basis for tuning",
      config: { systemCount: DEFAULT_SYSTEM_COUNT, seed: 42, tickCount: EQUILIBRIUM_TICKS },
    },
  ];

  const jsonOut: Partial<Record<HorizonLabel, HorizonReport>> = {};

  for (const h of horizons) {
    const cycles = Math.floor(h.config.tickCount / CYCLE_LENGTH);
    const banner =
      `${h.label.toUpperCase()} — ${h.config.tickCount} ticks (${cycles} cycles), ` +
      `${h.config.systemCount} systems, seed ${h.config.seed}, economy scale ${ECONOMY_SCALE}`;

    if (args.json) {
      // The run takes minutes and --json holds all output until the end, so the banner
      // goes to stderr — it reports progress without corrupting the piped document.
      console.error(`${banner} — running…`);
    } else {
      console.log("═".repeat(78));
      console.log(banner);
      console.log(`  answers: ${h.asks}`);
      console.log("═".repeat(78) + "\n");
    }

    // Each horizon pins to its OWN horizon in the baseline document — an equilibrium arm cohorted
    // against a startup partition would be measured over a membership neither arm has.
    const results = await runTickHarness({
      ...h.config,
      pinnedRoles: pinnedDocument ? pinnedRolesFor(pinnedDocument, h.label) : undefined,
    });

    conservation.push({ label: h.label, summary: results.conservation });

    if (args.json) jsonOut[h.label] = toHorizonReport(results);
    else console.log(formatTable(results) + "\n");
  }

  if (args.json) console.log(JSON.stringify(jsonOut, null, 2));

  // After BOTH horizons, never between them: the startup and equilibrium reads answer different
  // questions, and a gate that aborted at the first failure would throw away the other one's
  // evidence about the same broken ledger.
  failOnBrokenIdentities(conservation);
}

// Guarded so the module can be imported for its pure formatters (e.g. `formatTierZeroIdle`) —
// by a test, or any future caller — without running the whole CLI as a side effect of import.
// `tsx scripts/simulate.ts` (the npm script) sets `process.argv[1]` to this file, so the URL
// comparison is true only when the file is the actual entry point.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
