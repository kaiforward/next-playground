/**
 * Tracked generation census for the two-budget substrate.
 * Run: npm run report:coherence
 *
 * Reads the gen-time calibration targets (docs/build-plans/habitability-seeding.md,
 * "Calibration targets" 1-3 and 6) over a fixed multi-seed cohort, capitals separated from
 * natural-gen systems throughout. Reports bands; does not fail on a band miss — the constant
 * retune loop runs against this script's own numbers.
 *
 * INVARIANTS are the only fatal thing here (non-zero exit): they replace the retired
 * partition-exhaustiveness identity (`partitionBody`/`SPACE_PER_SIZE`, since deleted) with the
 * two-budget model's own guarantees — dead classes contribute zero people land, deposit
 * counts are integer and in-table-range, system aggregates equal the sum of their contributing
 * unlocked bodies, and no below-floor system reads as colony-sizeable.
 */
import { generateUniverse, type GeneratedSystem } from "@/lib/engine/universe-gen";
import type { GeneratedBody } from "@/lib/engine/body-gen";
import { genConfigForSystemCount, DEFAULT_SYSTEM_COUNT, REGION_NAMES } from "@/lib/constants/universe-gen";
import { buildGenParams } from "@/lib/world/gen";
import { RESOURCE_TYPES } from "@/lib/engine/resources";
import { BODY_ARCHETYPES, HABITABILITY_THRESHOLD } from "@/lib/constants/bodies";
import { effectiveSpaceCost, HOUSING_TYPE, POP_CENTRE_DENSITY } from "@/lib/constants/industry";
import { sizeColonyEstablish } from "@/lib/engine/directed-build";
import { EXPANSION } from "@/lib/constants/expansion";
import { COLONISATION } from "@/lib/constants/colonisation";
import { dangerBand } from "@/lib/utils/system";
import type { SunClass } from "@/lib/types/game";

// ── Fixed cohort — per-seed spread is a floor of the instrument, not a config knob ──

const SEEDS: readonly number[] = [42, 1337, 7, 2026, 99, 555] as const;
if (SEEDS.length < 5) {
  throw new Error(`substrate-coherence requires >=5 seeds for per-seed spread; got ${SEEDS.length}`);
}
const SYSTEM_COUNT = DEFAULT_SYSTEM_COUNT;
const SUN_CLASS_IDS: readonly SunClass[] = ["yellow", "orange_dwarf", "blue_white", "red_dwarf"] as const;
const FLOOR = effectiveSpaceCost(HOUSING_TYPE);
const SIZING_PARAMS = { seedPop: EXPANSION.COLONY_SEED_POP, establishWork: COLONISATION.COLONY_ESTABLISH_WORK };

// ── Small stats helpers ──────────────────────────────────────────

interface Stats { n: number; min: number; median: number; mean: number; max: number }

function stats(xs: number[]): Stats {
  if (xs.length === 0) return { n: 0, min: 0, median: 0, mean: 0, max: 0 };
  const s = [...xs].sort((a, b) => a - b);
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const median = s.length % 2 === 0
    ? (s[s.length / 2 - 1] + s[s.length / 2]) / 2
    : s[Math.floor(s.length / 2)];
  return { n: s.length, min: s[0], median, mean, max: s[s.length - 1] };
}
function fmtStats(s: Stats, decimals = 0): string {
  return `n=${s.n} mean=${s.mean.toFixed(decimals)} median=${s.median.toFixed(decimals)} min=${s.min.toFixed(decimals)} max=${s.max.toFixed(decimals)}`;
}
function pct(n: number, d: number): string {
  return d > 0 ? `${((100 * n) / d).toFixed(1)}%` : "n/a";
}
function spreadLine(label: string, xs: number[], fmt: (n: number) => string = (n) => n.toFixed(1)): string {
  const s = stats(xs);
  return `  ${label.padEnd(28)} per-seed: [${xs.map(fmt).join(", ")}]  min=${fmt(s.min)} median=${fmt(s.median)} max=${fmt(s.max)}`;
}

// ── Archetype classification (independent of body-gen.ts — the whole point of a census) ──

function isAboveThreshold(body: GeneratedBody): boolean {
  return BODY_ARCHETYPES[body.bodyType].scores.default >= HABITABILITY_THRESHOLD;
}
function isUnlocked(body: GeneratedBody): boolean {
  return !BODY_ARCHETYPES[body.bodyType].techLocked;
}
function isHabitable(body: GeneratedBody): boolean {
  return isAboveThreshold(body) && isUnlocked(body);
}
function habitableCount(sys: GeneratedSystem): number {
  return sys.bodies.filter(isHabitable).length;
}
function fullBuildOutPopCap(peopleLand: number): number {
  // Continuous estimate: the real sizing path (sizeColonyEstablish) floors to whole housing
  // levels, so this slightly overstates reachable popCap — fine for band-level anchor stats,
  // not for fine-precision reads.
  return (peopleLand / FLOOR) * POP_CENTRE_DENSITY;
}

// ── Invariants ────────────────────────────────────────────────────
// Every check below re-implements the two-budget spec from scratch (BODY_ARCHETYPES + the
// generated body/system fields) rather than importing body-gen.ts's own aggregation code, so a
// regression in that code is what this census is positioned to catch.

/** Static table sanity: every authored deposit-count range is a non-negative integer band. */
function validateArchetypeTable(): string[] {
  const errors: string[] = [];
  for (const arch of Object.values(BODY_ARCHETYPES)) {
    for (const r of RESOURCE_TYPES) {
      const range = arch.depositCounts[r];
      if (range === undefined) continue;
      if (!Number.isInteger(range.min) || !Number.isInteger(range.max)) {
        errors.push(`table: ${arch.id}.depositCounts.${r} is not integer-bounded: [${range.min}, ${range.max}]`);
      }
      if (range.min > range.max) {
        errors.push(`table: ${arch.id}.depositCounts.${r} has min > max: [${range.min}, ${range.max}]`);
      }
      if (range.min < 0) {
        errors.push(`table: ${arch.id}.depositCounts.${r} has a negative minimum: ${range.min}`);
      }
    }
  }
  return errors;
}

/**
 * Every PROCEDURALLY-ROLLED body's deposit counts are integer and fall inside its archetype's
 * authored range. A faction capital's prepended garden body (`homeworldGardenBody`, always
 * index 0 of a capital's body list) is authored directly against the home prefab's exact
 * footprint, deliberately outside the table bands — excluded here, not exempted from the
 * aggregate-consistency or below-floor checks, which read what the body actually authors either way.
 */
function validateGeneratedCounts(natural: GeneratedSystem[], capitals: GeneratedSystem[]): string[] {
  const errors: string[] = [];
  const rolled: { sysName: string; body: GeneratedBody }[] = [
    ...natural.flatMap((sys) => sys.bodies.map((body) => ({ sysName: sys.name, body }))),
    ...capitals.flatMap((sys) => sys.bodies.slice(1).map((body) => ({ sysName: sys.name, body }))),
  ];
  for (const { sysName, body: b } of rolled) {
    const arch = BODY_ARCHETYPES[b.bodyType];
    for (const r of RESOURCE_TYPES) {
      const range = arch.depositCounts[r];
      const c = b.counts[r];
      if (range === undefined) {
        if (c !== 0) errors.push(`${sysName}/${b.bodyType}: rolled nonzero ${r} count (${c}) with no authored range`);
        continue;
      }
      if (!Number.isInteger(c)) errors.push(`${sysName}/${b.bodyType}: rolled non-integer ${r} count: ${c}`);
      else if (c < range.min || c > range.max) {
        errors.push(`${sysName}/${b.bodyType}: rolled ${r} count ${c} outside authored range [${range.min}, ${range.max}]`);
      }
    }
  }
  return errors;
}

/**
 * System aggregates equal the sum over their contributing (unlocked / above-threshold-unlocked)
 * bodies — the dead-class-zero guarantee falls out of this directly: a below-threshold or
 * tech-locked body's peopleLand is excluded from the expected sum, so if the real aggregate ever
 * included it, this diverges.
 */
function validateAggregateConsistency(systems: GeneratedSystem[]): string[] {
  const errors: string[] = [];
  const EPS = 1e-6;
  for (const sys of systems) {
    const unlocked = sys.bodies.filter(isUnlocked);
    const habitable = unlocked.filter(isAboveThreshold);
    const expectedPeopleLand = habitable.reduce((sum, b) => sum + b.peopleLand, 0);
    if (Math.abs(expectedPeopleLand - sys.peopleLand) > EPS) {
      errors.push(`${sys.name}: peopleLand aggregate ${sys.peopleLand.toFixed(3)} != Σ above-threshold unlocked bodies ${expectedPeopleLand.toFixed(3)}`);
    }
    for (const r of RESOURCE_TYPES) {
      const expectedCount = unlocked.reduce((sum, b) => sum + b.counts[r], 0);
      if (Math.abs(expectedCount - sys.depositCounts[r]) > EPS) {
        errors.push(`${sys.name}: depositCounts.${r} aggregate ${sys.depositCounts[r]} != Σ unlocked bodies ${expectedCount}`);
      }
    }
  }
  return errors;
}

/** No system below the colonisability floor reads as colony-sizeable by the real sizing function. */
function validateBelowFloorEligibility(systems: GeneratedSystem[]): string[] {
  const errors: string[] = [];
  for (const sys of systems) {
    if (sys.peopleLand >= FLOOR) continue;
    const sizing = sizeColonyEstablish(sys.peopleLand, SIZING_PARAMS);
    if (sizing !== null) {
      errors.push(`${sys.name}: peopleLand ${sys.peopleLand.toFixed(2)} < floor ${FLOOR} but sizeColonyEstablish returned ${JSON.stringify(sizing)}`);
    }
  }
  return errors;
}

// ── Per-seed run ──────────────────────────────────────────────────

interface SeedReport {
  seed: number;
  natural: GeneratedSystem[];
  capitals: GeneratedSystem[];
  errors: string[];
}

function runSeed(seed: number): SeedReport {
  const config = genConfigForSystemCount(SYSTEM_COUNT);
  const params = buildGenParams(seed, config);
  const u = generateUniverse(params, REGION_NAMES);
  const capitalIndices = new Set(u.factions.map((f) => f.homeworldSystemIndex));
  const natural = u.systems.filter((s) => !capitalIndices.has(s.index));
  const capitals = u.systems.filter((s) => capitalIndices.has(s.index));

  const errors = [
    ...validateGeneratedCounts(natural, capitals),
    ...validateAggregateConsistency(u.systems),
    ...validateBelowFloorEligibility(natural),
  ];
  return { seed, natural, capitals, errors };
}

// ── Report ────────────────────────────────────────────────────────

const tableErrors = validateArchetypeTable();
const reports = SEEDS.map(runSeed);

console.log(`Seeds: ${SEEDS.join(", ")} (${SEEDS.length}) × ${SYSTEM_COUNT} systems — capitals separated from natural-gen cohorts`);
for (const r of reports) {
  console.log(`  seed ${r.seed}: ${r.natural.length} natural, ${r.capitals.length} capitals`);
}

// ── Target 1: habitable-count distribution ─────────────────────────
console.log("\n=== Target 1: habitable-count distribution (natural-gen) ===");
console.log("Bands: >=1 in 30-40%, >=2 in 5-10%, =3 <=1.5%, >=4 zero.");

const ge1PerSeed: number[] = [];
const ge2PerSeed: number[] = [];
const eq3PerSeed: number[] = [];
const ge4PerSeed: number[] = [];
for (const r of reports) {
  const counts = r.natural.map(habitableCount);
  const n = counts.length;
  const ge1 = counts.filter((c) => c >= 1).length;
  const ge2 = counts.filter((c) => c >= 2).length;
  const eq3 = counts.filter((c) => c === 3).length;
  const ge4 = counts.filter((c) => c >= 4).length;
  ge1PerSeed.push((100 * ge1) / n);
  ge2PerSeed.push((100 * ge2) / n);
  eq3PerSeed.push((100 * eq3) / n);
  ge4PerSeed.push((100 * ge4) / n);
  console.log(`  seed ${r.seed}: >=1 ${pct(ge1, n)}  >=2 ${pct(ge2, n)}  =3 ${pct(eq3, n)}  >=4 ${pct(ge4, n)}`);
}
console.log(spreadLine(">=1 habitable %", ge1PerSeed, (n) => n.toFixed(1)));
console.log(spreadLine(">=2 habitable %", ge2PerSeed, (n) => n.toFixed(1)));
console.log(spreadLine("=3 habitable %", eq3PerSeed, (n) => n.toFixed(1)));
console.log(spreadLine(">=4 habitable %", ge4PerSeed, (n) => n.toFixed(1)));

console.log("\nPer sun class (>= 1 habitable %; yellow/orange target ~15-60%, blue-white/red-dwarf 0 by design):");
for (const sc of SUN_CLASS_IDS) {
  const perSeed: number[] = [];
  for (const r of reports) {
    const sysOfClass = r.natural.filter((s) => s.sunClass === sc);
    const ge1 = sysOfClass.filter((s) => habitableCount(s) >= 1).length;
    perSeed.push(sysOfClass.length > 0 ? (100 * ge1) / sysOfClass.length : 0);
  }
  console.log(spreadLine(sc, perSeed, (n) => n.toFixed(1)));
}

// ── Target 2: people-land anchor stats ──────────────────────────────
console.log("\n=== Target 2: people-land anchor (full-build-out pops; anchor ~10,000 mean, ~20,000 max) ===");

const bodyPopCapAll: number[] = [];
const systemPopCapAll: number[] = [];
const aridDark: number[] = [];
const tundraDark: number[] = [];
for (const r of reports) {
  for (const s of r.natural) {
    for (const b of s.bodies) {
      if (isHabitable(b)) bodyPopCapAll.push(fullBuildOutPopCap(b.peopleLand));
      if (b.bodyType === "arid_world") aridDark.push(b.peopleLand);
      if (b.bodyType === "tundra_world") tundraDark.push(b.peopleLand);
    }
    systemPopCapAll.push(fullBuildOutPopCap(s.peopleLand));
  }
}
console.log(`  per-body anchor cohort (score>=threshold, unlocked): ${fmtStats(stats(bodyPopCapAll))}`);
console.log(`  SYSTEM-level (bounds popRef):                        ${fmtStats(stats(systemPopCapAll))}`);
console.log(`  arid_world dark land (peopleLand, not in aggregate):  ${fmtStats(stats(aridDark))}`);
console.log(`  tundra_world dark land (peopleLand, not in aggregate):${fmtStats(stats(tundraDark))}`);

// ── Target 3: colonisable share ─────────────────────────────────────
console.log(`\n=== Target 3: colonisable share (peopleLand >= floor ${FLOOR}; band 30-40%) ===`);
const colonisablePerSeed: number[] = [];
for (const r of reports) {
  const n = r.natural.length;
  const eligible = r.natural.filter((s) => s.peopleLand >= FLOOR).length;
  colonisablePerSeed.push((100 * eligible) / n);
  console.log(`  seed ${r.seed}: ${pct(eligible, n)} (${eligible}/${n})`);
}
console.log(spreadLine("colonisable %", colonisablePerSeed, (n) => n.toFixed(1)));

// ── Target 6: economy-type histogram ────────────────────────────────
console.log("\n=== Target 6: economy-type histogram (natural vs capitals) ===");
for (const r of reports) {
  const natEcon = new Map<string, number>();
  for (const s of r.natural) natEcon.set(s.economyType, (natEcon.get(s.economyType) ?? 0) + 1);
  const capEcon = new Map<string, number>();
  for (const s of r.capitals) capEcon.set(s.economyType, (capEcon.get(s.economyType) ?? 0) + 1);
  console.log(`  seed ${r.seed} natural:  ${[...natEcon].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${pct(v, r.natural.length)}`).join(", ")}`);
  console.log(`  seed ${r.seed} capitals: ${[...capEcon].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}/${r.capitals.length}`).join(", ")}`);
}

// ── bodyDanger per-system distribution ──────────────────────────────
console.log("\n=== bodyDanger per-system distribution (natural-gen) ===");
const dangerAll: number[] = [];
const dangerBandCounts = new Map<string, number>();
for (const r of reports) {
  for (const s of r.natural) {
    dangerAll.push(s.bodyDanger);
    const band = dangerBand(s.bodyDanger).label;
    dangerBandCounts.set(band, (dangerBandCounts.get(band) ?? 0) + 1);
  }
}
console.log(`  ${fmtStats(stats(dangerAll), 3)}`);
const totalDangerSamples = dangerAll.length;
for (const [band, c] of [...dangerBandCounts].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${band.padEnd(10)} ${c} (${pct(c, totalDangerSamples)})`);
}

// ── Invariants ────────────────────────────────────────────────────
console.log("\n=== Invariants ===");
const allErrors = [...tableErrors, ...reports.flatMap((r) => r.errors.map((e) => `seed ${r.seed}: ${e}`))];
if (allErrors.length === 0) {
  console.log("  PASS — dead classes contribute 0 people land; counts integer and in-range; " +
    "aggregates = Σ contributing unlocked bodies; zero below-floor eligibility violations.");
  process.exitCode = 0;
} else {
  console.log(`  BREACH — ${allErrors.length} invariant violation(s):`);
  for (const e of allErrors.slice(0, 50)) console.log(`    - ${e}`);
  if (allErrors.length > 50) console.log(`    ... and ${allErrors.length - 50} more`);
  process.exitCode = 1;
}
