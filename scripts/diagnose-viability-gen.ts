/**
 * Viability geography on the NEW seed, evaluated in-memory at MATURE population
 * (popCap) — non-destructive, never touches the DB. Companion to
 * diagnose-viability.ts (which reads the live, old-seed-evolved DB).
 *
 * "Mature" matters: at seed population is only ~33% of popCap, so food demand is
 * understated. Evaluating at popCap (where labour is fully staffed and demand is
 * highest) is the fair structural viability test — can a fully-grown system feed
 * itself, and if not can same-faction trade reach it?
 *
 * Run: npx tsx --tsconfig tsconfig.json scripts/diagnose-viability-gen.ts
 */
import { generateUniverse, type GenParams, type GeneratedSystem } from "@/lib/engine/universe-gen";
import { UNIVERSE_GEN, REGION_NAMES } from "@/lib/constants/universe-gen";
import { capacityGoodRates } from "@/lib/engine/industry";

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

const f2 = (n: number) => n.toFixed(2);
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

const u = generateUniverse(params, REGION_NAMES);
const n = u.systems.length;

function rates(s: GeneratedSystem) {
  // Evaluate at popCap (mature population): production fully staffed, demand at peak.
  const r = capacityGoodRates(s.buildings, s.popCap, s.yieldMult);
  const food = r.find((x) => x.goodId === "food");
  const water = r.find((x) => x.goodId === "water");
  return {
    foodProd: food?.production ?? 0, foodCons: food?.consumption ?? 0,
    waterProd: water?.production ?? 0, waterCons: water?.consumption ?? 0,
  };
}
const selfSuff = (prod: number, cons: number) => (cons <= 1e-9 ? (prod > 0 ? Infinity : 1) : prod / cons);

const sys = u.systems.map((s) => ({ s, fac: u.systemFactionAssignments[s.index], ...rates(s) }));

console.log("═".repeat(72));
console.log(`  VIABILITY GEOGRAPHY — NEW SEED, mature popCap — ${n} systems`);
console.log("═".repeat(72));

// ── 1. Local self-sufficiency at maturity ──
const histo = (label: string, sel: (v: typeof sys[number]) => number) => {
  const b = { full: 0, partial: 0, scarce: 0, none: 0 };
  for (const v of sys) {
    const r = sel(v);
    if (r >= 0.95) b.full++; else if (r >= 0.5) b.partial++; else if (r > 0.05) b.scarce++; else b.none++;
  }
  console.log(`  ${label}  self-suff ≥95%: ${pct(b.full / n)}   50–95%: ${pct(b.partial / n)}   5–50%: ${pct(b.scarce / n)}   <5%: ${pct(b.none / n)}`);
};
console.log("\n── 1. LOCAL SELF-SUFFICIENCY at popCap ──");
histo("FOOD: ", (v) => selfSuff(v.foodProd, v.foodCons));
histo("WATER:", (v) => selfSuff(v.waterProd, v.waterCons));

// ── 2. Faction balance at maturity ──
console.log("\n── 2. FACTION FOOD/WATER BALANCE at popCap (Σ prod / Σ demand; <1 = faction short) ──");
const fac = new Map<number, { name: string; fp: number; fc: number; wp: number; wc: number; count: number }>();
for (const v of sys) {
  const a = fac.get(v.fac) ?? { name: u.factions[v.fac]?.name ?? `#${v.fac}`, fp: 0, fc: 0, wp: 0, wc: 0, count: 0 };
  a.fp += v.foodProd; a.fc += v.foodCons; a.wp += v.waterProd; a.wc += v.waterCons; a.count++;
  fac.set(v.fac, a);
}
let shortFactions = 0;
const facRows = [...fac.values()].sort((a, b) => a.fp / Math.max(1e-9, a.fc) - b.fp / Math.max(1e-9, b.fc));
console.log(`  ${"faction".padEnd(24)}${"systems".padStart(8)}${"food bal".padStart(10)}${"water bal".padStart(11)}`);
for (const a of facRows) {
  const fb = a.fp / Math.max(1e-9, a.fc), wb = a.wp / Math.max(1e-9, a.wc);
  if (fb < 1 || wb < 1) shortFactions++;
  console.log(`  ${a.name.padEnd(24)}${String(a.count).padStart(8)}${f2(fb).padStart(10)}${f2(wb).padStart(11)}${fb < 1 || wb < 1 ? "  ← short" : ""}`);
}
console.log(`  → ${shortFactions} / ${fac.size} factions are net food/water short at maturity.`);

// ── 3. Proximity (same-faction food-exporter BFS) ──
const idx = new Map(sys.map((v) => [v.s.index, v]));
const adj = new Map<number, number[]>();
const addEdge = (a: number, b: number) => { const l = adj.get(a); if (l) l.push(b); else adj.set(a, [b]); };
for (const c of u.connections) {
  if (u.systemFactionAssignments[c.fromSystemIndex] !== u.systemFactionAssignments[c.toSystemIndex]) continue;
  addEdge(c.fromSystemIndex, c.toSystemIndex); addEdge(c.toSystemIndex, c.fromSystemIndex);
}
const hops = new Map<number, number>();
const q: number[] = [];
for (const v of sys) if (v.foodProd > v.foodCons * 1.05) { hops.set(v.s.index, 0); q.push(v.s.index); }
for (let i = 0; i < q.length; i++) {
  const id = q[i], d = hops.get(id) ?? 0;
  for (const nb of adj.get(id) ?? []) if (!hops.has(nb)) { hops.set(nb, d + 1); q.push(nb); }
}
let r0 = 0, r12 = 0, r3 = 0, unreach = 0;
for (const v of sys) { const h = hops.get(v.s.index); if (h === undefined) unreach++; else if (h === 0) r0++; else if (h <= 2) r12++; else r3++; }
console.log("\n── 3. PROXIMITY TO FOOD (hops to nearest same-faction net food exporter, at popCap) ──");
console.log(`  is a food exporter (0 hops): ${pct(r0 / n)}   within 1–2 hops: ${pct(r12 / n)}   3+ hops: ${pct(r3 / n)}   none reachable: ${pct(unreach / n)}`);

// ── 4. Structural viability classes ──
type Cls = "self-sufficient" | "suppliable" | "stranded";
const classOf = (v: typeof sys[number]): Cls => {
  if (selfSuff(v.foodProd, v.foodCons) >= 0.95 && selfSuff(v.waterProd, v.waterCons) >= 0.95) return "self-sufficient";
  const h = hops.get(v.s.index);
  return h !== undefined && h <= 2 ? "suppliable" : "stranded";
};
const counts: Record<Cls, number> = { "self-sufficient": 0, suppliable: 0, stranded: 0 };
for (const v of sys) counts[classOf(v)]++;
console.log("\n── 4. STRUCTURAL VIABILITY CLASSES (new seed, at maturity) ──");
for (const c of ["self-sufficient", "suppliable", "stranded"] as Cls[]) {
  console.log(`  ${c.padEnd(18)} ${String(counts[c]).padStart(5)}  (${pct(counts[c] / n)})`);
}
console.log(`\n  stranded = can't feed itself AND no same-faction food within 2 hops → the structurally doomed tail.`);
console.log(`  self-sufficient = the durable core that anchors the equilibrium regardless of agency.`);
