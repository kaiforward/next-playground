/**
 * Labour / staffing diagnostic. Answers "why is production declining for lack of
 * labour" by separating two causes that both drive labourFulfillment < 1:
 *   - STRUCTURAL: popCap was seeded below labour demand (housing clamped by the
 *     habitable subset of space), so even at full population the base can't staff.
 *   - DYNAMIC: popCap is adequate but population has declined below it.
 *
 * Part A: deep dive on one system (default Zenith-33-93's id, override with argv[2]).
 * Part B: galaxy-wide histogram of the staffing ceiling (popCap / labourDemand) and
 *         population fill (population / popCap), plus the habitable-land bind check.
 *
 * Run: npx tsx --env-file=.env scripts/diagnose-labour.ts [systemId]
 */
import { prisma } from "@/lib/prisma";
import {
  labourDemand,
  labourFulfillment,
  generalSpaceUsed,
  buildIndustryReadout,
  capacityGoodRates,
  summariseSpace,
} from "@/lib/engine/industry";
import { strikeMultiplier } from "@/lib/engine/population";
import { marketBandForRow } from "@/lib/engine/market-pricing";
import { resourceVectorFromColumns } from "@/lib/engine/resources";
import { GOOD_NAME_TO_KEY } from "@/lib/constants/goods";
import {
  HOUSING_TYPE,
  POP_CENTRE_DENSITY,
  DEFAULT_LABOUR_PER_UNIT,
} from "@/lib/constants/industry";
import { STRIKE_PARAMS } from "@/lib/constants/population";
import { INFRASTRUCTURE_DECAY_PARAMS } from "@/lib/constants/infrastructure";

const DEFAULT_SYSTEM_ID = "cmqpe4yf605vgackj6k7ysnvt"; // Zenith-33-93

const f1 = (n: number) => n.toFixed(1);
const f2 = (n: number) => n.toFixed(2);
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

async function deepDive(systemId: string) {
  const system = await prisma.starSystem.findUnique({
    where: { id: systemId },
    include: {
      buildings: true,
      faction: { select: { name: true } },
      station: { include: { markets: { include: { good: true } } } },
    },
  });
  if (!system) {
    console.log(`System ${systemId} not found.`);
    return;
  }

  const buildings: Record<string, number> = {};
  for (const b of system.buildings) buildings[b.buildingType] = b.count;

  const demand = labourDemand(buildings);
  const fulfillment = labourFulfillment(system.population, demand);
  const ceiling = labourFulfillment(system.popCap, demand); // max fulfilment at full popCap
  const housingCount = buildings[HOUSING_TYPE] ?? 0;
  const nonHousingGeneralUsed = generalSpaceUsed(buildings); // factories + pop-centres
  const factoryGeneralUsed = nonHousingGeneralUsed - housingCount; // pop-centre cost is 1/unit
  const wantedHousing = demand / POP_CENTRE_DENSITY; // housing the seeder wanted to fully staff
  const strikeMult = strikeMultiplier(system.unrest, STRIKE_PARAMS);

  console.log("═".repeat(72));
  console.log(`  ${system.name}   [${system.economyType}]   faction=${system.faction?.name ?? "—"}`);
  console.log(`  ${systemId}`);
  console.log("═".repeat(72));

  console.log("\n── POPULATION ──");
  console.log(`  population        ${f1(system.population)}`);
  console.log(`  popCap            ${f1(system.popCap)}`);
  console.log(`  fill (pop/popCap) ${system.popCap > 0 ? pct(system.population / system.popCap) : "n/a"}`);
  console.log(`  unrest            ${f2(system.unrest)}  (strike threshold ${STRIKE_PARAMS.threshold}, decay teardown θ ${INFRASTRUCTURE_DECAY_PARAMS.unrestThreshold})`);
  console.log(`  strikeMultiplier  ${f2(strikeMult)}  ${strikeMult < 1 ? "← production suppressed by unrest" : ""}`);

  console.log("\n── LABOUR ──");
  console.log(`  labourDemand      ${f1(demand)}   (Σ production-building count × ${DEFAULT_LABOUR_PER_UNIT})`);
  console.log(`  labourFulfillment ${f2(fulfillment)}   (population ${f1(system.population)} / demand ${f1(demand)})`);
  console.log(`  staffing CEILING  ${f2(ceiling)}   (popCap ${f1(system.popCap)} / demand ${f1(demand)})  ← max achievable if pop filled popCap`);
  if (ceiling < 0.98) {
    console.log(`  ►► STRUCTURAL: popCap is below labour demand — this system can NEVER fully staff,`);
    console.log(`     even at 100% population fill. Housing was seeded/decayed below 1.25× production.`);
  } else if (fulfillment < 0.9) {
    console.log(`  ►► DYNAMIC: popCap is adequate (ceiling≈1) but population sits below it — decline/migration drain.`);
  } else {
    console.log(`  ►► Labour is adequately staffed.`);
  }

  console.log("\n── SPACE (decay-invariant substrate) ──");
  const space = summariseSpace(system.availableSpace, system.generalSpace, system.habitableSpace, buildings);
  console.log(`  availableSpace    ${f1(space.available)}`);
  console.log(`  deposit space     ${f1(space.deposit)}   worked ${f1(space.depositWorked)}`);
  console.log(`  generalSpace      ${f1(space.general)}   used ${f1(space.generalUsed)} (factories ${f1(factoryGeneralUsed)} + housing ${f1(housingCount)})`);
  console.log(`  habitableSpace    ${f1(space.habitable)}   used ${f1(space.habitableUsed)}  ← hard ceiling on housing`);
  console.log("\n  Housing-bind diagnosis:");
  console.log(`    housing to fully staff current industry (demand/${POP_CENTRE_DENSITY})  = ${f1(wantedHousing)}`);
  console.log(`    habitable land available for housing                       = ${f1(system.habitableSpace)}`);
  console.log(`    current housing built                                      = ${f1(housingCount)}`);
  if (system.habitableSpace < wantedHousing - 1e-6) {
    console.log(`    ►► HABITABLE-LAND BOUND: only ${f1(system.habitableSpace)} habitable land exists but ${f1(wantedHousing)} housing`);
    console.log(`       is needed to staff the industry. Max staffing ceiling from land alone =`);
    console.log(`       ${pct(Math.min(1, (system.habitableSpace * POP_CENTRE_DENSITY) / demand))}. The workers physically cannot be housed.`);
  }

  console.log("\n── BUILDINGS (count vs in-use; idle drives SP3.5 disuse decay) ──");
  // Reuse the read-service band math so 'used' splits labour-idle from selling-idle.
  const marketStock: Record<string, number> = {};
  const minStockByGood: Record<string, number> = {};
  const maxStockByGood: Record<string, number> = {};
  if (system.station) {
    for (const row of system.station.markets) {
      const goodKey = GOOD_NAME_TO_KEY.get(row.good.name) ?? row.good.name;
      const band = marketBandForRow(row, row.good);
      marketStock[goodKey] = row.stock;
      minStockByGood[goodKey] = band.minStock;
      maxStockByGood[goodKey] = band.maxStock;
    }
  }
  const yields = resourceVectorFromColumns(
    {
      yieldGas: system.yieldGas, yieldMinerals: system.yieldMinerals, yieldOre: system.yieldOre,
      yieldBiomass: system.yieldBiomass, yieldArable: system.yieldArable,
      yieldWater: system.yieldWater, yieldRadioactive: system.yieldRadioactive,
    },
    "yield",
  );
  const readout = buildIndustryReadout(
    buildings,
    system.population,
    marketStock,
    (g) => minStockByGood[g] ?? 0,
    yields,
    (g) => maxStockByGood[g],
  );
  console.log(`  ${"building".padEnd(16)}${"count".padStart(9)}${"used".padStart(9)}${"idle%".padStart(8)}   reason`);
  for (const b of readout.buildings) {
    const idle = b.count > 0 ? 1 - b.used / b.count : 0;
    console.log(
      `  ${b.buildingType.padEnd(16)}${f1(b.count).padStart(9)}${f1(b.used).padStart(9)}${pct(idle).padStart(8)}   ${b.idleReason ?? ""}`,
    );
  }

  // Tally idle attributable to labour vs selling across producers.
  let labourIdle = 0, sellingIdle = 0, total = 0;
  for (const b of readout.buildings) {
    if (b.buildingType === HOUSING_TYPE) continue;
    total += b.count;
    if (b.idleReason === "labour") labourIdle += b.count - b.used;
    else if (b.idleReason === "selling") sellingIdle += b.count - b.used;
  }
  console.log(`\n  Idle attribution across producers: labour-bound ${f1(labourIdle)}, selling-bound ${f1(sellingIdle)} (of ${f1(total)} built)`);

  console.log("\n── SUPPLY CHAIN (input-gate < 1 = throttled by a short input) ──");
  const throttled = readout.supplyChain.filter((s) => s.inputGate < 0.999);
  if (throttled.length === 0) console.log("  (no tier-1+ good is input-throttled)");
  for (const s of throttled.slice(0, 8)) {
    console.log(`  ${s.goodId.padEnd(16)} gate ${f2(s.inputGate)}   short: ${s.throttledBy.join(", ")}`);
  }

  console.log("\n── LOCAL GOOD BALANCE (production vs consumption, pre-trade) ──");
  const goods = capacityGoodRates(buildings, system.population, yields);
  const deficits = goods
    .map((g) => ({ ...g, net: g.production - g.consumption }))
    .filter((g) => g.production > 0 || g.consumption > 0)
    .sort((a, b) => a.net - b.net);
  console.log(`  ${"good".padEnd(16)}${"prod".padStart(9)}${"cons".padStart(9)}${"net".padStart(9)}`);
  for (const g of deficits.slice(0, 10)) {
    console.log(`  ${g.goodId.padEnd(16)}${f2(g.production).padStart(9)}${f2(g.consumption).padStart(9)}${f2(g.net).padStart(9)}`);
  }
}

async function galaxyAggregate() {
  const systems = await prisma.starSystem.findMany({
    select: {
      id: true, population: true, popCap: true, unrest: true,
      habitableSpace: true, generalSpace: true,
      buildings: { select: { buildingType: true, count: true } },
    },
  });

  // Only systems that have an industrial base demanding labour.
  type Row = { ceiling: number; fill: number; fulfill: number; unrest: number; habitableBound: boolean };
  const rows: Row[] = [];
  let noDemand = 0;
  for (const s of systems) {
    const buildings: Record<string, number> = {};
    for (const b of s.buildings) buildings[b.buildingType] = b.count;
    const demand = labourDemand(buildings);
    if (demand <= 0) { noDemand++; continue; }
    const ceiling = labourFulfillment(s.popCap, demand);
    const fulfill = labourFulfillment(s.population, demand);
    const fill = s.popCap > 0 ? s.population / s.popCap : 0;
    const wantedHousing = demand / POP_CENTRE_DENSITY;
    rows.push({
      ceiling,
      fill,
      fulfill,
      unrest: s.unrest,
      habitableBound: s.habitableSpace < wantedHousing - 1e-6,
    });
  }

  const n = rows.length;
  const histo = (label: string, pred: (r: Row) => boolean) =>
    console.log(`  ${label.padEnd(46)} ${String(rows.filter(pred).length).padStart(5)}  (${pct(rows.filter(pred).length / n)})`);

  console.log("\n" + "═".repeat(72));
  console.log(`  GALAXY AGGREGATE — ${systems.length} systems (${n} with a labour-demanding base, ${noDemand} without)`);
  console.log("═".repeat(72));

  console.log("\n  Staffing CEILING (popCap / labourDemand) — max fulfilment at full pop:");
  histo("ceiling < 0.50  (severe structural under-housing)", (r) => r.ceiling < 0.5);
  histo("ceiling 0.50–0.80", (r) => r.ceiling >= 0.5 && r.ceiling < 0.8);
  histo("ceiling 0.80–0.98", (r) => r.ceiling >= 0.8 && r.ceiling < 0.98);
  histo("ceiling ≥ 0.98  (can fully staff)", (r) => r.ceiling >= 0.98);

  console.log("\n  Actual labourFulfillment (population / labourDemand):");
  histo("fulfillment < 0.50", (r) => r.fulfill < 0.5);
  histo("fulfillment 0.50–0.80", (r) => r.fulfill >= 0.5 && r.fulfill < 0.8);
  histo("fulfillment 0.80–0.98", (r) => r.fulfill >= 0.8 && r.fulfill < 0.98);
  histo("fulfillment ≥ 0.98", (r) => r.fulfill >= 0.98);

  console.log("\n  Cause split (among systems with fulfillment < 0.98):");
  const under = rows.filter((r) => r.fulfill < 0.98);
  const structural = under.filter((r) => r.ceiling < 0.98).length;
  const dynamicDrain = under.filter((r) => r.ceiling >= 0.98).length;
  console.log(`    STRUCTURAL (ceiling < 0.98, can't staff even when full)  ${String(structural).padStart(5)}  (${pct(under.length ? structural / under.length : 0)})`);
  console.log(`    DYNAMIC    (ceiling ok, population declined below popCap) ${String(dynamicDrain).padStart(5)}  (${pct(under.length ? dynamicDrain / under.length : 0)})`);

  console.log("\n  Habitable-land bind (habitableSpace < housing needed to staff industry):");
  histo("habitable-land bound", (r) => r.habitableBound);

  const meanCeiling = rows.reduce((s, r) => s + r.ceiling, 0) / n;
  const meanFill = rows.reduce((s, r) => s + r.fill, 0) / n;
  const meanUnrest = rows.reduce((s, r) => s + r.unrest, 0) / n;
  const striking = rows.filter((r) => r.unrest >= STRIKE_PARAMS.threshold).length;
  console.log("\n  Means:");
  console.log(`    mean staffing ceiling  ${f2(meanCeiling)}`);
  console.log(`    mean population fill    ${f2(meanFill)}`);
  console.log(`    mean unrest             ${f2(meanUnrest)}   (${striking} systems striking, unrest ≥ ${STRIKE_PARAMS.threshold})`);
}

async function main() {
  const systemId = process.argv[2] ?? DEFAULT_SYSTEM_ID;
  await deepDive(systemId);
  await galaxyAggregate();
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
