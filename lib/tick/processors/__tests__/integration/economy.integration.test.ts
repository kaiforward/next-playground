import { describe, it, expect, beforeEach } from "vitest";
import { useIntegrationDb } from "@/lib/test-utils/integration";
import { seedTestUniverse } from "@/lib/test-utils/fixtures";
import type { TestUniverse } from "@/lib/test-utils/fixtures";
import { runEconomyProcessor } from "@/lib/tick/processors/economy";
import { PrismaEconomyWorld } from "@/lib/tick/adapters/prisma/economy";
import {
  ECONOMY_CONSTANTS,
  EQUILIBRIUM_TARGETS,
  PROSPERITY_DECAY_RATE,
  PROSPERITY_MAX_GAIN,
  PROSPERITY_TARGET_VOLUME,
  PROSPERITY_MIN,
  PROSPERITY_MAX,
  PROSPERITY_MULT_AT_MIN,
  PROSPERITY_MULT_AT_ZERO,
  PROSPERITY_MULT_AT_MAX,
} from "@/lib/constants/economy";
import { MODIFIER_CAPS } from "@/lib/constants/events";
import { mulberry32 } from "@/lib/engine/universe-gen";
import type { EconomySimParams, ProsperityParams } from "@/lib/engine/tick";
import type { TickContext, TickProcessorResult } from "@/lib/tick/types";

const { prisma } = useIntegrationDb();

const simParams: EconomySimParams = {
  reversionRate: ECONOMY_CONSTANTS.REVERSION_RATE,
  noiseAmplitude: ECONOMY_CONSTANTS.NOISE_AMPLITUDE,
  noiseReferenceLevel: ECONOMY_CONSTANTS.NOISE_REFERENCE_LEVEL,
  minLevel: ECONOMY_CONSTANTS.MIN_LEVEL,
  maxLevel: ECONOMY_CONSTANTS.MAX_LEVEL,
  equilibrium: EQUILIBRIUM_TARGETS,
};

const prosperityParams: ProsperityParams = {
  decayRate: PROSPERITY_DECAY_RATE,
  maxGain: PROSPERITY_MAX_GAIN,
  targetVolume: PROSPERITY_TARGET_VOLUME,
  min: PROSPERITY_MIN,
  max: PROSPERITY_MAX,
  multAtMin: PROSPERITY_MULT_AT_MIN,
  multAtZero: PROSPERITY_MULT_AT_ZERO,
  multAtMax: PROSPERITY_MULT_AT_MAX,
};

describe("economyProcessor (integration)", () => {
  let universe: TestUniverse;

  beforeEach(async () => {
    universe = await seedTestUniverse(prisma);
  });

  /**
   * Run the processor body directly with a seeded RNG. Per-tick noise (±3-5
   * units) is larger than per-tick reversion (~1-3 units), so behavioral
   * assertions against `Math.random` were flaky. A fixed seed pins the
   * outcome — assertions still check direction-of-travel, not exact values.
   */
  async function runProcessor(
    tick: number,
    seed = 42,
  ): Promise<TickProcessorResult> {
    return prisma.$transaction(
      async (tx) => {
        const ctx: TickContext = { tx, tick, results: new Map() };
        const world = new PrismaEconomyWorld(tx);
        return runEconomyProcessor(world, ctx, {
          rng: mulberry32(seed),
          simParams,
          prosperityParams,
          modifierCaps: MODIFIER_CAPS,
        });
      },
      { timeout: 15_000 },
    );
  }

  it("markets with extreme supply/demand drift toward equilibrium", async () => {
    // Agricultural produces food (target supply ~160, demand ~136). Start
    // both supply and demand far from target. With a seeded RNG (default
    // seed 42) the per-tick reversion pull beats noise and both values
    // move toward equilibrium.
    const foodGoodId = universe.goodIds["food"];
    const stationId = universe.stations.agricultural;

    const extremeSupply = 5;
    const extremeDemand = 195;

    await prisma.stationMarket.update({
      where: { stationId_goodId: { stationId, goodId: foodGoodId } },
      data: { supply: extremeSupply, demand: extremeDemand },
    });

    const regions = await prisma.region.findMany({ orderBy: { name: "asc" } });
    const fedIdx = regions.findIndex((r) => r.id === universe.regions.federation);

    let targetTick = 10;
    while (targetTick % regions.length !== fedIdx) targetTick++;

    await runProcessor(targetTick);

    const marketAfter = await prisma.stationMarket.findUnique({
      where: { stationId_goodId: { stationId, goodId: foodGoodId } },
    });

    expect(marketAfter).not.toBeNull();
    expect(marketAfter!.supply).toBeGreaterThan(extremeSupply);
    expect(marketAfter!.demand).toBeLessThan(extremeDemand);
  });

  it("only the target region's markets change (round-robin)", async () => {
    const regions = await prisma.region.findMany({ orderBy: { name: "asc" } });
    const fedIdx = regions.findIndex((r) => r.id === universe.regions.federation);
    const corpIdx = regions.findIndex((r) => r.id === universe.regions.corporate);

    // Set distinctive values on a corporate-region market (industrial station)
    const oreGoodId = universe.goodIds["ore"];
    const corpStationId = universe.stations.industrial;

    await prisma.stationMarket.update({
      where: { stationId_goodId: { stationId: corpStationId, goodId: oreGoodId } },
      data: { supply: 199, demand: 199 },
    });

    // Run on a tick that targets the FEDERATION region (not corporate)
    let fedTick = 10;
    while (fedTick % regions.length !== fedIdx) fedTick++;

    await runProcessor(fedTick);

    // Corporate market should be unchanged
    const corpMarket = await prisma.stationMarket.findUnique({
      where: { stationId_goodId: { stationId: corpStationId, goodId: oreGoodId } },
    });
    expect(corpMarket!.supply).toBe(199);
    expect(corpMarket!.demand).toBe(199);

    // Now run on corporate tick
    let corpTick = 10;
    while (corpTick % regions.length !== corpIdx) corpTick++;
    if (corpTick === fedTick) corpTick += regions.length;

    await runProcessor(corpTick);

    // Corporate market should now be changed
    const corpMarketAfter = await prisma.stationMarket.findUnique({
      where: { stationId_goodId: { stationId: corpStationId, goodId: oreGoodId } },
    });
    expect(
      corpMarketAfter!.supply !== 199 || corpMarketAfter!.demand !== 199,
    ).toBe(true);
  });

  it("result contains economyTick global event with correct region", async () => {
    const regions = await prisma.region.findMany({ orderBy: { name: "asc" } });
    const targetRegion = regions[10 % regions.length];

    const result = await runProcessor(10);

    expect(result.globalEvents).toBeDefined();
    expect(result.globalEvents!.economyTick).toBeDefined();
    expect(result.globalEvents!.economyTick!.length).toBe(1);

    const payload = result.globalEvents!.economyTick![0];
    expect(payload.regionId).toBe(targetRegion.id);
    expect(payload.regionName).toBe(targetRegion.name);
    expect(payload.marketCount).toBeGreaterThan(0);
  });
});
