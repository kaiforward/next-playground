import { describe, it, expect, beforeEach } from "vitest";
import { useIntegrationDb } from "@/lib/test-utils/integration";
import { seedTestUniverse } from "@/lib/test-utils/fixtures";
import type { TestUniverse } from "@/lib/test-utils/fixtures";
import { runEconomyProcessor } from "@/lib/tick/processors/economy";
import { PrismaEconomyWorld } from "@/lib/tick/adapters/prisma/economy";
import { ECONOMY_CONSTANTS } from "@/lib/constants/economy";
import { ECONOMY_UPDATE_INTERVAL } from "@/lib/constants/tick-cadence";
import { shardRange } from "@/lib/tick/shard";
import { MODIFIER_CAPS } from "@/lib/constants/events";
import { mulberry32 } from "@/lib/engine/universe-gen";
import type { EconomySimParams } from "@/lib/engine/tick";
import type { TickContext, TickProcessorResult } from "@/lib/tick/types";
import { STRIKE_PARAMS } from "@/lib/constants/population";

const { prisma } = useIntegrationDb();

const simParams: EconomySimParams = {
  noiseFraction: ECONOMY_CONSTANTS.NOISE_FRACTION,
  holdCover: ECONOMY_CONSTANTS.HOLD_COVER,
};

describe("economyProcessor (integration)", () => {
  let universe: TestUniverse;

  beforeEach(async () => {
    universe = await seedTestUniverse(prisma);
  });

  /**
   * Run the processor body directly with a seeded RNG at a given shard interval.
   * Per-tick noise is small but can mask a single tick's production/consumption,
   * so behavioral tests run a system on many of its shard ticks (catch-up = 1 at
   * `ECONOMY_UPDATE_INTERVAL`) and assert direction-of-travel.
   */
  async function runProcessor(
    tick: number,
    interval: number,
    seed = 42,
  ): Promise<TickProcessorResult> {
    return prisma.$transaction(
      async (tx) => {
        const ctx: TickContext = { tx, tick, results: new Map() };
        const world = new PrismaEconomyWorld(tx);
        return runEconomyProcessor(world, ctx, {
          rng: mulberry32(seed),
          interval,
          simParams,
          modifierCaps: MODIFIER_CAPS,
          strikeParams: STRIKE_PARAMS,
        });
      },
      { timeout: 15_000 },
    );
  }

  /** Sorted system ids — the shard schedule's stable item list. */
  async function sortedSystemIds(): Promise<string[]> {
    const rows = await prisma.starSystem.findMany({ select: { id: true }, orderBy: { id: "asc" } });
    return rows.map((r) => r.id);
  }

  /** The shard-group offset (`tick % interval`) whose window includes system index `idx`. */
  function shardGroupFor(total: number, idx: number, interval: number): number {
    for (let g = 0; g < interval; g++) {
      const { start, end } = shardRange(total, g, interval);
      if (idx >= start && idx < end) return g;
    }
    return 0;
  }

  it("raises a producer's stock and drains a consumer's stock over ticks", async () => {
    // Agricultural PRODUCES food; industrial CONSUMES food. Each market has its
    // own per-band derived from its demand rate (pop × perCapitaNeed). Seed
    // within each market's own band and process each system on its shard ticks
    // (interval = ECONOMY_UPDATE_INTERVAL → catch-up = 1, calibrated steps).
    //
    // Band arithmetic (storageCapacity=0 from fixture default, TARGET_COVER=40):
    //   agri (pop 400):  demandRate=1.6 → target=64, min=32,  max=128
    //   ind  (pop 1500): demandRate=6.0 → target=240, min=120, max=480
    const foodGoodId = universe.goodIds["food"];
    const producerStation = universe.stations.agricultural;
    const consumerStation = universe.stations.industrial;

    // Seed producer below its ceiling (min=32, max=128) → should climb.
    const PRODUCER_SEED = 45;
    // Seed consumer above its target (min=120, max=480) → should drain toward min.
    const CONSUMER_SEED = 350;

    await prisma.stationMarket.update({
      where: { stationId_goodId: { stationId: producerStation, goodId: foodGoodId } },
      data: { stock: PRODUCER_SEED },
    });
    await prisma.stationMarket.update({
      where: { stationId_goodId: { stationId: consumerStation, goodId: foodGoodId } },
      data: { stock: CONSUMER_SEED },
    });

    const ids = await sortedSystemIds();
    const interval = ECONOMY_UPDATE_INTERVAL;
    const prodGroup = shardGroupFor(ids.length, ids.indexOf(universe.systems.agricultural), interval);
    const consGroup = shardGroupFor(ids.length, ids.indexOf(universe.systems.industrial), interval);

    // ~12 calibrated updates per system, each on its own shard tick.
    for (let i = 0; i < 12; i++) {
      await runProcessor(prodGroup + i * interval, interval);
      await runProcessor(consGroup + i * interval, interval);
    }

    const producer = await prisma.stationMarket.findUnique({
      where: { stationId_goodId: { stationId: producerStation, goodId: foodGoodId } },
    });
    const consumer = await prisma.stationMarket.findUnique({
      where: { stationId_goodId: { stationId: consumerStation, goodId: foodGoodId } },
    });

    // Producer (agri, food buildings): stock should rise above seed.
    expect(producer!.stock).toBeGreaterThan(PRODUCER_SEED);
    // Consumer (industrial, no food buildings): consumption drains stock below seed.
    expect(consumer!.stock).toBeLessThan(CONSUMER_SEED);

    // Stock stays finite and non-negative (clamped to per-market band).
    for (const m of [producer!, consumer!]) {
      expect(Number.isFinite(m.stock)).toBe(true);
      expect(m.stock).toBeGreaterThanOrEqual(0);
    }
  });

  it("only the current shard's systems change (a system outside the shard is untouched)", async () => {
    const ids = await sortedSystemIds();
    const interval = ids.length; // interval = N → each tick processes exactly one system (its shard group)
    const industrialIdx = ids.indexOf(universe.systems.industrial);
    expect(industrialIdx).toBeGreaterThanOrEqual(0);

    // Set a distinctive stock on the industrial system's ore market.
    const oreGoodId = universe.goodIds["ore"];
    const corpStationId = universe.stations.industrial;
    await prisma.stationMarket.update({
      where: { stationId_goodId: { stationId: corpStationId, goodId: oreGoodId } },
      data: { stock: 150 },
    });

    // A tick whose shard group is NOT the industrial system → its ore is untouched.
    const otherTick = (industrialIdx + 1) % interval;
    await runProcessor(otherTick, interval);
    const untouched = await prisma.stationMarket.findUnique({
      where: { stationId_goodId: { stationId: corpStationId, goodId: oreGoodId } },
    });
    expect(untouched!.stock).toBe(150);

    // The tick whose shard group IS the industrial system → its ore changes.
    await runProcessor(industrialIdx, interval);
    const touched = await prisma.stationMarket.findUnique({
      where: { stationId_goodId: { stationId: corpStationId, goodId: oreGoodId } },
    });
    expect(touched!.stock).not.toBe(150);
  });

  it("result contains economyTick global event with shard metadata", async () => {
    const ids = await sortedSystemIds();
    const interval = ids.length; // one system per shard
    const tick = ids.indexOf(universe.systems.industrial); // a market-bearing system

    const result = await runProcessor(tick, interval);

    expect(result.globalEvents).toBeDefined();
    expect(result.globalEvents!.economyTick).toBeDefined();
    expect(result.globalEvents!.economyTick!.length).toBe(1);

    const payload = result.globalEvents!.economyTick![0];
    expect(payload.shardCount).toBe(interval);
    expect(payload.shardIndex).toBe(tick % interval);
    expect(payload.systemCount).toBe(1);
  });

  it("raises stock for a good the system has buildings for, but not for one it lacks", async () => {
    // The agricultural system has food/textiles/water extractors but no
    // consumer_goods plant — consumer_goods needs a polymers input this system
    // can't produce locally. consumer_goods is a labour-only (tier-1) good: the
    // old labour-driven model would have produced it from population alone, so a
    // capacity-driven adapter MUST leave it unproduced here. Its low volatility
    // keeps it near the floor over the run.
    //
    // Both start at the floor. Food's building-production pushes it well above
    // consumer_goods, which has no building and only drifts on consumption + noise.
    const foodGoodId = universe.goodIds["food"];
    const labourOnlyGoodId = universe.goodIds["consumer_goods"];
    const station = universe.stations.agricultural;

    await prisma.stationMarket.updateMany({
      where: { stationId: station, goodId: { in: [foodGoodId, labourOnlyGoodId] } },
      data: { stock: 5 }, // pin to per-market band floor (≈minStock for typical goods)
    });

    const ids = await sortedSystemIds();
    const interval = ECONOMY_UPDATE_INTERVAL;
    const agriGroup = shardGroupFor(ids.length, ids.indexOf(universe.systems.agricultural), interval);
    for (let i = 0; i < 15; i++) await runProcessor(agriGroup + i * interval, interval);

    const food = await prisma.stationMarket.findFirstOrThrow({
      where: { stationId: station, goodId: foodGoodId },
    });
    const labourOnly = await prisma.stationMarket.findFirstOrThrow({
      where: { stationId: station, goodId: labourOnlyGoodId },
    });
    // Food has a building → produced; climbs well above its floor start (5).
    expect(food.stock).toBeGreaterThan(5 + 20);
    // consumer_goods has no building → not produced; stays far below food.
    expect(food.stock).toBeGreaterThan(labourOnly.stock + 20);
  });

  it("keeps every market stock finite and in-band over many ticks with a non-unit yield", async () => {
    // Drive a rich ore yield (×2.5) on the industrial (ore-extracting) system so
    // the tier-0 yield term flows DB→adapter→production→write against Postgres.
    // Run two full refresh cycles (every system processed twice) and assert no
    // stock ever goes NaN/Infinity or escapes its own per-market band.
    await prisma.starSystem.update({
      where: { id: universe.systems.industrial },
      data: { yieldOre: 2.5 },
    });

    const interval = ECONOMY_UPDATE_INTERVAL;
    for (let t = 0; t < 2 * interval; t++) await runProcessor(t, interval);

    const markets = await prisma.stationMarket.findMany({ select: { stock: true } });
    expect(markets.length).toBeGreaterThan(0);
    for (const m of markets) {
      expect(Number.isFinite(m.stock)).toBe(true);
      expect(m.stock).toBeGreaterThanOrEqual(0);
    }

    // The rich-ore system's ore market produces under the ×2.5 yield: its stock
    // climbs above the per-market band floor rather than draining out.
    const oreMarket = await prisma.stationMarket.findUniqueOrThrow({
      where: {
        stationId_goodId: { stationId: universe.stations.industrial, goodId: universe.goodIds["ore"] },
      },
    });
    expect(oreMarket.stock).toBeGreaterThan(5); // above the per-market band floor
  });

  it("writes anchorMult from an active anchor_shift modifier", async () => {
    // goodIds["food"] is the DB CUID used for StationMarket lookups.
    // EventModifier.goodId stores the canonical good KEY ("food"), not the DB id.
    const foodDbId = universe.goodIds["food"];
    const agriSystemId = universe.systems.agricultural;
    const agriStationId = universe.stations.agricultural;

    // Anchor-shift modifier targeting the agricultural system for food (value 2.0).
    const event = await prisma.gameEvent.create({
      data: {
        type: "bumper_harvest",
        phase: "active",
        systemId: agriSystemId,
        regionId: universe.regions.federation,
        startTick: 0,
        phaseStartTick: 0,
        phaseDuration: 2_000_000_000,
        severity: 1.0,
      },
    });
    await prisma.eventModifier.create({
      data: {
        eventId: event.id,
        domain: "economy",
        type: "anchor_shift",
        targetType: "system",
        targetId: agriSystemId,
        goodId: "food", // canonical good key, not DB id
        parameter: "target_stock",
        value: 2.0,
      },
    });

    // Run the tick whose shard includes the agri system, so the modifier resolves.
    const ids = await sortedSystemIds();
    const interval = ECONOMY_UPDATE_INTERVAL;
    const agriGroup = shardGroupFor(ids.length, ids.indexOf(agriSystemId), interval);
    await runProcessor(agriGroup, interval);

    const updated = await prisma.stationMarket.findUnique({
      where: { stationId_goodId: { stationId: agriStationId, goodId: foodDbId } },
    });

    expect(updated?.anchorMult).toBeCloseTo(2.0);
  });
});
