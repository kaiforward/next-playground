import type { TxClient } from "@/lib/tick/types";
import type {
  EconomyWorld,
  MarketUpdate,
  MarketView,
} from "@/lib/tick/world/economy-world";
import type { ModifierRow } from "@/lib/engine/events";
import { GOOD_NAME_TO_KEY } from "@/lib/constants/goods";
import { consumptionRate } from "@/lib/engine/physical-economy";
import { computeSystemLabourSnapshot, buildingProduction } from "@/lib/engine/industry";
import type { SystemLabourSnapshot } from "@/lib/engine/industry";
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
 * system's industrial base (SystemBuilding rows + population) at read time so
 * the processor body never reaches into constants. Bulk writes via `unnest()`
 * SQL — same pattern as the events adapter.
 */
export class PrismaEconomyWorld implements EconomyWorld {
  constructor(private tx: TxClient) {}

  async getSystemIds(): Promise<string[]> {
    const rows = await this.tx.starSystem.findMany({
      select: { id: true },
      orderBy: { id: "asc" },
    });
    return rows.map((r) => r.id);
  }

  async getMarketsForSystems(systemIds: string[]): Promise<MarketView[]> {
    if (systemIds.length === 0) return [];
    const [rows, buildingRows] = await Promise.all([
      this.tx.stationMarket.findMany({
        where: { station: { system: { id: { in: systemIds } } } },
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
      }),
      this.tx.systemBuilding.findMany({
        where: { systemId: { in: systemIds } },
        select: { systemId: true, buildingType: true, count: true },
      }),
    ]);

    // Build a per-system map of building counts from the region's building rows.
    const buildingsBySystem = new Map<string, Record<string, number>>();
    for (const b of buildingRows) {
      const map = buildingsBySystem.get(b.systemId) ?? {};
      map[b.buildingType] = b.count;
      buildingsBySystem.set(b.systemId, map);
    }
    // Cache the labour snapshot (fulfilment state + civilian demand basis) +
    // per-resource yields per system — shared across all goods in the system.
    // Yields come from the already-loaded yield* columns on the included
    // system row (no extra query).
    const labourBySystem = new Map<string, SystemLabourSnapshot>();
    const yieldsBySystem = new Map<string, ResourceVector>();

    return rows.map((m) => {
      const sys = m.station.system;

      const buildings = buildingsBySystem.get(sys.id) ?? {};
      let snap = labourBySystem.get(sys.id);
      if (snap === undefined) {
        snap = computeSystemLabourSnapshot(buildings, sys.population);
        labourBySystem.set(sys.id, snap);
      }
      let yields = yieldsBySystem.get(sys.id);
      if (yields === undefined) {
        yields = resourceVectorFromColumns(
          {
            yieldGas: sys.yieldGas, yieldMinerals: sys.yieldMinerals, yieldOre: sys.yieldOre,
            yieldBiomass: sys.yieldBiomass, yieldArable: sys.yieldArable,
            yieldWater: sys.yieldWater, yieldRadioactive: sys.yieldRadioactive,
          },
          "yield",
        );
        yieldsBySystem.set(sys.id, yields);
      }

      const goodKey = GOOD_NAME_TO_KEY.get(m.good.name) ?? m.good.name;
      const production = buildingProduction(buildings, goodKey, snap.state, yields);
      const consumption = consumptionRate(goodKey, snap.basis);

      // Every seeded system has a non-null factionId. The `?? "frontier"`
      // fallback covers the only legitimate gap: a system the adapter sees
      // mid-write before its factionId is set. Frontier is the safe default
      // (lowest-stability profile).
      const governmentType = sys.faction
        ? toGovernmentType(sys.faction.governmentType)
        : "frontier";
      return {
        id: m.id,
        systemId: sys.id,
        regionId: sys.regionId,
        goodId: goodKey,
        basePrice: m.good.basePrice,
        stock: m.stock,
        governmentType,
        baseProductionRate: production > 0 ? production : undefined,
        baseConsumptionRate: consumption > 0 ? consumption : undefined,
        demandRate: m.demandRate,
        storageCapacity: m.storageCapacity,
        traits: sys.traits.map((t) => ({
          traitId: toTraitId(t.traitId),
          quality: toQualityTier(t.quality),
        })),
      };
    });
  }

  async getModifiers(systemIds: string[]): Promise<ModifierRow[]> {
    if (systemIds.length === 0) return [];
    // The shard slice spans regions; resolve the distinct regions its systems
    // belong to so region-targeted modifiers are matched (one extra IN query).
    const regionRows = await this.tx.starSystem.findMany({
      where: { id: { in: systemIds } },
      select: { regionId: true },
    });
    const regionIds = [...new Set(regionRows.map((r) => r.regionId))];
    const rows = await this.tx.eventModifier.findMany({
      where: {
        domain: "economy",
        OR: [
          { targetType: "system", targetId: { in: systemIds } },
          { targetType: "region", targetId: { in: regionIds } },
        ],
      },
    });
    return rows;
  }

  async getUnrest(systemIds: string[]): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    if (systemIds.length === 0) return result;
    const rows = await this.tx.starSystem.findMany({
      where: { id: { in: systemIds } },
      select: { id: true, unrest: true },
    });
    for (const r of rows) result.set(r.id, r.unrest);
    return result;
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
}
