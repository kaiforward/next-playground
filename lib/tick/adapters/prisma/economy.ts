import type { TxClient } from "@/lib/tick/types";
import type {
  EconomyWorld,
  MarketUpdate,
  MarketView,
  ProsperityUpdate,
  ProsperityView,
  RegionView,
} from "@/lib/tick/world/economy-world";
import type { ModifierRow } from "@/lib/engine/events";
import { GOOD_NAME_TO_KEY } from "@/lib/constants/goods";
import { physicalRates } from "@/lib/engine/physical-economy";
import { resourceVectorFromColumns } from "@/lib/engine/resources";
import type { ResourceVector } from "@/lib/types/game";
import {
  toGovernmentType,
  toTraitId,
  toQualityTier,
} from "@/lib/types/guards";

/**
 * Live-game adapter for the economy processor.
 *
 * Resolves each market's base production/consumption rates from the owning
 * system's physical substrate (aggregate resource vector + population) at read
 * time so the processor body never reaches into constants. Bulk writes via
 * `unnest()` SQL — same pattern as the events adapter.
 */
export class PrismaEconomyWorld implements EconomyWorld {
  constructor(private tx: TxClient) {}

  async getRegions(): Promise<RegionView[]> {
    const rows = await this.tx.region.findMany({
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
    }));
  }

  async getMarketsForRegion(regionId: string): Promise<MarketView[]> {
    const rows = await this.tx.stationMarket.findMany({
      where: { station: { system: { regionId } } },
      include: {
        good: true,
        station: {
          include: {
            system: {
              include: {
                traits: true,
                faction: { select: { governmentType: true } },
              },
            },
          },
        },
      },
    });

    // One aggregate vector per system (a system's 12 markets share it).
    const aggBySystem = new Map<string, ResourceVector>();

    return rows.map((m) => {
      const sys = m.station.system;
      let aggregate = aggBySystem.get(sys.id);
      if (!aggregate) {
        aggregate = resourceVectorFromColumns(
          {
            aggGas: sys.aggGas, aggMinerals: sys.aggMinerals, aggOre: sys.aggOre,
            aggBiomass: sys.aggBiomass, aggArable: sys.aggArable,
            aggWater: sys.aggWater, aggRadioactive: sys.aggRadioactive,
          },
          "agg",
        );
        aggBySystem.set(sys.id, aggregate);
      }

      const goodKey = GOOD_NAME_TO_KEY.get(m.good.name) ?? m.good.name;
      const { production, consumption } = physicalRates(goodKey, aggregate, sys.population);
      // After the Layer 2 cutover every system has a non-null factionId. The
      // `?? "frontier"` fallback covers the only legitimate gap: a system the
      // adapter sees mid-write before its factionId is set. Frontier is the
      // safe default (lowest-stability profile).
      const governmentType = sys.faction
        ? toGovernmentType(sys.faction.governmentType)
        : "frontier";
      return {
        id: m.id,
        systemId: sys.id,
        goodId: goodKey,
        basePrice: m.good.basePrice,
        stock: m.stock,
        governmentType,
        baseProductionRate: production > 0 ? production : undefined,
        baseConsumptionRate: consumption > 0 ? consumption : undefined,
        traits: sys.traits.map((t) => ({
          traitId: toTraitId(t.traitId),
          quality: toQualityTier(t.quality),
        })),
      };
    });
  }

  async getModifiers(
    systemIds: string[],
    regionId: string,
  ): Promise<ModifierRow[]> {
    if (systemIds.length === 0) return [];
    const rows = await this.tx.eventModifier.findMany({
      where: {
        domain: "economy",
        OR: [
          { targetType: "system", targetId: { in: systemIds } },
          { targetType: "region", targetId: regionId },
        ],
      },
    });
    return rows;
  }

  async getProsperity(systemIds: string[]): Promise<ProsperityView[]> {
    if (systemIds.length === 0) return [];
    const rows = await this.tx.starSystem.findMany({
      where: { id: { in: systemIds } },
      select: { id: true, prosperity: true, tradeVolumeAccum: true },
    });
    return rows.map((r) => ({
      systemId: r.id,
      prosperity: r.prosperity,
      tradeVolumeAccum: r.tradeVolumeAccum,
    }));
  }

  async applyMarketUpdates(updates: MarketUpdate[]): Promise<void> {
    if (updates.length === 0) return;

    const ids = updates.map((u) => u.id);
    const stocks = updates.map((u) => (isFinite(u.stock) ? u.stock : 0));
    const anchors = updates.map((u) => (isFinite(u.anchorMult) ? u.anchorMult : 1));

    await this.tx.$executeRaw`
      UPDATE "StationMarket" AS sm
      SET "stock" = batch."stock", "anchorMult" = batch."anchorMult"
      FROM unnest(${ids}::text[], ${stocks}::double precision[], ${anchors}::double precision[])
        AS batch("id", "stock", "anchorMult")
      WHERE sm."id" = batch."id"`;
  }

  async applyProsperityUpdates(updates: ProsperityUpdate[]): Promise<void> {
    if (updates.length === 0) return;

    const ids = updates.map((u) => u.systemId);
    const prosperities = updates.map((u) =>
      isFinite(u.prosperity) ? u.prosperity : 0,
    );
    const volumes = updates.map((u) => u.capturedVolume);

    await this.tx.$executeRaw`
      UPDATE "StarSystem" AS ss
      SET "prosperity" = batch."prosperity",
          "tradeVolumeAccum" = GREATEST(0, ss."tradeVolumeAccum" - batch."capturedVolume")
      FROM unnest(${ids}::text[], ${prosperities}::double precision[], ${volumes}::integer[])
        AS batch("id", "prosperity", "capturedVolume")
      WHERE ss."id" = batch."id"`;
  }
}
