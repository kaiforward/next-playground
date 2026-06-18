/**
 * One-off verification: report the generated galaxy's economy-type
 * distribution, galaxy-wide aggregate resource totals, and the weakest region's
 * arable (food) share. Run: npx tsx --tsconfig tsconfig.json scripts/substrate-coherence.ts
 */
import { generateUniverse, type GenParams } from "@/lib/engine/universe-gen";
import { UNIVERSE_GEN, REGION_NAMES } from "@/lib/constants/universe-gen";
import { RESOURCE_TYPES, sumResourceVectors } from "@/lib/engine/resources";

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

const econ = new Map<string, number>();
for (const s of u.systems) econ.set(s.economyType, (econ.get(s.economyType) ?? 0) + 1);
console.log("Economy-type distribution:");
for (const [k, v] of [...econ].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(12)} ${v} (${((v / u.systems.length) * 100).toFixed(1)}%)`);
}

const galaxy = sumResourceVectors(u.systems.map((s) => s.aggregate));
const totalAll = RESOURCE_TYPES.reduce((sum, t) => sum + galaxy[t], 0);
console.log("\nGalaxy resource mix:");
for (const t of RESOURCE_TYPES) {
  console.log(`  ${t.padEnd(12)} ${galaxy[t].toFixed(0)} (${((galaxy[t] / totalAll) * 100).toFixed(1)}%)`);
}

let worst = { region: -1, arableShare: Infinity };
for (let ri = 0; ri < u.regions.length; ri++) {
  const agg = sumResourceVectors(
    u.systems.filter((s) => s.regionIndex === ri).map((s) => s.aggregate),
  );
  const tot = RESOURCE_TYPES.reduce((sum, t) => sum + agg[t], 0);
  const share = tot > 0 ? agg.arable / tot : 0;
  if (share < worst.arableShare) worst = { region: ri, arableShare: share };
}
console.log(
  `\nWeakest-arable region: #${worst.region} at ${(worst.arableShare * 100).toFixed(1)}% arable share`,
);

const pop = u.systems.map((s) => s.population).sort((a, b) => a - b);
console.log(
  `\nPopulation spread: min ${pop[0]}, median ${pop[Math.floor(pop.length / 2)]}, max ${pop[pop.length - 1]}`,
);
