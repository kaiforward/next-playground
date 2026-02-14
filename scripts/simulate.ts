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
import type { SimConfig, BotConfig, PlayerSummary } from "../lib/engine/simulator/types";

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

function formatTable(summaries: PlayerSummary[], elapsedMs: number): string {
  const headers = [
    "Strategy",
    "Final Credits",
    "Trades",
    "Cr/Tick",
    "Avg Profit",
    "Freighter @",
    "Fuel Spent",
    "Profit/Fuel",
  ];
  const widths = [12, 14, 8, 10, 12, 12, 11, 12];

  const lines: string[] = [];

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
    ];
    lines.push(row.join(" | "));
  }

  lines.push("");
  lines.push(`Simulation completed in ${elapsedMs.toFixed(0)}ms`);

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
    console.log(formatTable(results.summaries, results.elapsedMs));
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
    console.log(formatTable(results.summaries, results.elapsedMs));
  }
}
