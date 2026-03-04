import { describe, it, expect, beforeEach } from "vitest";
import { useIntegrationDb } from "@/lib/test-utils/integration";
import { seedTestUniverse } from "@/lib/test-utils/fixtures";
import type { TestUniverse } from "@/lib/test-utils/fixtures";
import { economyProcessor } from "@/lib/tick/processors/economy";
import type { TickContext, TickProcessorResult } from "@/lib/tick/types";

const { prisma } = useIntegrationDb();

describe("economyProcessor (integration)", () => {
  let universe: TestUniverse;

  beforeEach(async () => {
    universe = await seedTestUniverse(prisma);
  });

  async function runProcessor(tick: number): Promise<TickProcessorResult> {
    // The economy processor uses $executeRaw for bulk market updates.
    // Wrapping in $transaction ensures all writes are atomic, matching
    // how the tick worker runs processors in production.
    return prisma.$transaction(async (tx) => {
      const ctx: TickContext = { tx, tick, results: new Map() };
      const result = await economyProcessor.process(ctx);
      return result;
    }, { timeout: 15_000 });
  }

  it("markets with extreme supply/demand drift toward equilibrium", async () => {
    // Set one market to extreme values
    const foodGoodId = universe.goodIds["food"];
    const stationId = universe.stations.agricultural;

    // Use extreme low supply / high demand — agricultural produces food, so
    // supply target is ~145 and demand target is ~30. With supply=5, the
    // reversion pull (+7) and production (+5) guarantee supply will increase.
    // With demand=200, reversion pull (-8.5) guarantees demand will decrease.
    const extremeSupply = 5;
    const extremeDemand = 200;

    await prisma.stationMarket.update({
      where: { stationId_goodId: { stationId, goodId: foodGoodId } },
      data: { supply: extremeSupply, demand: extremeDemand },
    });

    // Find a tick that targets the federation region (which contains the agricultural system)
    const regions = await prisma.region.findMany({ orderBy: { name: "asc" } });
    const fedIdx = regions.findIndex((r) => r.id === universe.regions.federation);

    let targetTick = 10;
    while (targetTick % regions.length !== fedIdx) targetTick++;

    await runProcessor(targetTick);

    const marketAfter = await prisma.stationMarket.findUnique({
      where: { stationId_goodId: { stationId, goodId: foodGoodId } },
    });

    expect(marketAfter).not.toBeNull();
    // Supply must increase from 5 (target 145, +reversion +production)
    expect(marketAfter!.supply).toBeGreaterThan(extremeSupply);
    // Demand must decrease from 200 (target 30, strong reversion pull)
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
