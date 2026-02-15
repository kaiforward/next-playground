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

import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";
import { runSimulation } from "../lib/engine/simulator/runner";
import {
  ExperimentConfigSchema,
  experimentToSimConfig,
  buildExperimentResult,
} from "../lib/engine/simulator/experiment";
import { STRATEGY_NAMES } from "../lib/engine/simulator/strategies";
import type { SimConfig, BotConfig, PlayerSummary, SimResults } from "../lib/engine/simulator/types";

// ── Argument parsing ────────────────────────────────────────────

function parseArgs(argv: string[]): {
  json: boolean;
  help: boolean;
  config?: string;
} {
  const result = {
    json: false,
    help: false,
    config: undefined as string | undefined,
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

function formatTable(results: SimResults): string {
  const { summaries, marketHealth, eventImpacts, regionOverview, elapsedMs } = results;

  const lines: string[] = [];

  // Region Overview
  if (regionOverview.length > 0) {
    lines.push("Region Overview:");

    const roHeaders = ["Region", "Identity", "Government", "Systems"];
    const roWidths = [16, 16, 16, 8];

    lines.push(roHeaders.map((h, i) => pad(h, roWidths[i])).join(" | "));
    lines.push(roWidths.map((w) => "-".repeat(w)).join("-+-"));

    for (const r of regionOverview) {
      const row = [
        pad(r.name, roWidths[0]),
        pad(r.identity, roWidths[1]),
        pad(r.governmentType, roWidths[2]),
        rpad(String(r.systemCount), roWidths[3]),
      ];
      lines.push(row.join(" | "));
    }

    lines.push("");
  }

  // Summary table
  const headers = [
    "Strategy",
    "Final Credits",
    "Trades",
    "Cr/Tick",
    "Avg Profit",
    "Freighter @",
    "Fuel Spent",
    "Profit/Fuel",
    "Idle",
    "Idle %",
  ];
  const widths = [12, 14, 8, 10, 12, 12, 11, 12, 6, 7];

  // Header
  lines.push(headers.map((h, i) => pad(h, widths[i])).join(" | "));
  lines.push(widths.map((w) => "-".repeat(w)).join("-+-"));

  // Rows
  for (const s of summaries) {
    const row = [
      pad(s.strategy, widths[0]),
      rpad(s.finalCredits.toLocaleString(), widths[1]),
      rpad(s.totalTrades.toLocaleString(), widths[2]),
      rpad(s.creditsPerTick.toFixed(1), widths[3]),
      rpad(s.avgProfitPerTrade.toFixed(1), widths[4]),
      rpad(s.freighterTick !== null ? `tick ${s.freighterTick}` : "never", widths[5]),
      rpad(s.totalFuelSpent.toLocaleString(), widths[6]),
      rpad(s.profitPerFuel.toFixed(1), widths[7]),
      rpad(String(s.idleTicks), widths[8]),
      rpad((s.idleRate * 100).toFixed(1) + "%", widths[9]),
    ];
    lines.push(row.join(" | "));
  }

  lines.push("");
  lines.push(`Simulation completed in ${elapsedMs.toFixed(0)}ms`);

  // Goods breakdown per strategy
  for (const s of summaries) {
    if (s.goodBreakdown.length === 0) continue;

    const totalProfit = s.goodBreakdown.reduce((sum, g) => sum + Math.max(0, g.netProfit), 0);

    lines.push("");
    lines.push(`Goods Breakdown (${s.strategy}):`);

    const gHeaders = ["Good", "Bought", "Sold", "Spent", "Revenue", "Net Profit", "% of Profit"];
    const gWidths = [12, 8, 8, 12, 12, 12, 12];

    lines.push(gHeaders.map((h, i) => pad(h, gWidths[i])).join(" | "));
    lines.push(gWidths.map((w) => "-".repeat(w)).join("-+-"));

    for (const g of s.goodBreakdown) {
      const pctOfProfit = totalProfit > 0 ? (Math.max(0, g.netProfit) / totalProfit) * 100 : 0;
      const row = [
        pad(g.goodId, gWidths[0]),
        rpad(g.totalQuantityBought.toLocaleString(), gWidths[1]),
        rpad(g.totalQuantitySold.toLocaleString(), gWidths[2]),
        rpad(g.totalSpent.toLocaleString(), gWidths[3]),
        rpad(g.totalRevenue.toLocaleString(), gWidths[4]),
        rpad(g.netProfit.toLocaleString(), gWidths[5]),
        rpad(pctOfProfit.toFixed(1) + "%", gWidths[6]),
      ];
      lines.push(row.join(" | "));
    }
  }

  // Route diversity
  lines.push("");
  lines.push("Route Diversity:");

  const rHeaders = ["Strategy", "Unique", "Exploration", "Top 3 Systems (visits)"];
  const rWidths = [12, 8, 12, 50];

  lines.push(rHeaders.map((h, i) => pad(h, rWidths[i])).join(" | "));
  lines.push(rWidths.map((w) => "-".repeat(w)).join("-+-"));

  for (const s of summaries) {
    const topStr = s.topSystems.length > 0
      ? s.topSystems.slice(0, 3).map((t) => `${t.systemName} (${t.visits})`).join(", ")
      : "none";
    const row = [
      pad(s.strategy, rWidths[0]),
      rpad(String(s.uniqueSystemsVisited), rWidths[1]),
      rpad((s.explorationRate * 100).toFixed(1) + "%", rWidths[2]),
      pad(topStr, rWidths[3]),
    ];
    lines.push(row.join(" | "));
  }

  // Market health summary
  if (marketHealth) {
    lines.push("");
    lines.push("Market Health (end of simulation):");

    const dHeaders = ["Good", "Price StdDev", "Supply Drift", "Demand Drift"];
    const dWidths = [12, 13, 13, 13];

    lines.push(dHeaders.map((h, i) => pad(h, dWidths[i])).join(" | "));
    lines.push(dWidths.map((w) => "-".repeat(w)).join("-+-"));

    // Merge dispersion and drift by goodId
    const dispMap = new Map(marketHealth.priceDispersion.map((d) => [d.goodId, d]));
    const driftMap = new Map(marketHealth.equilibriumDrift.map((d) => [d.goodId, d]));
    const allGoods = [...new Set([
      ...marketHealth.priceDispersion.map((d) => d.goodId),
      ...marketHealth.equilibriumDrift.map((d) => d.goodId),
    ])];

    // Sort by price dispersion descending
    allGoods.sort((a, b) => (dispMap.get(b)?.avgStdDev ?? 0) - (dispMap.get(a)?.avgStdDev ?? 0));

    for (const goodId of allGoods) {
      const disp = dispMap.get(goodId);
      const drift = driftMap.get(goodId);
      const row = [
        pad(goodId, dWidths[0]),
        rpad(disp ? disp.avgStdDev.toFixed(1) : "-", dWidths[1]),
        rpad(drift ? (drift.avgSupplyDrift >= 0 ? "+" : "") + drift.avgSupplyDrift.toFixed(1) : "-", dWidths[2]),
        rpad(drift ? (drift.avgDemandDrift >= 0 ? "+" : "") + drift.avgDemandDrift.toFixed(1) : "-", dWidths[3]),
      ];
      lines.push(row.join(" | "));
    }
  }

  // Event impact
  if (eventImpacts.length > 0) {
    lines.push("");
    lines.push("Event Impact:");

    const eHeaders = ["Type", "System", "Ticks", "Sev", "Price Δ", "Top Movers", "Trades", "Profit"];
    const eWidths = [20, 16, 12, 5, 9, 30, 7, 10];

    lines.push(eHeaders.map((h, i) => pad(h, eWidths[i])).join(" | "));
    lines.push(eWidths.map((w) => "-".repeat(w)).join("-+-"));

    for (const e of eventImpacts) {
      const isChild = e.parentEventType !== null;
      const typeLabel = isChild ? `  └ ${e.eventType}` : e.eventType;
      const priceSign = e.weightedPriceImpactPct >= 0 ? "+" : "";

      // Top 2 movers by absolute change
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
        rpad(e.tradeCountDuring.toLocaleString(), eWidths[6]),
        rpad(e.tradeProfitDuring.toLocaleString(), eWidths[7]),
      ];
      lines.push(row.join(" | "));
    }
  } else {
    lines.push("");
    lines.push("Event Impact: no events occurred during simulation");
  }

  // Government trade — sells by destination government type
  const allGovTypes = [
    ...new Set(summaries.flatMap((s) => s.governmentSellBreakdown.map((g) => g.governmentType))),
  ].sort();

  if (allGovTypes.length > 0) {
    lines.push("");
    lines.push("Government Trade (sells by destination):");

    const gtWidths = [12, ...allGovTypes.map(() => 18)];
    const gtHeaders = ["Strategy", ...allGovTypes];

    lines.push(gtHeaders.map((h, i) => pad(h, gtWidths[i])).join(" | "));
    lines.push(gtWidths.map((w) => "-".repeat(w)).join("-+-"));

    for (const s of summaries) {
      const totalSold = s.governmentSellBreakdown.reduce((sum, g) => sum + g.totalSold, 0);
      const govMap = new Map(s.governmentSellBreakdown.map((g) => [g.governmentType, g]));
      const cells = allGovTypes.map((gov) => {
        const entry = govMap.get(gov);
        if (!entry || totalSold === 0) return rpad("-", 18);
        const pct = ((entry.totalSold / totalSold) * 100).toFixed(1);
        return rpad(`${entry.totalSold} (${pct}%)`, 18);
      });
      lines.push([pad(s.strategy, 12), ...cells].join(" | "));
    }
  }

  return lines.join("\n");
}

// ── Experiment runner ───────────────────────────────────────────

function runExperiment(configPath: string, jsonOutput: boolean): void {
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

  const { config, overrides, label } = experimentToSimConfig(validated.data);

  console.log(
    `Running experiment${label ? ` "${label}"` : ""}: ` +
    `${config.tickCount} ticks, seed ${config.seed}, ` +
    `${config.bots.length} bot group(s)` +
    (config.disableRandomEvents ? ", random events disabled" : "") +
    (config.eventInjections?.length ? `, ${config.eventInjections.length} injection(s)` : "") +
    "\n",
  );

  const results = runSimulation(config, overrides, label);

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
  Running with no flags runs all strategies (${STRATEGY_NAMES.join(", ")}),
  1 bot each, 500 ticks, seed 42. For custom parameters, use --config with a
  YAML file — see experiments/examples/ for templates.

Examples:
  npm run simulate                                                 # Quick sanity check
  npm run simulate -- --config experiments/examples/baseline.yaml  # Experiment from YAML
  npm run simulate -- --json                                       # Quick run, JSON output
`);
  process.exit(0);
}

// Config mode vs quick-run mode
if (args.config) {
  runExperiment(args.config, args.json);
} else {
  // Hardcoded quick-run: all strategies, 1 bot each, 500 ticks, seed 42
  const botConfigs: BotConfig[] = STRATEGY_NAMES.map((strategy) => ({
    strategy,
    count: 1,
  }));

  const config: SimConfig = {
    tickCount: 500,
    bots: botConfigs,
    seed: 42,
  };

  console.log(
    `Running quick-run: 500 ticks, seed 42, strategies: ${STRATEGY_NAMES.join(", ")}, 1 bot each\n`,
  );

  const results = runSimulation(config);

  if (args.json) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    console.log(formatTable(results));
  }
}
