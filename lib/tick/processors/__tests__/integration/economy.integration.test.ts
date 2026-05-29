import { describe, it, expect, beforeEach } from "vitest";
import { useIntegrationDb } from "@/lib/test-utils/integration";
import { seedTestUniverse } from "@/lib/test-utils/fixtures";
import type { TestUniverse } from "@/lib/test-utils/fixtures";
import { runEconomyProcessor } from "@/lib/tick/processors/economy";
import { PrismaEconomyWorld } from "@/lib/tick/adapters/prisma/economy";
import {
  ECONOMY_CONSTANTS,
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
  noiseAmplitude: ECONOMY_CONSTANTS.NOISE_AMPLITUDE,
  minLevel: ECONOMY_CONSTANTS.MIN_LEVEL,
  maxLevel: ECONOMY_CONSTANTS.MAX_LEVEL,
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
   * Run the processor body directly with a seeded RNG. Per-tick noise (±3) is
   * small but can mask a single tick's production/consumption, so behavioral
   * tests run many ticks and assert direction-of-travel, not exact values.
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

  /** First tick >= `from` whose round-robin index lands on `regionIndex`. */
  function tickForRegion(from: number, regionIndex: number, regionCount: number): number {
    let t = from;
    while (t % regionCount !== regionIndex) t++;
    return t;
  }

  it("raises a producer's stock and drains a consumer's stock over ticks", async () => {
    // Agricultural PRODUCES food (federation region); industrial CONSUMES food
    // (corporate region). Seed both at the same mid stock and run each region's
    // tick repeatedly — production should push the producer up, consumption
    // should pull the consumer down, both staying inside [MIN, MAX].
    const foodGoodId = universe.goodIds["food"];
    const producerStation = universe.stations.agricultural;
    const consumerStation = universe.stations.industrial;

    await prisma.stationMarket.update({
      where: { stationId_goodId: { stationId: producerStation, goodId: foodGoodId } },
      data: { stock: 80 },
    });
    await prisma.stationMarket.update({
      where: { stationId_goodId: { stationId: consumerStation, goodId: foodGoodId } },
      data: { stock: 80 },
    });

    const regions = await prisma.region.findMany({ orderBy: { name: "asc" } });
    const fedIdx = regions.findIndex((r) => r.id === universe.regions.federation);
    const corpIdx = regions.findIndex((r) => r.id === universe.regions.corporate);

    // Run ~12 economy ticks for each region.
    for (let i = 0; i < 12; i++) {
      await runProcessor(tickForRegion(10 + i * regions.length, fedIdx, regions.length));
      await runProcessor(tickForRegion(10 + i * regions.length, corpIdx, regions.length));
    }

    const producer = await prisma.stationMarket.findUnique({
      where: { stationId_goodId: { stationId: producerStation, goodId: foodGoodId } },
    });
    const consumer = await prisma.stationMarket.findUnique({
      where: { stationId_goodId: { stationId: consumerStation, goodId: foodGoodId } },
    });

    expect(producer!.stock).toBeGreaterThan(80);
    expect(consumer!.stock).toBeLessThan(80);

    // Stock stays within the global band.
    for (const m of [producer!, consumer!]) {
      expect(m.stock).toBeGreaterThanOrEqual(ECONOMY_CONSTANTS.MIN_LEVEL);
      expect(m.stock).toBeLessThanOrEqual(ECONOMY_CONSTANTS.MAX_LEVEL);
    }

    // Cross-system: the producing system holds more food than the consuming one.
    expect(producer!.stock).toBeGreaterThan(consumer!.stock);
  });

  it("only the target region's markets change (round-robin)", async () => {
    const regions = await prisma.region.findMany({ orderBy: { name: "asc" } });
    const fedIdx = regions.findIndex((r) => r.id === universe.regions.federation);
    const corpIdx = regions.findIndex((r) => r.id === universe.regions.corporate);

    // Set a distinctive stock on a corporate-region market (industrial station).
    const oreGoodId = universe.goodIds["ore"];
    const corpStationId = universe.stations.industrial;

    await prisma.stationMarket.update({
      where: { stationId_goodId: { stationId: corpStationId, goodId: oreGoodId } },
      data: { stock: 150 },
    });

    // Run on a tick that targets the FEDERATION region (not corporate).
    const fedTick = tickForRegion(10, fedIdx, regions.length);
    await runProcessor(fedTick);

    const corpMarket = await prisma.stationMarket.findUnique({
      where: { stationId_goodId: { stationId: corpStationId, goodId: oreGoodId } },
    });
    expect(corpMarket!.stock).toBe(150);

    // Now run on the corporate tick.
    let corpTick = tickForRegion(10, corpIdx, regions.length);
    if (corpTick === fedTick) corpTick += regions.length;
    await runProcessor(corpTick);

    const corpMarketAfter = await prisma.stationMarket.findUnique({
      where: { stationId_goodId: { stationId: corpStationId, goodId: oreGoodId } },
    });
    expect(corpMarketAfter!.stock).not.toBe(150);
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
