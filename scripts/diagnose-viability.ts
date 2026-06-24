/**
 * Viability geography audit. Tests the hypothesis that the progressive decline is
 * driven by food/water starvation: systems that can't feed themselves AND have no
 * reachable same-faction supplier are the doomed tail, while food/water-rich (good
 * deposit roll) systems endure and form the surviving equilibrium.
 *
 * Production is invariant under the seed staffing-scale (count × fulfillment is
 * conserved), so local self-sufficiency is seed-independent — this live-DB read
 * transfers to the new seed.
 *
 * Three lenses:
 *   1. Local self-sufficiency — food/water production vs the system's own demand.
 *   2. Faction balance — Σ production vs Σ demand per faction (trade is faction-bounded,
 *      so a net-negative faction can't save its deficit systems by trade at all).
 *   3. Proximity — hops to the nearest same-faction food surplus (multi-source BFS over
 *      the jump graph, edges restricted to same-faction pairs).
 * Then classifies every system (self-sufficient / suppliable / stranded) and correlates
 * the class with actual unrest + population fill.
 *
 * Run: npx tsx --env-file=.env scripts/diagnose-viability.ts
 */
import { prisma } from "@/lib/prisma";
import { capacityGoodRates } from "@/lib/engine/industry";
import { resourceVectorFromColumns } from "@/lib/engine/resources";

const f1 = (n: number) => n.toFixed(1);
const f2 = (n: number) => n.toFixed(2);
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

interface SysView {
  id: string;
  name: string;
  factionId: string | null;
  factionName: string;
  population: number;
  popCap: number;
  unrest: number;
  foodProd: number;
  foodCons: number;
  waterProd: number;
  waterCons: number;
}

function selfSuff(prod: number, cons: number): number {
  if (cons <= 1e-9) return prod > 0 ? Infinity : 1; // no demand → trivially fine
  return prod / cons;
}

async function main() {
  const systems = await prisma.starSystem.findMany({
    select: {
      id: true, name: true, factionId: true, population: true, popCap: true, unrest: true,
      yieldGas: true, yieldMinerals: true, yieldOre: true, yieldBiomass: true,
      yieldArable: true, yieldWater: true, yieldRadioactive: true,
      faction: { select: { name: true } },
      buildings: { select: { buildingType: true, count: true } },
    },
  });
  const connections = await prisma.systemConnection.findMany({
    select: { fromSystemId: true, toSystemId: true },
  });

  const views: SysView[] = systems.map((s) => {
    const buildings: Record<string, number> = {};
    for (const b of s.buildings) buildings[b.buildingType] = b.count;
    const yields = resourceVectorFromColumns(
      {
        yieldGas: s.yieldGas, yieldMinerals: s.yieldMinerals, yieldOre: s.yieldOre,
        yieldBiomass: s.yieldBiomass, yieldArable: s.yieldArable,
        yieldWater: s.yieldWater, yieldRadioactive: s.yieldRadioactive,
      },
      "yield",
    );
    const rates = capacityGoodRates(buildings, s.population, yields);
    const food = rates.find((r) => r.goodId === "food");
    const water = rates.find((r) => r.goodId === "water");
    return {
      id: s.id, name: s.name, factionId: s.factionId, factionName: s.faction?.name ?? "—",
      population: s.population, popCap: s.popCap, unrest: s.unrest,
      foodProd: food?.production ?? 0, foodCons: food?.consumption ?? 0,
      waterProd: water?.production ?? 0, waterCons: water?.consumption ?? 0,
    };
  });
  const byId = new Map(views.map((v) => [v.id, v]));
  const n = views.length;

  // ── 1. Local self-sufficiency ──
  const histo = (label: string, sel: (v: SysView) => number) => {
    const buckets = { full: 0, partial: 0, scarce: 0, none: 0 };
    for (const v of views) {
      const r = sel(v);
      if (r >= 0.95) buckets.full++;
      else if (r >= 0.5) buckets.partial++;
      else if (r > 0.05) buckets.scarce++;
      else buckets.none++;
    }
    console.log(`  ${label}`);
    console.log(`    self-sufficient (≥95%): ${String(buckets.full).padStart(5)} (${pct(buckets.full / n)})   partial (50–95%): ${String(buckets.partial).padStart(5)} (${pct(buckets.partial / n)})`);
    console.log(`    scarce (5–50%):         ${String(buckets.scarce).padStart(5)} (${pct(buckets.scarce / n)})   ~none (<5%):      ${String(buckets.none).padStart(5)} (${pct(buckets.none / n)})`);
  };
  console.log("═".repeat(72));
  console.log(`  VIABILITY GEOGRAPHY — ${n} systems`);
  console.log("═".repeat(72));
  console.log("\n── 1. LOCAL SELF-SUFFICIENCY (own production vs own demand) ──");
  histo("FOOD:", (v) => selfSuff(v.foodProd, v.foodCons));
  histo("WATER:", (v) => selfSuff(v.waterProd, v.waterCons));

  // ── 2. Faction-level balance (the importable pool — trade is faction-bounded) ──
  console.log("\n── 2. FACTION FOOD/WATER BALANCE (Σ production / Σ demand; <1 = whole faction is short) ──");
  const facAgg = new Map<string, { name: string; fp: number; fc: number; wp: number; wc: number; count: number }>();
  for (const v of views) {
    const key = v.factionId ?? "none";
    const a = facAgg.get(key) ?? { name: v.factionName, fp: 0, fc: 0, wp: 0, wc: 0, count: 0 };
    a.fp += v.foodProd; a.fc += v.foodCons; a.wp += v.waterProd; a.wc += v.waterCons; a.count++;
    facAgg.set(key, a);
  }
  const facRows = [...facAgg.values()].sort((a, b) => a.fp / Math.max(1e-9, a.fc) - b.fp / Math.max(1e-9, b.fc));
  console.log(`  ${"faction".padEnd(24)}${"systems".padStart(8)}${"food bal".padStart(10)}${"water bal".padStart(11)}`);
  for (const a of facRows) {
    const fb = a.fp / Math.max(1e-9, a.fc);
    const wb = a.wp / Math.max(1e-9, a.wc);
    const flag = fb < 1 || wb < 1 ? "  ← short" : "";
    console.log(`  ${a.name.padEnd(24)}${String(a.count).padStart(8)}${f2(fb).padStart(10)}${f2(wb).padStart(11)}${flag}`);
  }

  // ── 3. Proximity — hops to nearest same-faction food surplus (multi-source BFS) ──
  const adj = new Map<string, string[]>();
  const addEdge = (a: string, b: string) => {
    const list = adj.get(a);
    if (list) list.push(b);
    else adj.set(a, [b]);
  };
  for (const c of connections) {
    const a = byId.get(c.fromSystemId), b = byId.get(c.toSystemId);
    if (!a || !b) continue;
    if (a.factionId === null || a.factionId !== b.factionId) continue; // trade is faction-bounded
    addEdge(c.fromSystemId, c.toSystemId);
    addEdge(c.toSystemId, c.fromSystemId);
  }
  const foodHops = new Map<string, number>();
  const queue: string[] = [];
  for (const v of views) {
    if (v.foodProd > v.foodCons * 1.05) { foodHops.set(v.id, 0); queue.push(v.id); } // net food exporter
  }
  for (let qi = 0; qi < queue.length; qi++) {
    const id = queue[qi];
    const d = foodHops.get(id) ?? 0;
    for (const nb of adj.get(id) ?? []) {
      if (!foodHops.has(nb)) { foodHops.set(nb, d + 1); queue.push(nb); }
    }
  }
  let reach0 = 0, reach12 = 0, reach3p = 0, unreachable = 0;
  for (const v of views) {
    const h = foodHops.get(v.id);
    if (h === undefined) unreachable++;
    else if (h === 0) reach0++;
    else if (h <= 2) reach12++;
    else reach3p++;
  }
  console.log("\n── 3. PROXIMITY TO FOOD (hops to nearest same-faction net food exporter) ──");
  console.log(`  is a food exporter (0 hops):       ${String(reach0).padStart(5)} (${pct(reach0 / n)})`);
  console.log(`  food within 1–2 hops:              ${String(reach12).padStart(5)} (${pct(reach12 / n)})`);
  console.log(`  food only 3+ hops away:            ${String(reach3p).padStart(5)} (${pct(reach3p / n)})`);
  console.log(`  NO same-faction food reachable:    ${String(unreachable).padStart(5)} (${pct(unreachable / n)})  ← structurally stranded`);

  // ── 4. Viability classification + outcome correlation ──
  type Cls = "self-sufficient" | "suppliable" | "stranded";
  const classify = (v: SysView): Cls => {
    const foodOk = selfSuff(v.foodProd, v.foodCons) >= 0.95 && selfSuff(v.waterProd, v.waterCons) >= 0.95;
    if (foodOk) return "self-sufficient";
    const h = foodHops.get(v.id);
    if (h !== undefined && h <= 2) return "suppliable";
    return "stranded";
  };
  const classes: Record<Cls, SysView[]> = { "self-sufficient": [], suppliable: [], stranded: [] };
  for (const v of views) classes[classify(v)].push(v);

  console.log("\n── 4. VIABILITY CLASS → ACTUAL OUTCOME (mean unrest, mean pop fill, % declining) ──");
  console.log(`  ${"class".padEnd(18)}${"count".padStart(7)}${"share".padStart(8)}${"unrest".padStart(9)}${"pop/cap".padStart(9)}${"striking".padStart(10)}`);
  for (const cls of ["self-sufficient", "suppliable", "stranded"] as Cls[]) {
    const g = classes[cls];
    if (g.length === 0) continue;
    const mu = g.reduce((s, v) => s + v.unrest, 0) / g.length;
    const mf = g.reduce((s, v) => s + (v.popCap > 0 ? v.population / v.popCap : 0), 0) / g.length;
    const striking = g.filter((v) => v.unrest >= 0.65).length;
    console.log(`  ${cls.padEnd(18)}${String(g.length).padStart(7)}${pct(g.length / n).padStart(8)}${f2(mu).padStart(9)}${pct(mf).padStart(9)}${pct(striking / g.length).padStart(10)}`);
  }

  // ── 5. The durable survivors — self-sufficient + calm, richest food roll first ──
  const durable = classes["self-sufficient"]
    .filter((v) => v.unrest < 0.3)
    .sort((a, b) => selfSuff(b.foodProd, b.foodCons) - selfSuff(a.foodProd, a.foodCons));
  console.log(`\n── 5. DURABLE CORE (self-sufficient + calm unrest<0.3): ${durable.length} systems (${pct(durable.length / n)}) ──`);
  for (const v of durable.slice(0, 8)) {
    console.log(`  ${v.name.padEnd(20)} food ${f1(v.foodProd)}/${f1(v.foodCons)}  water ${f1(v.waterProd)}/${f1(v.waterCons)}  unrest ${f2(v.unrest)}  pop ${f1(v.population)}/${f1(v.popCap)}`);
  }
}

main()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());
