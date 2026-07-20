import { describe, it, expect, vi, afterEach } from "vitest";

/**
 * Dynamic ECONOMY_SCALE invariance — the whole tick, not just static constants.
 *
 * ⚠ One of the two LOAD-BEARING invariance-bridge tests (with the static
 * lib/engine/__tests__/economy-scale-invariance.test.ts). Together they are the proof that makes the
 * whole suite's S=1 pin (vitest.config.ts `env.ECONOMY_SCALE`) valid for the S=100 game: weaken or
 * delete either and every magnitude assertion in the suite silently becomes meaningless. See
 * vitest.config.ts for the full note.
 *
 * ECONOMY_SCALE (S) scales the goods side of the economy (production, consumption,
 * stock, storage) but NOT population, which is a headcount. Running the same seed
 * for the same ticks at S=1 vs S=100 must therefore produce scale-normalised-
 * identical dynamics: every (system, good) stock at S=100 must equal 100× its S=1
 * value, to floating-point precision, at every tick.
 *
 * The invariant breaks the instant any goods-magnitude term is quantised
 * (`Math.round`/`floor` on a goods amount) or left as an unscaled absolute — those
 * are a rounding error at S=100 but a large fraction at S=1, so they diverge only
 * at low scale and compound through every monthly pulse. This broad end-to-end guard
 * reliably exercises the seed-stock de-rounding (from tick 0) and the government
 * consumption scaling (it runs past the first monthly economy pulse, where that term
 * first bites). The logistics-transfer term is guarded directly by a focused unit test
 * (`lib/tick/processors/__tests__/directed-logistics.test.ts`) instead, because directed
 * transfers don't reliably fire within this short window for an arbitrary seed.
 *
 * ECONOMY_SCALE is resolved once at module import, so each scale runs against a
 * freshly-imported constants + tick graph (resetModules + stubEnv), mirroring the
 * static economy-scale-invariance test.
 *
 * Treasury balances ride the same bridge: money is fuel, not goods, so it is S-invariant
 * BY DESIGN rather than scale-normalised — a faction's balance at S=1 and S=100 must be
 * EQUAL (not one 100× the other) at every tick, since the treasury's income taxes are
 * computed off S-normalised heads/production values before they ever touch the goods side.
 */
async function runAtScale(
  scale: string,
  seed: number,
  systemCount: number,
  ticks: number,
): Promise<{ stocks: Array<Record<string, number>>; treasuries: Array<Record<string, number>> }> {
  vi.resetModules();
  vi.stubEnv("ECONOMY_SCALE", scale);
  const { generateWorld } = await import("@/lib/world/gen");
  const { runWorldTick } = await import("@/lib/world/tick");

  let world = generateWorld({ systemCount, seed });
  const perTickStock: Array<Record<string, number>> = [];
  const perTickTreasury: Array<Record<string, number>> = [];
  for (let t = 0; t < ticks; t++) {
    const result = await runWorldTick(world);
    world = result.world;
    const snap: Record<string, number> = {};
    for (const m of result.markets) snap[`${m.systemId}|${m.goodId}`] = m.stock;
    perTickStock.push(snap);
    const tSnap: Record<string, number> = {};
    for (const treasury of world.treasuries) tSnap[treasury.factionId] = treasury.balance;
    perTickTreasury.push(tSnap);
  }
  return { stocks: perTickStock, treasuries: perTickTreasury };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("ECONOMY_SCALE dynamic invariance", () => {
  it("per-(system,good) stock is scale-normalised-identical across the first monthly pulse", async () => {
    const SEED = 745878428; // colonies + a monthly pulse in-window (logistics is covered by a focused test)
    const SYSTEM_COUNT = 60;
    const TICKS = 30; // past the first economy pulse (tick 24), where the gov-consumption term bites
    const TOL = 1e-6; // pure FP is ~1e-15 here; a quantised/absolute term diverges ~1e-3+

    const s1 = await runAtScale("1", SEED, SYSTEM_COUNT, TICKS);
    const s100 = await runAtScale("100", SEED, SYSTEM_COUNT, TICKS);

    for (let t = 0; t < TICKS; t++) {
      let worstRel = 0;
      let worstKey = "";
      let worstA = 0;
      let worstB = 0;
      for (const key of Object.keys(s1.stocks[t])) {
        const a = s1.stocks[t][key]; // S=1
        const b = s100.stocks[t][key] / 100; // S=100, scale-normalised
        const rel = Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1e-9);
        if (rel > worstRel) {
          worstRel = rel;
          worstKey = key;
          worstA = a;
          worstB = b;
        }
      }
      expect(
        worstRel,
        `tick ${t}: ${worstKey} diverges — S=1 ${worstA} vs S=100/100 ${worstB} (rel ${worstRel.toExponential(2)})`,
      ).toBeLessThan(TOL);
    }

    // Money never rides S: balances must be EQUAL (not scale-normalised) at every tick.
    for (let t = 0; t < TICKS; t++) {
      for (const key of Object.keys(s1.treasuries[t])) {
        const a = s1.treasuries[t][key];
        const b = s100.treasuries[t][key];
        const rel = Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1e-9);
        expect(rel, `tick ${t}: treasury ${key} diverges — S=1 ${a} vs S=100 ${b}`).toBeLessThan(TOL);
      }
    }
  });
});
