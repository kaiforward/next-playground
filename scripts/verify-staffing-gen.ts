/**
 * Generation-level verification of the seed staffing-self-consistency fix (no DB).
 * Generates the default universe and reports the staffing-ceiling distribution
 * (popCap / labourDemand — the max labourFulfillment a system can ever reach) plus
 * how many systems seed with no industry, split by whether they have habitable land.
 *
 * Run: npx tsx --tsconfig tsconfig.json scripts/verify-staffing-gen.ts
 */
import { generateUniverse, type GenParams } from "@/lib/engine/universe-gen";
import { UNIVERSE_GEN, REGION_NAMES } from "@/lib/constants/universe-gen";
import { labourDemand, labourFulfillment } from "@/lib/engine/industry";
import { HOUSING_TYPE } from "@/lib/constants/industry";

const params: GenParams = {
  seed: UNIVERSE_GEN.SEED,
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
  minorFactionCount: UNIVERSE_GEN.MINOR_FACTION_COUNT,
};

const u = generateUniverse(params, REGION_NAMES);
const n = u.systems.length;
const pct = (x: number) => `${((x / n) * 100).toFixed(1)}%`;

let totalBuildings = 0;
let withIndustry = 0;
let noIndustryNoHab = 0; // habitableSpace 0 → truly dead (expected)
let noIndustryWithHab = 0; // has habitable land but seeded no industry (worth knowing)
const ceilings: number[] = [];
const habUtil: number[] = []; // housing land / habitable land, for systems with habitable land
const popFill: number[] = []; // seed population / popCap (growth headroom = 1 − this)

for (const s of u.systems) {
  const buildings = s.buildings;
  for (const [t, c] of Object.entries(buildings)) {
    if (t !== HOUSING_TYPE) totalBuildings += c;
  }
  if (s.habitableSpace > 1e-9) {
    const housing = buildings[HOUSING_TYPE] ?? 0; // popCost 1 → housing land == housing count
    habUtil.push(housing / s.habitableSpace);
  }
  if (s.popCap > 1e-9) popFill.push(s.population / s.popCap);
  const demand = labourDemand(buildings);
  if (demand <= 0) {
    if (s.habitableSpace < 1e-9) noIndustryNoHab++;
    else noIndustryWithHab++;
    continue;
  }
  withIndustry++;
  ceilings.push(labourFulfillment(s.popCap, demand));
}

const histo = (label: string, lo: number, hi: number) => {
  const c = ceilings.filter((v) => v >= lo && v < hi).length;
  console.log(`  ceiling ${label.padEnd(12)} ${String(c).padStart(5)}  (${((c / ceilings.length) * 100).toFixed(1)}% of industried)`);
};

console.log(`Universe: ${n} systems`);
console.log(`Total production buildings seeded: ${totalBuildings.toFixed(0)}`);
console.log(`\nSystems with a labour-demanding base: ${withIndustry} (${pct(withIndustry)})`);
console.log(`Systems with NO industry: ${noIndustryNoHab + noIndustryWithHab} (${pct(noIndustryNoHab + noIndustryWithHab)})`);
console.log(`  ├─ no habitable land (truly dead, awaits SP5 habitation): ${noIndustryNoHab} (${pct(noIndustryNoHab)})`);
console.log(`  └─ has habitable land but no industry:                    ${noIndustryWithHab} (${pct(noIndustryWithHab)})`);

console.log(`\nStaffing ceiling (popCap / labourDemand) across industried systems:`);
histo("< 0.50", 0, 0.5);
histo("0.50–0.80", 0.5, 0.8);
histo("0.80–0.98", 0.8, 0.98);
histo("≥ 0.98", 0.98, Infinity);
const mean = ceilings.reduce((a, b) => a + b, 0) / ceilings.length;
console.log(`  mean ceiling: ${mean.toFixed(3)}  (1.0 = every industried system can fully staff at full population)`);

const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const frac = (xs: number[], pred: (v: number) => boolean) => xs.filter(pred).length / xs.length;
console.log(`\nHabitable-land utilisation at seed (housing land / habitable land), ${habUtil.length} systems with habitable land:`);
console.log(`  mean: ${(avg(habUtil) * 100).toFixed(1)}%   maxed (≥95%): ${(frac(habUtil, (v) => v >= 0.95) * 100).toFixed(1)}%   under half (<50%): ${(frac(habUtil, (v) => v < 0.5) * 100).toFixed(1)}%`);
console.log(`  → where maxed, natural population expansion has no housing land to grow into (needs SP5 off-habitable housing).`);
console.log(`\nSeed population fill (population / popCap), ${popFill.length} systems:`);
console.log(`  mean: ${(avg(popFill) * 100).toFixed(1)}%   → mean growth headroom toward popCap = ${((1 - avg(popFill)) * 100).toFixed(1)}% (the room a thriving world can climb without new housing).`);
