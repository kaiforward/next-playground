/**
 * Benchmarks real per-processor tick cost against the live Postgres DB at the
 * active UNIVERSE_SCALE — to decide substrate-v2 P6 cadence: process-all-per-tick
 * ("Option F") vs fixed-interval sharding ("Option C"). The simulator is no use
 * here (in-memory, no DB round-trips). Mirrors the worker's transaction loop
 * (lib/tick/worker.ts): one $transaction per tick, optimistic-lock advance, time
 * each active processor.
 *
 * COMMITS each tick → advances the dev game state by N ticks (reseed to restore
 * a pristine universe). Run with the dev server STOPPED — optimistic-lock
 * contention would abort ticks and skew timing.
 *
 * Run: npx tsx --env-file=.env scripts/bench-tick.ts [ticks]   (default 150)
 */
import { prisma } from "@/lib/prisma";
import { processors, sortProcessors } from "@/lib/tick/registry";
import type { TickContext } from "@/lib/tick/types";
import { getOpenEdges } from "@/lib/services/topology";
import { TRADE_SIMULATION } from "@/lib/constants/trade-simulation";
import { UNIVERSE_GEN, ACTIVE_SCALE } from "@/lib/constants/universe-gen";

const TICKS = Number(process.argv[2] ?? 150);
const WARMUP = 10; // discard cold-cache ticks from steady-state stats
const TICK_RATE_MS = 5000; // production tick budget
const TARGET_INTERVAL = 24; // Option C: every system updated every N ticks (gameplay constant)

function push(map: Map<string, number[]>, key: string, val: number): void {
  const arr = map.get(key);
  if (arr) arr.push(val);
  else map.set(key, [val]);
}
function avg(arr: number[]): number {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}
function pct(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}
const ms = (n: number): string => `${n.toFixed(1)}ms`;

async function main(): Promise<void> {
  // Warm the topology cache + capture extrapolation context BEFORE the loop.
  const openEdges = await getOpenEdges();
  const totalEdges = openEdges.length;
  const edgesPerTick = TRADE_SIMULATION.EDGES_PER_TICK;
  const fullSweepTicks = Math.ceil(totalEdges / edgesPerTick);
  const regionCount = UNIVERSE_GEN.REGION_COUNT;
  const systemCount = await prisma.starSystem.count();
  const marketCount = await prisma.stationMarket.count();

  console.log(
    `\n=== bench-tick — scale="${ACTIVE_SCALE}" — ${systemCount} systems / ${marketCount} markets / ` +
      `${totalEdges} open edges / ${regionCount} regions ===`,
  );
  console.log(
    `Running ${TICKS} ticks (discarding first ${WARMUP} as warmup). ` +
      `Economy region cycle = ${regionCount} ticks; flow/migration full sweep = ${fullSweepTicks} ticks.\n`,
  );

  const perProc = new Map<string, number[]>(); // processor name -> ms samples (steady state)
  const totalAll: number[] = []; // total tick ms (steady, all ticks)
  const totalNonSnapshot: number[] = []; // total tick ms (steady, ticks without price-snapshots)
  const economyByRegion = new Map<string, { ms: number[]; markets: number; name: string }>();

  const world0 = await prisma.gameWorld.findUnique({ where: { id: "world" } });
  let currentTick = world0?.currentTick ?? 0;

  for (let i = 0; i < TICKS; i++) {
    const previousTick = currentTick;
    const tick = currentTick + 1;
    const active = sortProcessors(processors, tick);
    const t0 = performance.now();

    const timings = await prisma.$transaction(
      async (tx) => {
        const updated = await tx.gameWorld.updateMany({
          where: { id: "world", currentTick: previousTick },
          data: { currentTick: tick, lastTickAt: new Date() },
        });
        if (updated.count === 0) {
          throw new Error(
            "optimistic lock failed — is the dev server running? Stop it and retry.",
          );
        }
        const ctx: TickContext = { tx, tick, results: new Map() };
        const out: Array<{ name: string; ms: number; markets: number; region: string; regionName: string }> = [];
        for (const p of active) {
          const s = performance.now();
          const result = await p.process(ctx);
          ctx.results.set(p.name, result);
          const ev = result.globalEvents?.economyTick?.[0];
          out.push({
            name: p.name,
            ms: performance.now() - s,
            markets: ev?.marketCount ?? 0,
            region: ev?.regionId ?? "",
            regionName: ev?.regionName ?? "",
          });
        }
        return out;
      },
      { timeout: 30_000 },
    );

    const tickMs = performance.now() - t0;
    currentTick = tick;
    const steady = i >= WARMUP;
    const ranSnapshot = active.some((p) => p.name === "price-snapshots");

    if (steady) {
      totalAll.push(tickMs);
      if (!ranSnapshot) totalNonSnapshot.push(tickMs);
      for (const t of timings) {
        push(perProc, t.name, t.ms);
        if (t.name === "economy" && t.region) {
          const e = economyByRegion.get(t.region) ?? { ms: [], markets: t.markets, name: t.regionName };
          e.ms.push(t.ms);
          e.markets = t.markets;
          economyByRegion.set(t.region, e);
        }
      }
    }
    if (i % 20 === 0 || i === TICKS - 1) {
      console.log(`  tick ${tick} (${tickMs.toFixed(0)}ms)${ranSnapshot ? " [snapshot]" : ""}`);
    }
  }

  // ── Per-processor steady-state table ─────────────────────────────
  console.log("\n--- per-processor (steady state) ---");
  console.log("processor".padEnd(18) + "n".padStart(5) + "avg".padStart(9) + "p50".padStart(9) + "p95".padStart(9) + "max".padStart(9));
  for (const name of [...perProc.keys()].sort((a, b) => avg(perProc.get(b)!) - avg(perProc.get(a)!))) {
    const s = perProc.get(name)!;
    console.log(
      name.padEnd(18) +
        String(s.length).padStart(5) +
        ms(avg(s)).padStart(9) + ms(pct(s, 50)).padStart(9) + ms(pct(s, 95)).padStart(9) + ms(Math.max(...s)).padStart(9),
    );
  }

  // ── Totals ───────────────────────────────────────────────────────
  console.log("\n--- total tick ---");
  console.log(`  all ticks:            avg ${ms(avg(totalAll))}  p95 ${ms(pct(totalAll, 95))}  max ${ms(Math.max(...totalAll))}`);
  console.log(`  non-snapshot ticks:   avg ${ms(avg(totalNonSnapshot))}  p95 ${ms(pct(totalNonSnapshot, 95))}`);

  // ── Economy extrapolation ────────────────────────────────────────
  const regionAvgs = [...economyByRegion.values()].map((e) => avg(e.ms));
  const econSliceAvg = avg(perProc.get("economy") ?? []); // current per-tick (one region)
  const econF = regionAvgs.reduce((a, b) => a + b, 0); // all regions once = all systems
  const econC = econF / TARGET_INTERVAL;
  console.log(`\n--- economy (${economyByRegion.size}/${regionCount} regions sampled) ---`);
  console.log(`  region ms: avg ${ms(econSliceAvg)}  min ${ms(Math.min(...regionAvgs))}  max ${ms(Math.max(...regionAvgs))}`);
  console.log(`  current/tick (1 region):        ${ms(econSliceAvg)}`);
  console.log(`  Option F /tick (ALL systems):   ${ms(econF)}`);
  console.log(`  Option C /tick (interval ${TARGET_INTERVAL}):   ${ms(econC)}   (= ${(econC / Math.max(econSliceAvg, 0.01)).toFixed(1)}× current)`);

  // ── Flow + migration extrapolation ───────────────────────────────
  for (const name of ["tradeFlow", "migration"]) {
    const sliceAvg = avg(perProc.get(name) ?? []);
    const f = sliceAvg * fullSweepTicks;
    const c = sliceAvg * (totalEdges / TARGET_INTERVAL) / edgesPerTick;
    console.log(`\n--- ${name} (256-edge slice) ---`);
    console.log(`  current/tick (1 slice):         ${ms(sliceAvg)}`);
    console.log(`  Option F /tick (ALL edges):     ${ms(f)}`);
    console.log(`  Option C /tick (interval ${TARGET_INTERVAL}):   ${ms(c)}`);
  }

  // ── Verdict ──────────────────────────────────────────────────────
  const base = avg(totalNonSnapshot);
  const flowSlice = avg(perProc.get("tradeFlow") ?? []);
  const migSlice = avg(perProc.get("migration") ?? []);
  const dF =
    (econF - econSliceAvg) +
    (flowSlice * fullSweepTicks - flowSlice) +
    (migSlice * fullSweepTicks - migSlice);
  const dC =
    (econC - econSliceAvg) +
    (flowSlice * (totalEdges / TARGET_INTERVAL) / edgesPerTick - flowSlice) +
    (migSlice * (totalEdges / TARGET_INTERVAL) / edgesPerTick - migSlice);
  const snapAvg = avg(perProc.get("price-snapshots") ?? []);
  console.log("\n=== VERDICT ===");
  console.log(`  baseline non-snapshot tick:     ${ms(base)}`);
  console.log(`  est. Option F tick (all/tick):  ${ms(base + dF)}   ${base + dF < TICK_RATE_MS ? "✅ under" : "❌ OVER"} ${TICK_RATE_MS}ms budget`);
  console.log(`  est. Option C tick (interval ${TARGET_INTERVAL}): ${ms(base + dC)}   ${base + dC < TICK_RATE_MS ? "✅ under" : "❌ OVER"} ${TICK_RATE_MS}ms budget`);
  console.log(`  price-snapshots burst (all-systems write, every 20): ${ms(snapAvg)}  ← Option F write-feasibility signal`);
  console.log("");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
