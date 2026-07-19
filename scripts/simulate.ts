/**
 * CLI entry point for running economy simulations.
 *
 * Usage:
 *   npm run simulate                                            # Quick sanity check
 *   npm run simulate -- --config experiments/examples/baseline.yaml  # Real experiment
 *   npm run simulate -- --json                                  # Quick run, JSON output
 *
 * Options:
 *   --config PATH    Load experiment from YAML config file
 *   --json           Output raw JSON instead of formatted table
 *   --help           Show this help message
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
import { summarizePopulation, detectPingPong, summarizeInfrastructure } from "../lib/tick-harness/population-analysis";
import { summarizeColonisation, summarizeConstructionPool } from "../lib/tick-harness/build-analysis";
import { LOGISTICS_WARMUP_TICKS } from "../lib/tick-harness/logistics-analysis";
import { STRIKE_PARAMS } from "@/lib/constants/population";
import { DEFAULT_SYSTEM_COUNT } from "@/lib/constants/universe-gen";
import { ECONOMY_SCALE, toEconomyScale } from "@/lib/constants/economy-scale";
import { toTickSystems } from "../lib/world/tick";
import type { HarnessConfig, HarnessResults } from "../lib/tick-harness/types";

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
  const { marketHealth, eventImpacts, logisticsActivity, regionOverview, elapsedMs, finalWorld, initialPopulationTotal, initialBuildingTotal, populationSnapshots } = results;

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

  // Population and unrest summary
  {
    const pop = summarizePopulation(
      finalTickSystems,
      initialPopulationTotal,
      STRIKE_PARAMS.threshold,
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
      ["Saturated (≥98% cap)", String(pop.saturatedCount)],
      ["Emptied (≤1)", String(pop.emptiedCount)],
      ["Striking (≥threshold)", String(pop.strikingCount)],
      ["Ping-pong (migration)", String(pingPong)],
    ];
    for (const [label, value] of pRows) {
      lines.push([pad(label, pWidths[0]), rpad(value, pWidths[1])].join(" | "));
    }
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
    const cp = summarizeConstructionPool(finalTickSystems, finalWorld.constructionProjects);
    lines.push(
      `Construction pool: base ${fmtNum(cp.poolBase)} + centres ${fmtNum(cp.poolCentres)} ` +
        `(${(cp.centreShare * 100).toFixed(1)}% centre) | centres built ${cp.centreLevels}, in flight ${cp.centreProjects}`,
    );
    lines.push(
      `  queue: ${fmtNum(cp.queueRemainingWork)} work remaining` +
        (cp.queueEtaPulses !== null ? ` ≈ ${cp.queueEtaPulses.toFixed(1)} pulses at current pool` : " (pool is zero — stalled)"),
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
  --json           Output JSON instead of table
  --help           Show this help

Quick Run:
  Running with no flags generates the default-scale world (${DEFAULT_SYSTEM_COUNT}
  systems), runs 500 ticks with seed 42, and reports market/population/infrastructure
  health. For custom parameters, use --config with a YAML file — see
  experiments/examples/ for templates.

Examples:
  npm run simulate                                                 # Quick sanity check
  npm run simulate -- --config experiments/examples/baseline.yaml  # Experiment from YAML
  npm run simulate -- --json                                       # Quick run, JSON output
`);
  process.exit(0);
}

// Config mode vs quick-run mode
async function main(): Promise<void> {
  if (args.config) {
    await runExperiment(args.config, args.json);
    return;
  }

  const config: HarnessConfig = {
    systemCount: DEFAULT_SYSTEM_COUNT,
    seed: 42,
    tickCount: 500,
  };

  console.log(
    `Running quick-run: ${config.systemCount} systems, ${config.tickCount} ticks, ` +
    `seed ${config.seed}, economy scale ${ECONOMY_SCALE}\n`,
  );

  const results = await runTickHarness(config);

  if (args.json) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    console.log(formatTable(results));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
