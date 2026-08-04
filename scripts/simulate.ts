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
// ECONOMY_SCALE on import). The Next.js dev server auto-loads .env; this makes the headless harness match
// the live game's scale instead of silently diverging. (The code default is 100; this honours an override.)
import "dotenv/config";
import * as fs from "node:fs";
import * as path from "node:path";
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
import { summarizePopulation, detectPingPong, summarizeInfrastructure, summarizeSupplyRegimes } from "../lib/tick-harness/population-analysis";
import { summarizeColonisation, summarizeConstructionPool, CONSTRUCTION_WARMUP_TICKS } from "../lib/tick-harness/build-analysis";
import { LOGISTICS_WARMUP_TICKS } from "../lib/tick-harness/logistics-analysis";
import { renderTable } from "../lib/tick-harness/table";
import { STRIKE_PARAMS, POPULATION_PARAMS } from "@/lib/constants/population";
import { DEFAULT_SYSTEM_COUNT } from "@/lib/constants/universe-gen";
import { ECONOMY_SCALE, toEconomyScale } from "@/lib/constants/economy-scale";
import { CYCLE_LENGTH } from "@/lib/constants/tick-cadence";
import { toTickSystems } from "../lib/world/tick";
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

/** Roles the per-arm membership line totals, in report order. */
const MEMBERSHIP_ROLES: MarketRole[] = ["exporter", "self-supplier", "consumer", "inert"];

/** What `--json` reports per horizon: the full results minus the market trajectory. */
type HorizonReport = Omit<HarnessResults, "marketSnapshots">;

/**
 * Drop the market trajectory before serializing. It is the bulk of the document at the
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
// module load — so an import placed above `dotenv/config` that transitively reaches
// it would bake in the code default before .env was read, and every magnitude the
// run reports would silently belong to a different economy than the one requested.
// Comparing the resolved constant against the environment turns that into a crash.
if (process.env.ECONOMY_SCALE !== undefined) {
  const requested = toEconomyScale(process.env.ECONOMY_SCALE);
  if (requested !== ECONOMY_SCALE) {
    throw new Error(
      `ECONOMY_SCALE mismatch: the environment asks for ${requested}, but the constants resolved to ` +
        `${ECONOMY_SCALE}. An import above "dotenv/config" in scripts/simulate.ts reached ` +
        `lib/constants/economy-scale.ts before .env was loaded — move it below the dotenv import.`,
    );
  }
}

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
  return parsed.document;
}

// ── Formatting ──────────────────────────────────────────────────

function fmtNum(n: number): string {
  if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (Math.abs(n) >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toFixed(0);
}

function formatTable(results: HarnessResults): string {
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
      for (const role of MEMBERSHIP_ROLES) membership[role] += entry.countByRole[role];
    }
    lines.push(
      `  membership: exporter ${membership.exporter}, self-supplier ${membership["self-supplier"]}, ` +
        `consumer ${membership.consumer}, inert ${membership.inert}` +
        (results.config.pinnedRoles ? "  (PINNED to a baseline partition)" : ""),
    );
    lines.push("  inert = no production, local demand below the MIN_DEMAND pricing floor. Not the same");
    lines.push("  as no demand: a small world can floor for real. Inert n = total (of which 0-demand).");
  }

  // Population and unrest summary
  {
    const pop = summarizePopulation(
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

    const regimes = summarizeSupplyRegimes(finalTickSystems, finalWorld.markets, finalWorld.events);
    lines.push("");
    lines.push("Supply regimes (per settled system, end of simulation):");
    const rRows: [string, number, number][] = [
      ["Supplied", regimes.supplied, regimes.suppliedShare],
      ["Rationing", regimes.rationing, regimes.rationingShare],
      ["Shortage", regimes.shortage, regimes.shortageShare],
    ];
    lines.push(...renderTable(
      ["Regime", "Systems", "Share"],
      [24, 12, 12],
      rRows.map(([l, n, sh]) => [l, String(n), `${(sh * 100).toFixed(1)}%`]),
    ));
    lines.push(`  mean D ${regimes.meanDissatisfaction.toFixed(3)} over ${regimes.counted} settled systems`);
    lines.push('  mean D and mean unrest average incomparable worlds — see "Supply & unrest by world cohort".');
  }

  // Cohorts overlap by design: a system is in one population band, one of homeworld/colony,
  // and additionally survival-short if it cannot feed itself. Each row's n is its own denominator.
  if (worldCohorts.length > 0) {
    lines.push("");
    lines.push("Supply & unrest by world cohort (end of simulation):");

    lines.push(...renderTable(
      ["Cohort", "n", "mean D", "unrest", "strike%", "Sup/Rat/Sho %"],
      [16, 6, 8, 8, 9, 20],
      worldCohorts.map((c) => [
        c.cohort,
        String(c.n),
        c.meanDissatisfaction.toFixed(3),
        c.meanUnrest.toFixed(3),
        `${(c.strikingShare * 100).toFixed(1)}%`,
        `${(c.suppliedShare * 100).toFixed(0)} / ` +
          `${(c.rationingShare * 100).toFixed(0)} / ` +
          `${(c.shortageShare * 100).toFixed(0)}`,
      ]),
    ));

    lines.push("  cohorts overlap — a system appears in its population band, in homeworld/colony,");
    lines.push("  and in survival-short if it has no arable slot. Each row's n is its own denominator.");
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

  // Infrastructure decay summary
  {
    const infra = summarizeInfrastructure(finalTickSystems, initialBuildingTotal);
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
    const col = summarizeColonisation(finalTickSystems, homeworldIds, finalWorld.constructionProjects);
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
    if (fs.sampledCount > 0) {
      lines.push(
        `  opening satisfaction (demand-weighted): mean ${fs.meanOpeningSatisfaction.toFixed(2)}, ` +
          `dissatisfaction ${fs.meanOpeningDissatisfaction.toFixed(3)} | ` +
          `opened deprived (<0.50): ${fs.openingDeprivedCount}`,
      );
    }
    if (fs.foundedCount > 0) {
      lines.push(
        `  cost to founders: mean manifest ${fmtNum(fs.meanManifestTonnage)} t/colony | ` +
          `median founder cover after (binding good) ${fs.medianFounderCoverAfter.toFixed(2)}×`,
      );
    }
    const cp = summarizeConstructionPool(finalTickSystems, finalWorld.constructionProjects);
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
        `warm-up window — directed-logistics is colonisation-gated and barely moves before ~tick 456 at ` +
        `default scale, so read low activity as "too early", not "broken" (a matured read needs ~1500 ticks).`,
      );
    }
  }

  // Event impact (top 20 only — full list in JSON output)
  if (eventImpacts.length > 0) {
    const topEvents = eventImpacts.slice(0, 20);
    lines.push("");
    lines.push(`Event Impact (top ${topEvents.length} of ${eventImpacts.length}):`);

    const eWidths = [20, 16, 12, 5, 9, 30];

    lines.push(...renderTable(
      ["Type", "System", "Ticks", "Sev", "Price Δ", "Top Movers"],
      eWidths,
      topEvents.map((e) => {
        const priceSign = e.weightedPriceImpactPct >= 0 ? "+" : "";
        const topMovers = [...e.goodPriceChanges]
          .sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct))
          .slice(0, 2)
          .map((g) => `${g.goodId} ${g.changePct >= 0 ? "+" : ""}${g.changePct.toFixed(0)}%`)
          .join(", ");
        return [
          e.parentEventType !== null ? `  └ ${e.eventType}` : e.eventType,
          e.systemName.length > eWidths[1] ? e.systemName.slice(0, eWidths[1] - 2) + ".." : e.systemName,
          `${e.startTick}-${e.endTick}`,
          e.severity.toFixed(1),
          `${priceSign}${e.weightedPriceImpactPct.toFixed(1)}%`,
          topMovers || "-",
        ];
      }),
      ["l", "l", "l", "r", "r", "l"],
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
): Promise<void> {
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
  const pinnedRoles = pinned ? pinnedRolesFor(pinned) : undefined;

  console.log(
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
  console.log(`\nResult saved to ${path.relative(process.cwd(), outFile)}`);
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

// Config mode vs quick-run mode
async function main(): Promise<void> {
  const pinnedDocument = args.pin ? loadPinnedRoles(args.pin) : undefined;

  if (args.config) {
    await runExperiment(args.config, args.json, pinnedDocument);
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

    if (args.json) jsonOut[h.label] = toHorizonReport(results);
    else console.log(formatTable(results) + "\n");
  }

  if (args.json) console.log(JSON.stringify(jsonOut, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
