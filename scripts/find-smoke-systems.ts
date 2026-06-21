/**
 * Surfaces representative systems for manual in-browser smoke-testing of the
 * substrate model: truly-undeveloped (no buildings, deposits present), tiny
 * fractional-pop outposts, and developed worlds for contrast — plus a population
 * histogram and a gate-leak check (buildings present but pop 0). Prints each
 * system's name and its /system/<id> link.
 * Run: npx tsx --env-file=.env scripts/find-smoke-systems.ts
 * Stopgap until the filterable system-finder dev tool (see docs/BACKLOG.md).
 */
import { prisma } from "@/lib/prisma";

function depositSummary(s: {
  slotOre: number; slotGas: number; slotMinerals: number; slotBiomass: number;
  slotArable: number; slotWater: number; slotRadioactive: number;
}): string {
  const parts: string[] = [];
  const push = (label: string, v: number) => { if (v > 0.05) parts.push(`${label} ${v.toFixed(1)}`); };
  push("ore", s.slotOre); push("gas", s.slotGas); push("min", s.slotMinerals);
  push("bio", s.slotBiomass); push("arable", s.slotArable); push("water", s.slotWater);
  push("rad", s.slotRadioactive);
  return parts.length ? parts.join(", ") : "(none)";
}

async function main() {
  const systems = await prisma.starSystem.findMany({
    select: {
      id: true, name: true, x: true, y: true, economyType: true,
      population: true, popCap: true, habitableSpace: true, availableSpace: true,
      slotOre: true, slotGas: true, slotMinerals: true, slotBiomass: true,
      slotArable: true, slotWater: true, slotRadioactive: true,
      _count: { select: { buildings: true } },
    },
  });

  const totalSlots = (s: typeof systems[number]) =>
    s.slotOre + s.slotGas + s.slotMinerals + s.slotBiomass + s.slotArable + s.slotWater + s.slotRadioactive;

  // 1. Truly undeveloped: no buildings, popCap ~0, but real deposits present.
  const undeveloped = systems
    .filter((s) => s._count.buildings === 0 && s.popCap < 0.001 && totalSlots(s) > 1)
    .sort((a, b) => totalSlots(b) - totalSlots(a));

  // 2. Tiny outpost: fractional living population (0 < pop < 1), has buildings.
  const tinyOutpost = systems
    .filter((s) => s.population > 0 && s.population < 1 && s._count.buildings > 0)
    .sort((a, b) => totalSlots(b) - totalSlots(a));

  // 3. Healthy contrast: solid population + developed.
  const healthy = systems
    .filter((s) => s.population > 50 && s._count.buildings > 5)
    .sort((a, b) => b.population - a.population);

  const counts = {
    total: systems.length,
    undeveloped: undeveloped.length,
    tinyOutpost: tinyOutpost.length,
    deadOrDormantLE1: systems.filter((s) => s.population <= 1).length,
  };

  const histo = {
    "pop == 0": systems.filter((s) => s.population === 0).length,
    "0 < pop < 1": systems.filter((s) => s.population > 0 && s.population < 1).length,
    "1 <= pop < 10": systems.filter((s) => s.population >= 1 && s.population < 10).length,
    "10 <= pop < 100": systems.filter((s) => s.population >= 10 && s.population < 100).length,
    "pop >= 100": systems.filter((s) => s.population >= 100).length,
    "buildings==0 total": systems.filter((s) => s._count.buildings === 0).length,
    "buildings>0 & pop==0 (gate leak)": systems.filter((s) => s._count.buildings > 0 && s.population === 0).length,
  };
  console.log("=== POP HISTOGRAM ===");
  console.log(JSON.stringify(histo, null, 2), "\n");

  const fmt = (s: typeof systems[number]) =>
    `  ${s.name.padEnd(22)} [${s.economyType.padEnd(11)}] (${s.x.toFixed(0)},${s.y.toFixed(0)})  ` +
    `pop=${s.population.toFixed(3)} popCap=${s.popCap.toFixed(1)} habSpace=${s.habitableSpace.toFixed(1)} ` +
    `bldgs=${s._count.buildings}\n` +
    `      deposits: ${depositSummary(s)}\n` +
    `      /system/${s.id}`;

  console.log("=== POPULATION DISTRIBUTION ===");
  console.log(JSON.stringify(counts, null, 2));
  console.log(`  undeveloped = ${(counts.undeveloped / counts.total * 100).toFixed(1)}% of universe`);
  console.log(`  tiny outposts = ${(counts.tinyOutpost / counts.total * 100).toFixed(1)}% of universe\n`);

  console.log("=== 1. TRULY UNDEVELOPED (no buildings, deposits present) ===");
  undeveloped.slice(0, 5).forEach((s) => console.log(fmt(s)));

  console.log("\n=== 2. TINY OUTPOST (0 < pop < 1, fractional) ===");
  tinyOutpost.slice(0, 5).forEach((s) => console.log(fmt(s)));

  console.log("\n=== 3. HEALTHY (contrast) ===");
  healthy.slice(0, 3).forEach((s) => console.log(fmt(s)));

  await prisma.$disconnect();
}

main();
