/**
 * Benchmarks real per-processor tick cost against the live Postgres DB at the
 * active UNIVERSE_SCALE. Mirrors the worker's transaction loop (lib/tick/worker.ts):
 * one $transaction per tick, optimistic-lock advance, time each active processor.
 *
 * Reports avg/p50/p95/max per processor and for total-tick, then a verdict
 * against the 5000ms budget (avg and p95 must be under).
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
import { UNIVERSE_GEN, ACTIVE_SCALE } from "@/lib/constants/universe-gen";
import { ECONOMY_UPDATE_INTERVAL } from "@/lib/constants/tick-cadence";

const TICKS = Number(process.argv[2] ?? 150);
const WARMUP = 10; // discard cold-cache ticks from steady-state stats
const TICK_RATE_MS = 5000; // production tick budget

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
  // Warm the topology cache BEFORE the loop.
  const openEdges = await getOpenEdges();
  const totalEdges = openEdges.length;
  const regionCount = UNIVERSE_GEN.REGION_COUNT;
  const systemCount = await prisma.starSystem.count();
  const marketCount = await prisma.stationMarket.count();

  console.log(
    `\n=== bench-tick — scale="${ACTIVE_SCALE}" — ${systemCount} systems / ${marketCount} markets / ` +
      `${totalEdges} open edges / ${regionCount} regions ===`,
  );
  console.log(
    `Running ${TICKS} ticks (discarding first ${WARMUP} as warmup). ` +
      `Economy/flow/migration shard interval = ${ECONOMY_UPDATE_INTERVAL} ticks.\n`,
  );

  const perProc = new Map<string, number[]>(); // processor name -> ms samples (steady state)
  const totalAll: number[] = []; // total tick ms (steady, all ticks)
  const economySystems: number[] = []; // systems processed per economy shard (steady)

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
        const out: Array<{ name: string; ms: number; systems: number }> = [];
        for (const p of active) {
          const s = performance.now();
          const result = await p.process(ctx);
          ctx.results.set(p.name, result);
          const ev = result.globalEvents?.economyTick?.[0];
          out.push({
            name: p.name,
            ms: performance.now() - s,
            systems: ev?.systemCount ?? 0,
          });
        }
        return out;
      },
      { timeout: 30_000 },
    );

    const tickMs = performance.now() - t0;
    currentTick = tick;
    const steady = i >= WARMUP;

    if (steady) {
      totalAll.push(tickMs);
      for (const t of timings) {
        push(perProc, t.name, t.ms);
        if (t.name === "economy") economySystems.push(t.systems);
      }
    }
    if (i % 20 === 0 || i === TICKS - 1) {
      console.log(`  tick ${tick} (${tickMs.toFixed(0)}ms)`);
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

  // ── Economy: fixed-interval system shard ─────────────────────────
  const econAvg = avg(perProc.get("economy") ?? []);
  const econSystemsAvg = avg(economySystems);
  console.log(`\n--- economy (fixed-interval system shard) ---`);
  console.log(
    `  measured/tick:        avg ${ms(econAvg)}  p95 ${ms(pct(perProc.get("economy") ?? [], 95))}` +
      `  (${econSystemsAvg.toFixed(0)} systems/shard, full refresh every ${ECONOMY_UPDATE_INTERVAL} ticks)`,
  );

  // ── Total-tick summary ────────────────────────────────────────────
  console.log("\n--- total tick (all ticks) ---");
  console.log(`  avg ${ms(avg(totalAll))}  p95 ${ms(pct(totalAll, 95))}  max ${ms(Math.max(...totalAll))}`);

  // ── Verdict ───────────────────────────────────────────────────────
  const totalAvg = avg(totalAll);
  const totalP95 = pct(totalAll, 95);
  console.log("\n=== VERDICT ===");
  console.log(`  avg ${ms(totalAvg)}  ${totalAvg < TICK_RATE_MS ? "✅ under" : "❌ OVER"} ${TICK_RATE_MS}ms budget`);
  console.log(`  p95 ${ms(totalP95)}  ${totalP95 < TICK_RATE_MS ? "✅ under" : "❌ OVER"} ${TICK_RATE_MS}ms budget`);
  console.log("");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
