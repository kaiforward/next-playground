/**
 * Economy audit — a read-only diagnostic over the live dev DB.
 *
 *   npm run audit:economy
 *
 * Recomputes per-system production/consumption, market-band positions, prices,
 * satisfaction, unrest and trade-flow behaviour from a live snapshot, reusing the
 * real engine functions (no reimplementation). A calibration instrument, not a
 * game feature — safe to run any time; mutates nothing.
 *
 * Sections:
 *   1. Galaxy + population health (unrest, strikes, real satisfaction vs unrest)
 *   2. Production vs consumption (nameplate capacity & input-gated, per tier/good)
 *   3. Price levels (how cheap/expensive markets sit vs basePrice)
 *   4. Regional variation (so a local-area observation can be placed vs the mean)
 *   5. Trade flows (market vs logistics volume, overshoot, opposition/round-trips)
 */
import { prisma } from "@/lib/prisma";
import { GOOD_NAME_TO_KEY, GOOD_TIER_BY_KEY } from "@/lib/constants/goods";
import { resourceVectorFromColumns } from "@/lib/engine/resources";
import {
  capacityGoodRates,
  inputDemandForGood,
  labourDemand,
  labourFulfillment,
} from "@/lib/engine/industry";
import { inputGate } from "@/lib/engine/supply-chain";
import { marketBandForRow, midPriceAt, curveForGood } from "@/lib/engine/market-pricing";
import { selfLimitingFactor } from "@/lib/engine/tick";
import { dissatisfaction, type GoodSatisfaction } from "@/lib/engine/population";
import { STRIKE_PARAMS } from "@/lib/constants/population";
import { DIRECTED_LOGISTICS } from "@/lib/constants/directed-logistics";
import type { ResourceVector } from "@/lib/types/game";

function strikeMult(unrest: number): number {
  const { threshold, floorMultiplier } = STRIKE_PARAMS;
  if (unrest <= threshold) return 1;
  if (unrest >= 1) return floorMultiplier;
  const t = (unrest - threshold) / (1 - threshold);
  return 1 - t * (1 - floorMultiplier);
}
function pct(n: number, d: number): string {
  return d === 0 ? "0%" : `${((100 * n) / d).toFixed(1)}%`;
}
function f(n: number, d = 1): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: d });
}
function mean(arr: number[]): number {
  return arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : 0;
}
function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function quantile(arr: number[], q: number): number {
  if (arr.length === 0) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
}

interface MarketRow {
  key: string;
  tier: number;
  stock: number;
  demandRate: number;
  storageCapacity: number;
  anchorMult: number;
  basePrice: number;
  priceFloor: number;
  priceCeiling: number;
}

async function main() {
  const world = await prisma.gameWorld.findFirst();
  const currentTick = world?.currentTick ?? 0;

  const goods = await prisma.good.findMany({
    select: { id: true, name: true, tier: true, basePrice: true, priceFloor: true, priceCeiling: true },
  });
  const goodById = new Map<string, { key: string; tier: number; basePrice: number; priceFloor: number; priceCeiling: number }>();
  for (const g of goods) {
    const key = GOOD_NAME_TO_KEY.get(g.name);
    if (!key) continue;
    goodById.set(g.id, { key, tier: g.tier, basePrice: g.basePrice, priceFloor: g.priceFloor, priceCeiling: g.priceCeiling });
  }

  const [systems, stations, buildingRows, marketRows, regions] = await Promise.all([
    prisma.starSystem.findMany({
      select: {
        id: true, name: true, economyType: true, factionId: true, regionId: true,
        population: true, popCap: true, unrest: true,
        yieldGas: true, yieldMinerals: true, yieldOre: true, yieldBiomass: true,
        yieldArable: true, yieldWater: true, yieldRadioactive: true,
      },
    }),
    prisma.station.findMany({ select: { id: true, systemId: true } }),
    prisma.systemBuilding.findMany({ select: { systemId: true, buildingType: true, count: true } }),
    prisma.stationMarket.findMany({
      select: { stationId: true, goodId: true, stock: true, demandRate: true, storageCapacity: true, anchorMult: true },
    }),
    prisma.region.findMany({ select: { id: true, name: true } }),
  ]);

  const regionName = new Map<string, string>();
  for (const r of regions) regionName.set(r.id, r.name);
  const systemIdByStation = new Map<string, string>();
  for (const s of stations) systemIdByStation.set(s.id, s.systemId);
  const buildingsBySystem = new Map<string, Record<string, number>>();
  for (const b of buildingRows) {
    const m = buildingsBySystem.get(b.systemId) ?? {};
    m[b.buildingType] = b.count;
    buildingsBySystem.set(b.systemId, m);
  }
  const marketsBySystem = new Map<string, MarketRow[]>();
  for (const m of marketRows) {
    const sysId = systemIdByStation.get(m.stationId);
    if (!sysId) continue;
    const g = goodById.get(m.goodId);
    if (!g) continue;
    const list = marketsBySystem.get(sysId) ?? [];
    list.push({
      key: g.key, tier: g.tier, stock: m.stock, demandRate: m.demandRate,
      storageCapacity: m.storageCapacity, anchorMult: m.anchorMult,
      basePrice: g.basePrice, priceFloor: g.priceFloor, priceCeiling: g.priceCeiling,
    });
    marketsBySystem.set(sysId, list);
  }

  interface GoodAgg {
    prodCap: number; prodGated: number; consCiv: number; consInd: number;
    markets: number; coverRatios: number[];
    nSurplus: number; nDeficit: number; nBalanced: number; nPinnedHigh: number; nPinnedLow: number;
    satisfactions: number[]; priceRatios: number[]; nCheap: number; nExpensive: number;
  }
  const tierOf = new Map<string, number>();
  const goodAgg = new Map<string, GoodAgg>();
  function agg(key: string): GoodAgg {
    let a = goodAgg.get(key);
    if (!a) {
      a = { prodCap: 0, prodGated: 0, consCiv: 0, consInd: 0, markets: 0, coverRatios: [], nSurplus: 0, nDeficit: 0, nBalanced: 0, nPinnedHigh: 0, nPinnedLow: 0, satisfactions: [], priceRatios: [], nCheap: 0, nExpensive: 0 };
      goodAgg.set(key, a);
    }
    return a;
  }

  const unrests: number[] = [];
  const dVals: number[] = []; // recomputed equilibrium-target dissatisfaction
  const utils: number[] = [];
  const allPriceRatios: number[] = [];
  let totalPop = 0, totalPopCap = 0;
  let nStriking = 0, nElevated = 0, nCalm = 0, nZeroPop = 0;
  const econDist = new Map<string, number>();
  const factionSysCount = new Map<string | null, number>();
  const targetByKey = new Map<string, number>();

  interface RegionAgg { sys: number; sumUnrest: number; sumSat: number; nSat: number; sumPriceR: number; nPrice: number; }
  const regionAgg = new Map<string, RegionAgg>();
  function reg(id: string): RegionAgg {
    let a = regionAgg.get(id);
    if (!a) { a = { sys: 0, sumUnrest: 0, sumSat: 0, nSat: 0, sumPriceR: 0, nPrice: 0 }; regionAgg.set(id, a); }
    return a;
  }

  for (const sys of systems) {
    factionSysCount.set(sys.factionId, (factionSysCount.get(sys.factionId) ?? 0) + 1);
    econDist.set(sys.economyType, (econDist.get(sys.economyType) ?? 0) + 1);
    totalPop += sys.population;
    totalPopCap += sys.popCap;
    unrests.push(sys.unrest);
    if (sys.population < 1) nZeroPop++;
    if (sys.popCap > 0) utils.push(sys.population / sys.popCap);
    if (sys.unrest >= STRIKE_PARAMS.threshold) nStriking++;
    else if (sys.unrest >= 0.2) nElevated++;
    else nCalm++;
    const ra = reg(sys.regionId);
    ra.sys++; ra.sumUnrest += sys.unrest;

    const buildings = buildingsBySystem.get(sys.id) ?? {};
    const markets = marketsBySystem.get(sys.id) ?? [];
    const yields: ResourceVector = resourceVectorFromColumns(
      {
        yieldGas: sys.yieldGas, yieldMinerals: sys.yieldMinerals, yieldOre: sys.yieldOre,
        yieldBiomass: sys.yieldBiomass, yieldArable: sys.yieldArable, yieldWater: sys.yieldWater,
        yieldRadioactive: sys.yieldRadioactive,
      },
      "yield",
    );

    const dem = labourDemand(buildings);
    const ful = labourFulfillment(sys.population, dem);
    const sMult = strikeMult(sys.unrest);
    const rates = capacityGoodRates(buildings, sys.population, yields);
    const prodByKey = new Map(rates.map((r) => [r.goodId, r.production]));
    const consByKey = new Map(rates.map((r) => [r.goodId, r.consumption]));

    const bandByKey = new Map<string, { target: number; min: number; max: number }>();
    const stockByKey = new Map<string, number>();
    for (const m of markets) {
      const band = marketBandForRow(m, m);
      bandByKey.set(m.key, { target: band.targetStock, min: band.minStock, max: band.maxStock });
      stockByKey.set(m.key, m.stock);
      targetByKey.set(`${sys.id}|${m.key}`, band.targetStock);
    }
    const stockOf = (k: string) => stockByKey.get(k) ?? 0;
    const minOf = (k: string) => bandByKey.get(k)?.min ?? 0;

    const satGoods: GoodSatisfaction[] = [];
    for (const m of markets) {
      tierOf.set(m.key, m.tier);
      const a = agg(m.key);
      a.markets++;

      const cap = prodByKey.get(m.key) ?? 0;
      const civ = consByKey.get(m.key) ?? 0;
      const ind = inputDemandForGood(buildings, m.key, ful, yields);
      const gate = inputGate(m.key, cap, stockOf, minOf);
      a.prodCap += cap;
      a.prodGated += cap * gate * sMult;
      a.consCiv += civ;
      a.consInd += ind;

      const band = bandByKey.get(m.key)!;
      // price level
      const price = midPriceAt(curveForGood(m.basePrice, m.priceFloor, m.priceCeiling, m.demandRate, m.anchorMult), m.stock);
      const priceR = price / m.basePrice;
      a.priceRatios.push(priceR);
      allPriceRatios.push(priceR);
      if (priceR < 0.9) a.nCheap++;
      else if (priceR > 1.1) a.nExpensive++;
      ra.sumPriceR += priceR; ra.nPrice++;

      if (band.target > 0) {
        const cover = m.stock / band.target;
        a.coverRatios.push(cover);
        if (cover >= DIRECTED_LOGISTICS.SURPLUS_MARGIN) a.nSurplus++;
        else if (cover < DIRECTED_LOGISTICS.DEFICIT_FRACTION) a.nDeficit++;
        else a.nBalanced++;
        if (band.max > band.min && m.stock >= band.min + 0.98 * (band.max - band.min)) a.nPinnedHigh++;
        if (m.stock <= band.min * 1.02) a.nPinnedLow++;
      }

      // real satisfaction = consume-direction self-limiting factor (exactly economy.ts),
      // anchor-relative: saturates at the days-of-supply anchor (target), for civilian goods.
      if (civ > 0 && band.target > band.min) {
        const sat = selfLimitingFactor(m.stock, band.min, band.target, "consume");
        a.satisfactions.push(sat);
        satGoods.push({ satisfaction: sat, demanded: civ });
        ra.sumSat += sat; ra.nSat++;
      }
    }
    dVals.push(dissatisfaction(satGoods));
  }

  const L: string[] = [];
  const meanUnrest = mean(unrests);
  const meanD = mean(dVals);
  const meanSat = mean([...goodAgg.values()].flatMap((a) => a.satisfactions));

  L.push(`================ ECONOMY AUDIT @ tick ${currentTick} (scale ${process.env.UNIVERSE_SCALE}) ================`);
  L.push(``);
  L.push(`SYSTEMS: ${systems.length}   FACTIONS: ${factionSysCount.size - (factionSysCount.has(null) ? 1 : 0)} (+${factionSysCount.get(null) ?? 0} independent systems)`);
  L.push(`POPULATION: total ${f(totalPop, 0)}  |  popCap ${f(totalPopCap, 0)}  |  galaxy utilisation ${pct(totalPop, totalPopCap)}`);
  L.push(`  ~0 pop systems: ${nZeroPop} (${pct(nZeroPop, systems.length)})  | per-system util median ${(median(utils) * 100).toFixed(0)}%  p10 ${(quantile(utils, 0.1) * 100).toFixed(0)}%  p90 ${(quantile(utils, 0.9) * 100).toFixed(0)}%`);
  L.push(``);
  L.push(`POPULATION HEALTH (unrest = integral of dissatisfaction; strike threshold ${STRIKE_PARAMS.threshold})`);
  L.push(`  unrest: mean ${meanUnrest.toFixed(3)}  median ${median(unrests).toFixed(3)}  p90 ${quantile(unrests, 0.9).toFixed(3)}  p99 ${quantile(unrests, 0.99).toFixed(3)}  max ${Math.max(...unrests).toFixed(3)}`);
  L.push(`  calm (<0.2): ${nCalm} (${pct(nCalm, systems.length)})   elevated (0.2–0.65): ${nElevated} (${pct(nElevated, systems.length)})   STRIKING (>=0.65): ${nStriking} (${pct(nStriking, systems.length)})`);
  L.push(``);
  L.push(`  SATISFACTION (= √((stock−min)/(target−min)), the consume self-limiting factor — reaches 1.0 at the days-of-supply ANCHOR):`);
  L.push(`    mean per-good satisfaction: ${meanSat.toFixed(3)}   →  equilibrium unrest target D (mean): ${meanD.toFixed(3)}   vs actual mean unrest ${meanUnrest.toFixed(3)}`);
  L.push(`    NB: a good at/above its anchor (stock≥target) now reads fully satisfied → unrest is no longer floored by abundance the model refused to credit.`);
  L.push(``);
  L.push(`ECONOMY TYPES: ${[...econDist.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join("  ")}`);
  L.push(``);

  // Production vs consumption
  L.push(`================ PRODUCTION vs CONSUMPTION (galaxy-wide, per economy-run units) ================`);
  L.push(`nameplate = staffed capacity (×labour ×yield); gated = ×inputGate ×strike. consTotal = civilian + industrial. ratio = prod/consTotal.`);
  L.push(``);
  for (const t of [0, 1, 2]) {
    let pc = 0, pg = 0, cc = 0, ci = 0;
    for (const [key, a] of goodAgg) {
      if ((tierOf.get(key) ?? GOOD_TIER_BY_KEY[key]) !== t) continue;
      pc += a.prodCap; pg += a.prodGated; cc += a.consCiv; ci += a.consInd;
    }
    const ct = cc + ci;
    L.push(`TIER ${t}: nameplate ${f(pc, 0)}  gated ${f(pg, 0)}  | consTotal ${f(ct, 0)} (civ ${f(cc, 0)} + ind ${f(ci, 0)})  | nameplate/cons ${(pc / ct).toFixed(2)}x  (~${pct(Math.max(0, pc - ct), pc)} idle capacity)`);
  }
  L.push(``);
  L.push(`  good             tier  nameplate    gated   consTot  npl/cons  medCover  %surplus  %deficit  medPrice  %cheap  meanSat`);
  const rows = [...goodAgg.entries()].map(([key, a]) => {
    const ct = a.consCiv + a.consInd;
    return { key, tier: tierOf.get(key) ?? GOOD_TIER_BY_KEY[key] ?? 0, a, ct, nplR: ct > 0 ? a.prodCap / ct : 0 };
  }).sort((x, y) => x.tier - y.tier || y.nplR - x.nplR);
  for (const r of rows) {
    const a = r.a;
    L.push(
      `  ${r.key.padEnd(16)} ${String(r.tier).padStart(2)}  ${f(a.prodCap, 0).padStart(9)} ${f(a.prodGated, 0).padStart(8)} ${f(r.ct, 0).padStart(9)}   ${r.nplR.toFixed(2).padStart(5)}x  ${median(a.coverRatios).toFixed(2).padStart(6)}  ${pct(a.nSurplus, a.markets).padStart(7)}  ${pct(a.nDeficit, a.markets).padStart(7)}  ${median(a.priceRatios).toFixed(2).padStart(6)}x  ${pct(a.nCheap, a.markets).padStart(5)}  ${median(a.satisfactions).toFixed(2).padStart(5)}`,
    );
  }
  L.push(``);

  // Price levels
  L.push(`================ PRICE LEVELS (price / basePrice across all ${f(allPriceRatios.length, 0)} markets) ================`);
  const nCheapAll = allPriceRatios.filter((x) => x < 0.9).length;
  const nExpAll = allPriceRatios.filter((x) => x > 1.1).length;
  L.push(`  median ${median(allPriceRatios).toFixed(2)}x base   p10 ${quantile(allPriceRatios, 0.1).toFixed(2)}x   p90 ${quantile(allPriceRatios, 0.9).toFixed(2)}x`);
  L.push(`  CHEAP (<0.9× base): ${pct(nCheapAll, allPriceRatios.length)}   near base (0.9–1.1×): ${pct(allPriceRatios.length - nCheapAll - nExpAll, allPriceRatios.length)}   EXPENSIVE (>1.1× base): ${pct(nExpAll, allPriceRatios.length)}`);
  L.push(`  → markets skew ${median(allPriceRatios) < 1 ? "CHEAP (stock above anchor — the overproduction signature)" : "expensive"}.`);
  L.push(``);

  // Regional variation
  L.push(`================ REGIONAL VARIATION (${regionAgg.size} regions; locate a local area vs the mean) ================`);
  const regRows = [...regionAgg.entries()].map(([id, a]) => ({
    name: regionName.get(id) ?? id, sys: a.sys,
    unrest: a.sys ? a.sumUnrest / a.sys : 0,
    sat: a.nSat ? a.sumSat / a.nSat : 0,
    priceR: a.nPrice ? a.sumPriceR / a.nPrice : 0,
  })).filter((r) => r.sys >= 5);
  const priceRs = regRows.map((r) => r.priceR);
  const unrestRs = regRows.map((r) => r.unrest);
  L.push(`  region price/base: mean ${mean(priceRs).toFixed(2)}x  spread ${quantile(priceRs, 0.05).toFixed(2)}–${quantile(priceRs, 0.95).toFixed(2)}x   |  region unrest: mean ${mean(unrestRs).toFixed(2)}  spread ${quantile(unrestRs, 0.05).toFixed(2)}–${quantile(unrestRs, 0.95).toFixed(2)}`);
  L.push(`  CHEAPEST regions (most over-abundant) — note their unrest vs the mean:`);
  for (const r of [...regRows].sort((a, b) => a.priceR - b.priceR).slice(0, 6))
    L.push(`    ${r.name.padEnd(22)} price ${r.priceR.toFixed(2)}x  unrest ${r.unrest.toFixed(2)}  sat ${r.sat.toFixed(2)}  (${r.sys} sys)`);
  L.push(`  PRICIEST regions (tightest supply):`);
  for (const r of [...regRows].sort((a, b) => b.priceR - a.priceR).slice(0, 6))
    L.push(`    ${r.name.padEnd(22)} price ${r.priceR.toFixed(2)}x  unrest ${r.unrest.toFixed(2)}  sat ${r.sat.toFixed(2)}  (${r.sys} sys)`);
  L.push(``);

  // Trade flows
  const flows = await prisma.tradeFlow.findMany({
    select: { tick: true, fromSystemId: true, toSystemId: true, goodId: true, quantity: true, flowType: true },
  });
  const tickMin = Math.min(...flows.map((x) => x.tick));
  const tickMax = Math.max(...flows.map((x) => x.tick));
  L.push(`================ TRADE FLOWS (window ticks ${tickMin}–${tickMax}, ${tickMax - tickMin} ticks) ================`);
  let mktN = 0, mktQ = 0, logN = 0, logQ = 0;
  const inQty = new Map<string, number>();
  const outQty = new Map<string, number>();
  const dirA = new Map<string, { qty: number; types: Set<string> }>();
  const dirB = new Map<string, { qty: number; types: Set<string> }>();
  for (const fl of flows) {
    if (fl.flowType === "logistics") { logN++; logQ += fl.quantity; }
    else { mktN++; mktQ += fl.quantity; }
    outQty.set(`${fl.fromSystemId}|${fl.goodId}|${fl.flowType}`, (outQty.get(`${fl.fromSystemId}|${fl.goodId}|${fl.flowType}`) ?? 0) + fl.quantity);
    inQty.set(`${fl.toSystemId}|${fl.goodId}|${fl.flowType}`, (inQty.get(`${fl.toSystemId}|${fl.goodId}|${fl.flowType}`) ?? 0) + fl.quantity);
    const lo = fl.fromSystemId < fl.toSystemId ? fl.fromSystemId : fl.toSystemId;
    const hi = fl.fromSystemId < fl.toSystemId ? fl.toSystemId : fl.fromSystemId;
    const pk = `${fl.goodId}|${lo}|${hi}`;
    const tgt = fl.fromSystemId === lo ? dirA : dirB;
    const cur = tgt.get(pk) ?? { qty: 0, types: new Set<string>() };
    cur.qty += fl.quantity; cur.types.add(fl.flowType);
    tgt.set(pk, cur);
  }
  L.push(`  total ${flows.length}  | MARKET ${mktN} rows ${f(mktQ, 0)}u (avg ${(mktQ / Math.max(1, mktN)).toFixed(1)})  | LOGISTICS ${logN} rows ${f(logQ, 0)}u (avg ${(logQ / Math.max(1, logN)).toFixed(1)})`);
  const logSizes = flows.filter((x) => x.flowType === "logistics").map((x) => x.quantity);
  const mktSizes = flows.filter((x) => x.flowType !== "logistics").map((x) => x.quantity);
  L.push(`  flow size — logistics: median ${median(logSizes)} p90 ${quantile(logSizes, 0.9)} p99 ${quantile(logSizes, 0.99)} max ${Math.max(0, ...logSizes)}  |  market: median ${median(mktSizes)} p99 ${quantile(mktSizes, 0.99)} max ${Math.max(0, ...mktSizes)}`);

  // Concern 2: single-delivery overshoot vs recipient anchor
  const ratios: number[] = [];
  let overAnchor = 0, ratioN = 0;
  for (const fl of flows) {
    if (fl.flowType !== "logistics") continue;
    const tgt = targetByKey.get(`${fl.toSystemId}|${fl.goodId}`);
    if (!tgt || tgt <= 0) continue;
    ratioN++; ratios.push(fl.quantity / tgt);
    if (fl.quantity >= tgt) overAnchor++;
  }
  L.push(`  [concern 2] single logistics delivery as fraction of recipient anchor: median ${median(ratios).toFixed(2)} p90 ${quantile(ratios, 0.9).toFixed(2)} max ${Math.max(0, ...ratios).toFixed(2)}`);
  L.push(`             deliveries >= recipient's WHOLE anchor in one shot: ${overAnchor}/${ratioN} (${pct(overAnchor, ratioN)})`);

  // Concern 3: same system both source & sink for same good
  const sgIn = new Map<string, number>(), sgOut = new Map<string, number>();
  for (const [k, q] of inQty) { const [s, g] = k.split("|"); sgIn.set(`${s}|${g}`, (sgIn.get(`${s}|${g}`) ?? 0) + q); }
  for (const [k, q] of outQty) { const [s, g] = k.split("|"); sgOut.set(`${s}|${g}`, (sgOut.get(`${s}|${g}`) ?? 0) + q); }
  let bothCount = 0, bothMinVol = 0;
  for (const [k, qin] of sgIn) { const qo = sgOut.get(k); if (qo && qo > 0) { bothCount++; bothMinVol += Math.min(qin, qo); } }
  L.push(`  [concern 3] (system,good) both imported & exported: ${bothCount}  | churned Σmin(in,out) ${f(bothMinVol, 0)}u = ${pct(bothMinVol, mktQ + logQ)} of all volume`);

  // Concern 1: pairwise opposition same good both directions
  let oppPairs = 0, oppVol = 0;
  const oppCombo = new Map<string, number>();
  for (const [pk, a] of dirA) {
    const b = dirB.get(pk);
    if (!b) continue;
    oppPairs++; oppVol += Math.min(a.qty, b.qty);
    const label = [...new Set<string>([...a.types, ...b.types])].sort().join("+");
    oppCombo.set(label, (oppCombo.get(label) ?? 0) + 1);
  }
  L.push(`  [concern 1] good×pair flowing BOTH directions: ${oppPairs}  | opposed Σmin ${f(oppVol, 0)}u  | mix ${[...oppCombo.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ×${v}`).join("  ")}`);

  console.log(L.join("\n"));
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
