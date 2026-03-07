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
import type { SimConfig, BotConfig, SimResults } from "../lib/engine/simulator/types";

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

function formatTable(results: SimResults): string {
  const { strategyAggregates, marketHealth, eventImpacts, regionOverview, elapsedMs } = results;

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
        pad(r.governmentType, roWidths[1]),
        rpad(String(r.systemCount), roWidths[2]),
      ];
      lines.push(row.join(" | "));
    }

    lines.push("");
  }

  // Strategy aggregate summary
  const headers = [
    "Strategy",
    "Bots",
    "Avg Credits",
    "Min / Max",
    "Avg Trades",
    "Cr/Tick",
    "Profit/Trade",
    "Idle %",
    "Explore %",
  ];
  const widths = [12, 5, 14, 22, 10, 10, 12, 7, 10];

  lines.push(headers.map((h, i) => pad(h, widths[i])).join(" | "));
  lines.push(widths.map((w) => "-".repeat(w)).join("-+-"));

  for (const a of strategyAggregates) {
    const row = [
      pad(a.strategy, widths[0]),
      rpad(String(a.botCount), widths[1]),
      rpad(fmtNum(a.avgCredits), widths[2]),
      rpad(`${fmtNum(a.minCredits)} / ${fmtNum(a.maxCredits)}`, widths[3]),
      rpad(a.avgTrades.toFixed(0), widths[4]),
      rpad(a.avgCreditsPerTick.toFixed(1), widths[5]),
      rpad(a.avgProfitPerTrade.toFixed(1), widths[6]),
      rpad((a.avgIdleRate * 100).toFixed(1) + "%", widths[7]),
      rpad((a.avgExplorationRate * 100).toFixed(1) + "%", widths[8]),
    ];
    lines.push(row.join(" | "));
  }

  lines.push("");
  lines.push(`Simulation completed in ${elapsedMs.toFixed(0)}ms`);

  // Goods breakdown per strategy (aggregated across all bots)
  for (const a of strategyAggregates) {
    if (a.goodBreakdown.length === 0) continue;

    const totalProfit = a.goodBreakdown.reduce((sum, g) => sum + Math.max(0, g.netProfit), 0);

    lines.push("");
    lines.push(`Goods Breakdown (${a.strategy}, ${a.botCount} bots aggregated):`);

    const gHeaders = ["Good", "Bought", "Sold", "Spent", "Revenue", "Net Profit", "% of Profit"];
    const gWidths = [12, 10, 10, 14, 14, 14, 12];

    lines.push(gHeaders.map((h, i) => pad(h, gWidths[i])).join(" | "));
    lines.push(gWidths.map((w) => "-".repeat(w)).join("-+-"));

    for (const g of a.goodBreakdown) {
      const pctOfProfit = totalProfit > 0 ? (Math.max(0, g.netProfit) / totalProfit) * 100 : 0;
      const row = [
        pad(g.goodId, gWidths[0]),
        rpad(fmtNum(g.totalQuantityBought), gWidths[1]),
        rpad(fmtNum(g.totalQuantitySold), gWidths[2]),
        rpad(fmtNum(g.totalSpent), gWidths[3]),
        rpad(fmtNum(g.totalRevenue), gWidths[4]),
        rpad(fmtNum(g.netProfit), gWidths[5]),
        rpad(pctOfProfit.toFixed(1) + "%", gWidths[6]),
      ];
      lines.push(row.join(" | "));
    }
  }

  // Market health summary
  if (marketHealth) {
    lines.push("");
    lines.push("Market Health (end of simulation):");

    const dHeaders = ["Good", "Price StdDev", "Supply Drift", "Demand Drift"];
    const dWidths = [12, 13, 13, 13];

    lines.push(dHeaders.map((h, i) => pad(h, dWidths[i])).join(" | "));
    lines.push(dWidths.map((w) => "-".repeat(w)).join("-+-"));

    const dispMap = new Map(marketHealth.priceDispersion.map((d) => [d.goodId, d]));
    const driftMap = new Map(marketHealth.equilibriumDrift.map((d) => [d.goodId, d]));
    const allGoods = [...new Set([
      ...marketHealth.priceDispersion.map((d) => d.goodId),
      ...marketHealth.equilibriumDrift.map((d) => d.goodId),
    ])];

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

  // Event impact (top 20 only — full list in JSON output)
  if (eventImpacts.length > 0) {
    const topEvents = eventImpacts.slice(0, 20);
    lines.push("");
    lines.push(`Event Impact (top ${topEvents.length} of ${eventImpacts.length}):`);

    const eHeaders = ["Type", "System", "Ticks", "Sev", "Price Δ", "Top Movers", "Trades", "Profit"];
    const eWidths = [20, 16, 12, 5, 9, 30, 7, 10];

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
        rpad(e.tradeCountDuring.toLocaleString(), eWidths[6]),
        rpad(e.tradeProfitDuring.toLocaleString(), eWidths[7]),
      ];
      lines.push(row.join(" | "));
    }
  } else {
    lines.push("");
    lines.push("Event Impact: no events occurred during simulation");
  }

  // Government trade — sells by destination government type (aggregated)
  const allGovTypes = [
    ...new Set(strategyAggregates.flatMap((a) => a.governmentSellBreakdown.map((g) => g.governmentType))),
  ].sort();

  if (allGovTypes.length > 0) {
    lines.push("");
    lines.push("Government Trade (sells by destination, all bots per strategy):");

    const gtWidths = [12, ...allGovTypes.map(() => 18)];
    const gtHeaders = ["Strategy", ...allGovTypes];

    lines.push(gtHeaders.map((h, i) => pad(h, gtWidths[i])).join(" | "));
    lines.push(gtWidths.map((w) => "-".repeat(w)).join("-+-"));

    for (const a of strategyAggregates) {
      const totalSold = a.governmentSellBreakdown.reduce((sum, g) => sum + g.totalSold, 0);
      const govMap = new Map(a.governmentSellBreakdown.map((g) => [g.governmentType, g]));
      const cells = allGovTypes.map((gov) => {
        const entry = govMap.get(gov);
        if (!entry || totalSold === 0) return rpad("-", 18);
        const pct = ((entry.totalSold / totalSold) * 100).toFixed(1);
        return rpad(`${fmtNum(entry.totalSold)} (${pct}%)`, 18);
      });
      lines.push([pad(a.strategy, 12), ...cells].join(" | "));
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
