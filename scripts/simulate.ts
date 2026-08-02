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
} from "../lib/tick-harness/experiment";
import { summarizePopulation, detectPingPong, summarizeInfrastructure, summarizeSupplyRegimes } from "../lib/tick-harness/population-analysis";
import { summarizeColonisation, summarizeConstructionPool, CONSTRUCTION_WARMUP_TICKS } from "../lib/tick-harness/build-analysis";
import { LOGISTICS_WARMUP_TICKS } from "../lib/tick-harness/logistics-analysis";
import { STRIKE_PARAMS, POPULATION_PARAMS } from "@/lib/constants/population";
import { DEFAULT_SYSTEM_COUNT } from "@/lib/constants/universe-gen";
import { ECONOMY_SCALE, toEconomyScale } from "@/lib/constants/economy-scale";
import { CYCLE_LENGTH } from "@/lib/constants/tick-cadence";
import { toTickSystems } from "../lib/world/tick";
import type { HarnessConfig, HarnessResults } from "../lib/tick-harness/types";

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
} {
  const result: { json: boolean; help: boolean; config: string | undefined } = {
    json: false,
    help: false,
    config: undefined,
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
      case "--help":
      case "-h":
        result.help = true;
        break;
    }
  }

  return result;
}

// ── Formatting ──────────────────────────────────────────────────

function pad(str: string, width: number): string {
  return str.padEnd(width);
}

function rpad(str: string, width: number): string {
  return str.padStart(width);
}

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

  const lines: string[] = [];

  // Region Overview
  if (regionOverview.length > 0) {
    lines.push("Region Overview:");

    const roHeaders = ["Region", "Government", "Systems"];
    const roWidths = [16, 16, 8];

    lines.push(roHeaders.map((h, i) => pad(h, roWidths[i])).join(" | "));
    lines.push(roWidths.map((w) => "-".repeat(w)).join("-+-"));

    for (const r of regionOverview) {
      const row = [
        pad(r.name, roWidths[0]),
        pad(r.dominantGovernmentType, roWidths[1]),
        rpad(String(r.systemCount), roWidths[2]),
      ];
      lines.push(row.join(" | "));
    }

    lines.push("");
  }

  lines.push(`Simulation completed in ${elapsedMs.toFixed(0)}ms`);

  // Market health summary
  if (marketHealth) {
    lines.push("");
    lines.push("Market Health (end of simulation):");

    const dHeaders = ["Good", "Price StdDev", "Stock Drift", "Cover", "Deficit %", "Surplus %", "Floor %", "Ceil %"];
    const dWidths = [12, 13, 13, 7, 9, 9, 8, 8];

    lines.push(dHeaders.map((h, i) => pad(h, dWidths[i])).join(" | "));
    lines.push(dWidths.map((w) => "-".repeat(w)).join("-+-"));

    const dispMap = new Map(marketHealth.priceDispersion.map((d) => [d.goodId, d]));
    const driftMap = new Map(marketHealth.stockDrift.map((d) => [d.goodId, d]));
    const pinMap = new Map(marketHealth.stockPins.map((p) => [p.goodId, p]));
    const coverMap = new Map(marketHealth.coverLevels.map((c) => [c.goodId, c]));
    const allGoods = [...new Set([
      ...marketHealth.priceDispersion.map((d) => d.goodId),
      ...marketHealth.stockDrift.map((d) => d.goodId),
    ])];

    allGoods.sort((a, b) => (dispMap.get(b)?.avgStdDev ?? 0) - (dispMap.get(a)?.avgStdDev ?? 0));

    for (const goodId of allGoods) {
      const disp = dispMap.get(goodId);
      const drift = driftMap.get(goodId);
      const pin = pinMap.get(goodId);
      const cover = coverMap.get(goodId);
      const row = [
        pad(goodId, dWidths[0]),
        rpad(disp ? disp.avgStdDev.toFixed(1) : "-", dWidths[1]),
        rpad(drift ? (drift.avgStockDrift >= 0 ? "+" : "") + drift.avgStockDrift.toFixed(1) : "-", dWidths[2]),
        rpad(cover ? cover.medianCover.toFixed(2) + "x" : "-", dWidths[3]),
        rpad(cover ? (cover.deficitFrac * 100).toFixed(0) + "%" : "-", dWidths[4]),
        rpad(cover ? (cover.surplusFrac * 100).toFixed(0) + "%" : "-", dWidths[5]),
        rpad(pin ? (pin.floorFrac * 100).toFixed(0) + "%" : "-", dWidths[6]),
        rpad(pin ? (pin.ceilingFrac * 100).toFixed(0) + "%" : "-", dWidths[7]),
      ];
      lines.push(row.join(" | "));
    }

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
  }

  // Cover by market role — separates "producers drained flat" from "consumers never served",
  // which the galaxy-wide median cannot distinguish because it medians both together.
  if (roleCoverLevels.length > 0) {
    lines.push("");
    lines.push("Cover & price by market role (end of simulation):");

    const rHeaders = ["Good", "Exp n/med", "Self n/med", "Cons n/med", "Cons empty%", "Inert n", "Exp price x"];
    const rWidths = [16, 11, 11, 11, 12, 8, 12];

    lines.push(rHeaders.map((h, i) => (i === 0 ? pad(h, rWidths[i]) : rpad(h, rWidths[i]))).join(" | "));
    lines.push(rWidths.map((w) => "-".repeat(w)).join("-+-"));

    const cell = (n: number, med: number): string => (n === 0 ? "-" : `${n}/${med.toFixed(2)}`);

    for (const e of roleCoverLevels) {
      lines.push([
        pad(e.goodId, rWidths[0]),
        rpad(cell(e.countByRole.exporter, e.medianCoverByRole.exporter), rWidths[1]),
        rpad(cell(e.countByRole["self-supplier"], e.medianCoverByRole["self-supplier"]), rWidths[2]),
        rpad(cell(e.countByRole.consumer, e.medianCoverByRole.consumer), rWidths[3]),
        rpad(e.countByRole.consumer > 0 ? `${(e.consumerEmptyFrac * 100).toFixed(0)}%` : "-", rWidths[4]),
        rpad(String(e.countByRole.inert), rWidths[5]),
        rpad(e.countByRole.exporter > 0 ? e.exporterMedianPriceRatio.toFixed(2) : "-", rWidths[6]),
      ].join(" | "));
    }

    lines.push("  inert = no production and no real demand; the row exists only because MIN_DEMAND");
    lines.push("  floored its denominator. A pricing guard, not a deficit signal.");
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

    const pHeaders = ["Metric", "Value"];
    const pWidths = [24, 16];
    lines.push([pad(pHeaders[0], pWidths[0]), rpad(pHeaders[1], pWidths[1])].join(" | "));
    lines.push(pWidths.map((w) => "-".repeat(w)).join("-+-"));

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
    for (const [label, value] of pRows) {
      lines.push([pad(label, pWidths[0]), rpad(value, pWidths[1])].join(" | "));
    }
    lines.push('  meanUnrest is over all settled systems — see "Supply & unrest by world cohort" for the split.');

    const regimes = summarizeSupplyRegimes(finalTickSystems, finalWorld.markets, finalWorld.events);
    lines.push("");
    lines.push("Supply regimes (per settled system, end of simulation):");
    const rWidths = [24, 12, 12];
    lines.push([pad("Regime", rWidths[0]), rpad("Systems", rWidths[1]), rpad("Share", rWidths[2])].join(" | "));
    lines.push(rWidths.map((w) => "-".repeat(w)).join("-+-"));
    const rRows: [string, number, number][] = [
      ["Supplied", regimes.supplied, regimes.suppliedShare],
      ["Rationing", regimes.rationing, regimes.rationingShare],
      ["Shortage", regimes.shortage, regimes.shortageShare],
    ];
    for (const [l, n, sh] of rRows) {
      lines.push([pad(l, rWidths[0]), rpad(String(n), rWidths[1]), rpad(`${(sh * 100).toFixed(1)}%`, rWidths[2])].join(" | "));
    }
    lines.push(`  mean D ${regimes.meanDissatisfaction.toFixed(3)} over ${regimes.counted} settled systems`);
    lines.push('  mean D and mean unrest average incomparable worlds — see "Supply & unrest by world cohort".');
  }

  // Cohorts overlap by design: a system is in one population band, one of homeworld/colony,
  // and additionally survival-short if it cannot feed itself. Each row's n is its own denominator.
  if (worldCohorts.length > 0) {
    lines.push("");
    lines.push("Supply & unrest by world cohort (end of simulation):");

    const wHeaders = ["Cohort", "n", "mean D", "unrest", "strike%", "Sup/Rat/Sho %"];
    const wWidths = [16, 6, 8, 8, 9, 20];

    lines.push(wHeaders.map((h, i) => (i === 0 ? pad(h, wWidths[i]) : rpad(h, wWidths[i]))).join(" | "));
    lines.push(wWidths.map((w) => "-".repeat(w)).join("-+-"));

    for (const c of worldCohorts) {
      const split =
        `${(c.suppliedShare * 100).toFixed(0)} / ` +
        `${(c.rationingShare * 100).toFixed(0)} / ` +
        `${(c.shortageShare * 100).toFixed(0)}`;
      lines.push([
        pad(c.cohort, wWidths[0]),
        rpad(String(c.n), wWidths[1]),
        rpad(c.meanDissatisfaction.toFixed(3), wWidths[2]),
        rpad(c.meanUnrest.toFixed(3), wWidths[3]),
        rpad(`${(c.strikingShare * 100).toFixed(1)}%`, wWidths[4]),
        rpad(split, wWidths[5]),
      ].join(" | "));
    }

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
    const iWidths = [24, 16];
    lines.push([pad("Metric", iWidths[0]), rpad("Value", iWidths[1])].join(" | "));
    lines.push(iWidths.map((w) => "-".repeat(w)).join("-+-"));
    const iRows: [string, string][] = [
      ["Built start", fmtNum(infra.builtStart)],
      ["Built end", fmtNum(infra.builtEnd)],
      ["Decayed %", infra.decayedPct.toFixed(2) + "%"],
      ["Collapsed systems (≈0)", String(infra.collapsedCount)],
    ];
    for (const [l, v] of iRows) lines.push([pad(l, iWidths[0]), rpad(v, iWidths[1])].join(" | "));
  }

  // Colonisation / build-loop health — does a colonised system actually get built out?
  {
    const homeworldIds = new Set(finalWorld.factions.map((f) => f.homeworldId));
    const col = summarizeColonisation(finalTickSystems, homeworldIds, finalWorld.constructionProjects);
    lines.push("");
    lines.push("Colonisation & Build Loop (end of simulation):");
    const cWidths = [30, 12, 12];
    lines.push([pad("Metric", cWidths[0]), rpad("Homeworld", cWidths[1]), rpad("Colony", cWidths[2])].join(" | "));
    lines.push(cWidths.map((w) => "-".repeat(w)).join("-+-"));
    const cRows: [string, number, number][] = [
      ["Developed systems", col.homeworld.count, col.colony.count],
      ["  with tier-0 extraction", col.homeworld.withTier0, col.colony.withTier0],
      ["  with tier-1+ industry", col.homeworld.withTier1Plus, col.colony.withTier1Plus],
      ["  with housing", col.homeworld.withHousing, col.colony.withHousing],
      ["  populated, NO industry", col.homeworld.populatedButNoIndustry, col.colony.populatedButNoIndustry],
      ["  popCap-starved (pop, cap≈0)", col.homeworld.popCapStarved, col.colony.popCapStarved],
      ["  deposits idle (no tier-0)", col.homeworld.depositsIdle, col.colony.depositsIdle],
    ];
    for (const [label, hw, cl] of cRows) {
      lines.push([pad(label, cWidths[0]), rpad(String(hw), cWidths[1]), rpad(String(cl), cWidths[2])].join(" | "));
    }
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
    const lWidths = [24, 16];
    lines.push([pad("Metric", lWidths[0]), rpad("Value", lWidths[1])].join(" | "));
    lines.push(lWidths.map((w) => "-".repeat(w)).join("-+-"));
    const lRows: [string, string][] = [
      ["Transfers", fmtNum(lg.transferCount)],
      ["Ticks with transfers", String(lg.activeTicks)],
      ["Quantity moved", fmtNum(lg.totalQuantity)],
      ["Mean transfer size", lg.meanTransferSize.toFixed(1)],
      ["Systems participating", String(lg.participatingSystems)],
      ["Goods moved", String(lg.byGood.length)],
    ];
    for (const [l, v] of lRows) lines.push([pad(l, lWidths[0]), rpad(v, lWidths[1])].join(" | "));
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

    const eHeaders = ["Type", "System", "Ticks", "Sev", "Price Δ", "Top Movers"];
    const eWidths = [20, 16, 12, 5, 9, 30];

    lines.push(eHeaders.map((h, i) => pad(h, eWidths[i])).join(" | "));
    lines.push(eWidths.map((w) => "-".repeat(w)).join("-+-"));

    for (const e of topEvents) {
      const isChild = e.parentEventType !== null;
      const typeLabel = isChild ? `  └ ${e.eventType}` : e.eventType;
      const priceSign = e.weightedPriceImpactPct >= 0 ? "+" : "";

      const topMovers = [...e.goodPriceChanges]
        .sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct))
        .slice(0, 2)
        .map((g) => {
          const s = g.changePct >= 0 ? "+" : "";
          return `${g.goodId} ${s}${g.changePct.toFixed(0)}%`;
        })
        .join(", ");

      const truncName = e.systemName.length > eWidths[1]
        ? e.systemName.slice(0, eWidths[1] - 2) + ".."
        : e.systemName;

      const row = [
        pad(typeLabel, eWidths[0]),
        pad(truncName, eWidths[1]),
        pad(`${e.startTick}-${e.endTick}`, eWidths[2]),
        rpad(e.severity.toFixed(1), eWidths[3]),
        rpad(`${priceSign}${e.weightedPriceImpactPct.toFixed(1)}%`, eWidths[4]),
        pad(topMovers || "-", eWidths[5]),
      ];
      lines.push(row.join(" | "));
    }
  } else {
    lines.push("");
    lines.push("Event Impact: no events occurred during simulation");
  }

  return lines.join("\n");
}

// ── Experiment runner ───────────────────────────────────────────

async function runExperiment(configPath: string, jsonOutput: boolean): Promise<void> {
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

  console.log(
    `Running experiment${label ? ` "${label}"` : ""}: ` +
    `${config.tickCount} ticks, seed ${config.seed}, ${config.systemCount} systems, ` +
    `economy scale ${ECONOMY_SCALE}\n`,
  );

  const results = await runTickHarness(config, label);

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
`);
  process.exit(0);
}

// Config mode vs quick-run mode
async function main(): Promise<void> {
  if (args.config) {
    await runExperiment(args.config, args.json);
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

    const results = await runTickHarness(h.config);

    if (args.json) jsonOut[h.label] = toHorizonReport(results);
    else console.log(formatTable(results) + "\n");
  }

  if (args.json) console.log(JSON.stringify(jsonOut, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
