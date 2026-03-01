/**
 * Layer 0 — Distribution validation across multiple seeds.
 *
 * Generates universes with 20+ seeds and validates:
 *   1. Quality tier distribution matches 50/35/15 targets
 *   2. Economy type distribution — no type dominates or is absent
 *   3. Region economy spread — no monotonous regions
 *   4. Trait count per system distribution
 *   5. Trait category spread
 *
 * Usage:
 *   npx tsx --tsconfig tsconfig.json scripts/validate-distributions.ts
 *   npx tsx --tsconfig tsconfig.json scripts/validate-distributions.ts --seeds 50
 */

import {
  generateUniverse,
  type GeneratedUniverse,
  type GenParams,
} from "../lib/engine/universe-gen";
import {
  UNIVERSE_GEN,
  REGION_NAMES,
} from "../lib/constants/universe-gen";
import { QUALITY_TIERS, TRAITS } from "../lib/constants/traits";
import type { EconomyType, QualityTier } from "../lib/types/game";
import { ALL_QUALITY_TIERS } from "../lib/types/guards";

// ── Configuration ────────────────────────────────────────────────

const seedCountIdx = process.argv.indexOf("--seeds");
const SEED_COUNT = seedCountIdx >= 0 ? parseInt(process.argv[seedCountIdx + 1], 10) : 25;

const SEEDS = Array.from({ length: SEED_COUNT }, (_, i) => i + 1);

const DEFAULT_PARAMS: GenParams = {
  seed: 0, // overridden per run
  regionCount: UNIVERSE_GEN.REGION_COUNT,
  totalSystems: UNIVERSE_GEN.TOTAL_SYSTEMS,
  mapSize: UNIVERSE_GEN.MAP_SIZE,
  mapPadding: UNIVERSE_GEN.MAP_PADDING,
  poissonMinDistance: UNIVERSE_GEN.POISSON_MIN_DISTANCE,
  poissonKCandidates: UNIVERSE_GEN.POISSON_K_CANDIDATES,
  regionMinDistance: UNIVERSE_GEN.REGION_MIN_DISTANCE,
  extraEdgeFraction: UNIVERSE_GEN.INTRA_REGION_EXTRA_EDGES,
  gatewayFuelMultiplier: UNIVERSE_GEN.GATEWAY_FUEL_MULTIPLIER,
  gatewaysPerBorder: UNIVERSE_GEN.GATEWAYS_PER_BORDER,
  intraRegionBaseFuel: UNIVERSE_GEN.INTRA_REGION_BASE_FUEL,
  maxPlacementAttempts: UNIVERSE_GEN.MAX_PLACEMENT_ATTEMPTS,
};

// ── Accumulator types ────────────────────────────────────────────

interface SeedResult {
  seed: number;
  totalTraits: number;
  qualityCounts: Record<QualityTier, number>;
  economyCounts: Record<string, number>;
  categoryCounts: Record<string, number>;
  traitCountDistribution: Record<number, number>; // traits-per-system → count
  regionCoherence: { name: string; dominant: string; pct: number; monotonous: boolean }[];
  coherenceViolations: number;
  monotonousRegions: number;
}

// ── Generation ───────────────────────────────────────────────────

function analyzeSeed(seed: number): SeedResult {
  const params: GenParams = { ...DEFAULT_PARAMS, seed };
  const universe: GeneratedUniverse = generateUniverse(params, REGION_NAMES);

  const qualityCounts: Record<QualityTier, number> = { 1: 0, 2: 0, 3: 0 };
  const economyCounts: Record<string, number> = {};
  const categoryCounts: Record<string, number> = {};
  const traitCountDistribution: Record<number, number> = {};
  let totalTraits = 0;

  for (const system of universe.systems) {
    // Economy type
    economyCounts[system.economyType] = (economyCounts[system.economyType] ?? 0) + 1;

    // Trait count distribution
    const tc = system.traits.length;
    traitCountDistribution[tc] = (traitCountDistribution[tc] ?? 0) + 1;

    for (const trait of system.traits) {
      totalTraits++;
      qualityCounts[trait.quality]++;

      const def = TRAITS[trait.traitId];
      categoryCounts[def.category] = (categoryCounts[def.category] ?? 0) + 1;
    }
  }

  // Region coherence
  const regionCoherence: SeedResult["regionCoherence"] = [];
  let coherenceViolations = 0;
  let monotonousRegions = 0;

  for (const region of universe.regions) {
    const regionSystems = universe.systems.filter((s) => s.regionIndex === region.index);
    const econCounts: Record<string, number> = {};
    for (const sys of regionSystems) {
      econCounts[sys.economyType] = (econCounts[sys.economyType] ?? 0) + 1;
    }

    const entries = Object.entries(econCounts).sort(([, a], [, b]) => b - a);
    const dominant = entries[0]?.[0] ?? "none";
    const dominantCount = entries[0]?.[1] ?? 0;
    const pct = regionSystems.length > 0 ? dominantCount / regionSystems.length : 0;
    const monotonous = entries.length === 1 && regionSystems.length > 1;

    if (pct < 0.6) coherenceViolations++; // informational only — no enforcement target
    if (monotonous) monotonousRegions++;

    regionCoherence.push({
      name: region.name,
      dominant,
      pct,
      monotonous,
    });
  }

  return {
    seed,
    totalTraits,
    qualityCounts,
    economyCounts,
    categoryCounts,
    traitCountDistribution,
    regionCoherence,
    coherenceViolations,
    monotonousRegions,
  };
}

// ── Aggregation & reporting ──────────────────────────────────────

function run() {
  console.log(`\n=== Layer 0 Distribution Validation ===`);
  console.log(`Seeds: ${SEED_COUNT} (${SEEDS[0]}..${SEEDS[SEEDS.length - 1]})`);
  console.log(`Systems per seed: ${UNIVERSE_GEN.TOTAL_SYSTEMS}\n`);

  const results: SeedResult[] = [];
  const start = Date.now();

  for (const seed of SEEDS) {
    results.push(analyzeSeed(seed));
  }

  const elapsed = Date.now() - start;
  console.log(`Generation time: ${elapsed}ms (${(elapsed / SEED_COUNT).toFixed(1)}ms/seed)\n`);

  // ── Quality tier distribution ────────────────────────────────
  const totalTraitsAll = results.reduce((s, r) => s + r.totalTraits, 0);
  const aggQuality: Record<QualityTier, number> = { 1: 0, 2: 0, 3: 0 };
  for (const r of results) {
    for (const q of ALL_QUALITY_TIERS) {
      aggQuality[q] += r.qualityCounts[q];
    }
  }

  console.log("── Quality Tier Distribution ──");
  console.log(`Total traits across all seeds: ${totalTraitsAll}`);
  const targets = { 1: 50, 2: 35, 3: 15 };
  for (const q of ALL_QUALITY_TIERS) {
    const pct = ((aggQuality[q] / totalTraitsAll) * 100).toFixed(1);
    const target = targets[q];
    const label = QUALITY_TIERS[q].label;
    const diff = (parseFloat(pct) - target).toFixed(1);
    const status = Math.abs(parseFloat(diff)) <= 5 ? "OK" : "WARN";
    console.log(
      `  Q${q} (${label.padEnd(12)}): ${String(aggQuality[q]).padStart(5)} (${pct.padStart(5)}%)  target: ${target}%  diff: ${diff.padStart(5)}%  [${status}]`,
    );
  }
  console.log();

  // ── Economy type distribution ────────────────────────────────
  const allEconTypes: EconomyType[] = ["agricultural", "extraction", "refinery", "industrial", "tech", "core"];
  const totalSystems = results.reduce(
    (s, r) => s + Object.values(r.economyCounts).reduce((a, b) => a + b, 0),
    0,
  );
  const aggEcon: Record<string, number> = {};
  for (const r of results) {
    for (const [econ, count] of Object.entries(r.economyCounts)) {
      aggEcon[econ] = (aggEcon[econ] ?? 0) + count;
    }
  }

  console.log("── Economy Type Distribution ──");
  console.log(`Total systems across all seeds: ${totalSystems}`);
  const idealEconPct = (100 / allEconTypes.length).toFixed(1);
  for (const econ of allEconTypes) {
    const count = aggEcon[econ] ?? 0;
    const pct = ((count / totalSystems) * 100).toFixed(1);
    const status = count === 0 ? "FAIL" : parseFloat(pct) > 40 ? "WARN" : "OK";
    console.log(
      `  ${econ.padEnd(14)}: ${String(count).padStart(5)} (${pct.padStart(5)}%)  ideal: ~${idealEconPct}%  [${status}]`,
    );
  }
  console.log();

  // ── Region coherence ─────────────────────────────────────────
  const totalCoherenceViolations = results.reduce((s, r) => s + r.coherenceViolations, 0);
  const totalMonotonous = results.reduce((s, r) => s + r.monotonousRegions, 0);
  const totalRegions = results.length * UNIVERSE_GEN.REGION_COUNT;

  console.log("── Region Economy Spread ──");
  console.log(`Total regions checked: ${totalRegions}`);
  console.log(
    `Regions with >60% dominant:  ${totalRegions - totalCoherenceViolations} (${(((totalRegions - totalCoherenceViolations) / totalRegions) * 100).toFixed(1)}%)  [INFO]`,
  );
  console.log(
    `Monotonous regions (100%):   ${totalMonotonous} (${((totalMonotonous / totalRegions) * 100).toFixed(1)}%)  [${totalMonotonous === 0 ? "OK" : "WARN"}]`,
  );

  // Per-region dominant economy averages
  const regionCoherence: Record<string, number[]> = {};
  for (const r of results) {
    for (const rc of r.regionCoherence) {
      if (!regionCoherence[rc.name]) regionCoherence[rc.name] = [];
      regionCoherence[rc.name].push(rc.pct);
    }
  }
  console.log("\n  Per-region dominant economy %:");
  for (const [name, pcts] of Object.entries(regionCoherence).sort(([a], [b]) => a.localeCompare(b))) {
    const avg = (pcts.reduce((s, p) => s + p, 0) / pcts.length * 100).toFixed(1);
    const min = (Math.min(...pcts) * 100).toFixed(1);
    const max = (Math.max(...pcts) * 100).toFixed(1);
    console.log(`    ${name.padEnd(22)}: avg ${avg.padStart(5)}%  min ${min.padStart(5)}%  max ${max.padStart(5)}%`);
  }
  console.log();

  // ── Trait count per system ───────────────────────────────────
  const aggTraitCounts: Record<number, number> = {};
  for (const r of results) {
    for (const [count, freq] of Object.entries(r.traitCountDistribution)) {
      aggTraitCounts[Number(count)] = (aggTraitCounts[Number(count)] ?? 0) + freq;
    }
  }

  console.log("── Traits Per System ──");
  for (const count of Object.keys(aggTraitCounts).map(Number).sort()) {
    const freq = aggTraitCounts[count];
    const pct = ((freq / totalSystems) * 100).toFixed(1);
    const bar = "#".repeat(Math.round(parseFloat(pct)));
    console.log(`  ${count} traits: ${String(freq).padStart(5)} (${pct.padStart(5)}%) ${bar}`);
  }
  console.log();

  // ── Category distribution ────────────────────────────────────
  const aggCategories: Record<string, number> = {};
  for (const r of results) {
    for (const [cat, count] of Object.entries(r.categoryCounts)) {
      aggCategories[cat] = (aggCategories[cat] ?? 0) + count;
    }
  }

  console.log("── Trait Category Distribution ──");
  const catEntries = Object.entries(aggCategories).sort(([, a], [, b]) => b - a);
  for (const [cat, count] of catEntries) {
    const pct = ((count / totalTraitsAll) * 100).toFixed(1);
    console.log(`  ${cat.padEnd(12)}: ${String(count).padStart(5)} (${pct.padStart(5)}%)`);
  }
  console.log();

  // ── Summary verdict ──────────────────────────────────────────
  const issues: string[] = [];
  for (const q of ALL_QUALITY_TIERS) {
    const pct = (aggQuality[q] / totalTraitsAll) * 100;
    if (Math.abs(pct - targets[q]) > 5) {
      issues.push(`Quality ${q} off by ${(pct - targets[q]).toFixed(1)}%`);
    }
  }
  for (const econ of allEconTypes) {
    if (!aggEcon[econ]) issues.push(`Economy type "${econ}" absent`);
    const econPct = ((aggEcon[econ] ?? 0) / totalSystems) * 100;
    if (econPct > 30) issues.push(`Economy "${econ}" too dominant at ${econPct.toFixed(1)}%`);
    if (econPct < 10) issues.push(`Economy "${econ}" too rare at ${econPct.toFixed(1)}%`);
  }
  if (totalMonotonous > 0) issues.push(`${totalMonotonous} monotonous regions`);

  console.log("══════════════════════════════════");
  if (issues.length === 0) {
    console.log("PASS — All distributions within targets.");
  } else {
    console.log("ISSUES:");
    for (const issue of issues) {
      console.log(`  - ${issue}`);
    }
  }
  console.log("══════════════════════════════════\n");
}

run();
