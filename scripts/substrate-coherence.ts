/**
 * One-off verification: report the generated galaxy's economy-type
 * distribution, galaxy-wide deposit slot-cap totals, and the weakest region's
 * arable (food) slot share. Run: npx tsx --tsconfig tsconfig.json scripts/substrate-coherence.ts
 */
import { generateUniverse } from "@/lib/engine/universe-gen";
import { genConfigForSystemCount, DEFAULT_SYSTEM_COUNT, REGION_NAMES } from "@/lib/constants/universe-gen";
import { buildGenParams } from "@/lib/world/gen";
import { RESOURCE_TYPES, sumResourceVectors } from "@/lib/engine/resources";
import { bandForMultiplier } from "@/lib/engine/substrate-space";
import { QUALITY_BANDS } from "@/lib/constants/substrate-gen";
import type { SunClass, QualityBandId } from "@/lib/types/game";

const SUN_CLASSES: readonly SunClass[] = ["blue_white", "yellow", "orange_dwarf", "red_dwarf"] as const;
const BAND_IDS: readonly QualityBandId[] = ["poor", "average", "good", "rich"] as const;

const config = genConfigForSystemCount(DEFAULT_SYSTEM_COUNT);
const params = buildGenParams(config.SEED, config);

const u = generateUniverse(params, REGION_NAMES);

// ── Original reports ─────────────────────────────────────────────

const econ = new Map<string, number>();
for (const s of u.systems) econ.set(s.economyType, (econ.get(s.economyType) ?? 0) + 1);
console.log("Economy-type distribution:");
for (const [k, v] of [...econ].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(12)} ${v} (${((v / u.systems.length) * 100).toFixed(1)}%)`);
}

const galaxy = sumResourceVectors(u.systems.map((s) => s.slotCap));
const totalAll = RESOURCE_TYPES.reduce((sum, t) => sum + galaxy[t], 0);
console.log("\nGalaxy slot-cap mix:");
for (const t of RESOURCE_TYPES) {
  console.log(`  ${t.padEnd(12)} ${galaxy[t].toFixed(0)} (${((galaxy[t] / totalAll) * 100).toFixed(1)}%)`);
}

let worst = { region: -1, arableShare: Infinity };
for (let ri = 0; ri < u.regions.length; ri++) {
  const agg = sumResourceVectors(
    u.systems.filter((s) => s.regionIndex === ri).map((s) => s.slotCap),
  );
  const tot = RESOURCE_TYPES.reduce((sum, t) => sum + agg[t], 0);
  const share = tot > 0 ? agg.arable / tot : 0;
  if (share < worst.arableShare) worst = { region: ri, arableShare: share };
}
console.log(
  `\nWeakest-arable region: #${worst.region} at ${(worst.arableShare * 100).toFixed(1)}% arable slot share`,
);

const pop = u.systems.map((s) => s.population).sort((a, b) => a - b);
console.log(
  `\nPopulation spread: min ${pop[0]}, median ${pop[Math.floor(pop.length / 2)]}, max ${pop[pop.length - 1]}`,
);

// ── NEW: Available-space coherence reports ────────────────────────

// 1. Space distribution: min / median / max / mean of availableSpace, generalSpace, habitableSpace
function stats(values: number[]): { min: number; median: number; max: number; mean: number } {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  return {
    min: sorted[0],
    median: n % 2 === 0
      ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2
      : sorted[Math.floor(n / 2)],
    max: sorted[n - 1],
    mean: values.reduce((s, v) => s + v, 0) / n,
  };
}

const availStats = stats(u.systems.map((s) => s.availableSpace));
const genStats   = stats(u.systems.map((s) => s.generalSpace));
const habStats   = stats(u.systems.map((s) => s.habitableSpace));

console.log("\nSpace distribution (per system):");
console.log("  " + "metric".padEnd(16) + "min".padStart(10) + "median".padStart(10) + "mean".padStart(10) + "max".padStart(10));
function fmtRow(label: string, s: ReturnType<typeof stats>): string {
  return "  " + label.padEnd(16)
    + s.min.toFixed(1).padStart(10)
    + s.median.toFixed(1).padStart(10)
    + s.mean.toFixed(1).padStart(10)
    + s.max.toFixed(1).padStart(10);
}
console.log(fmtRow("availableSpace", availStats));
console.log(fmtRow("generalSpace", genStats));
console.log(fmtRow("habitableSpace", habStats));

// 2. % systems with zero habitable space
const zeroHab = u.systems.filter((s) => s.habitableSpace < 1e-9).length;
console.log(
  `\n% systems with zero habitable space: ${zeroHab} / ${u.systems.length} (${((zeroHab / u.systems.length) * 100).toFixed(1)}%)`,
);

// 3. Mean slot cap per resource by sun class
console.log("\nMean slot cap per resource by sun class:");
const sunHeader = "  " + "resource".padEnd(14) + SUN_CLASSES.map((sc) => sc.padStart(13)).join("");
console.log(sunHeader);

for (const r of RESOURCE_TYPES) {
  let row = "  " + r.padEnd(14);
  for (const sc of SUN_CLASSES) {
    const sysList = u.systems.filter((s) => s.sunClass === sc);
    if (sysList.length === 0) {
      row += "n/a".padStart(13);
    } else {
      const mean = sysList.reduce((s, sys) => s + sys.slotCap[r], 0) / sysList.length;
      row += mean.toFixed(2).padStart(13);
    }
  }
  console.log(row);
}

// 4. Quality-band histogram across all body-resource pairs
const bandCounts: Record<QualityBandId, number> = { poor: 0, average: 0, good: 0, rich: 0 };
let totalBandSamples = 0;
for (const sys of u.systems) {
  for (const body of sys.bodies) {
    for (const r of RESOURCE_TYPES) {
      if (body.quality[r] > 0) {
        const band = bandForMultiplier(body.quality[r]);
        bandCounts[band]++;
        totalBandSamples++;
      }
    }
  }
}
const totalWeight = QUALITY_BANDS.reduce((s, b) => s + b.weight, 0);
console.log("\nQuality-band histogram (body × resource pairs with quality > 0):");
console.log("  " + "band".padEnd(10) + "count".padStart(8) + "%actual".padStart(10) + "%expected".padStart(12));
for (const bid of BAND_IDS) {
  const cnt = bandCounts[bid];
  const pct = totalBandSamples > 0 ? (cnt / totalBandSamples) * 100 : 0;
  const band = QUALITY_BANDS.find((b) => b.id === bid);
  const expected = band !== undefined ? (band.weight / totalWeight) * 100 : 0;
  console.log(
    "  " + bid.padEnd(10) + String(cnt).padStart(8) + pct.toFixed(1).padStart(10) + "%" + expected.toFixed(1).padStart(11) + "%",
  );
}
console.log(`  total samples: ${totalBandSamples}`);

// 5. Volatility-extreme proxy (approximate)
// Among multi-resource bodies (>1 present resource), count/% whose dominant slot
// is >= 60% of total deposit slots (Σ slots across resources).
let multiResourceBodies = 0;
let volatileExtremeBodies = 0;
for (const sys of u.systems) {
  for (const body of sys.bodies) {
    const presentResources = RESOURCE_TYPES.filter((r) => body.counts[r] > 0);
    if (presentResources.length <= 1) continue;
    multiResourceBodies++;
    const totalSlots = RESOURCE_TYPES.reduce((s, r) => s + body.counts[r], 0);
    if (totalSlots <= 0) continue;
    const dominantSlots = Math.max(...(RESOURCE_TYPES.map((r) => body.counts[r]) as [number, ...number[]]));
    if (dominantSlots / totalSlots >= 0.6) volatileExtremeBodies++;
  }
}
const volatilePct = multiResourceBodies > 0 ? (volatileExtremeBodies / multiResourceBodies) * 100 : 0;
console.log(
  `\nVolatility-extreme proxy (approximate): ${volatileExtremeBodies} / ${multiResourceBodies} multi-resource bodies have dominant deposit >= 60% of total slots (${volatilePct.toFixed(1)}%)`,
);

// 6. Partition-exhaustiveness invariant — RETIRED (habitability-seeding, T2): the surface
// partition (`partitionBody`, `SPACE_PER_SIZE`) it checked no longer exists — every body now
// authors peopleLand/industryLand/counts directly, with no shared-footprint identity to hold.
// The re-cut successor (`npm run report:coherence`, resolution table T6) owns the three-budget
// invariants instead (dead classes exactly 0 people land; counts integer and in-range;
// aggregates = Σ contributing bodies) and is out of this task's scope.
