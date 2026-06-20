import type {
  EconomyWorld,
  MarketUpdate,
  MarketView,
  RegionView,
} from "@/lib/tick/world/economy-world";
import type { ModifierRow } from "@/lib/engine/events";
import { consumptionRate } from "@/lib/engine/physical-economy";
import { labourDemand, labourFulfillment, buildingProduction } from "@/lib/engine/industry";
import { toTraitId, toQualityTier } from "@/lib/types/guards";
import type {
  SimMarketEntry,
  SimRegion,
  SimSystem,
} from "@/lib/engine/simulator/types";

/**
 * In-memory adapter for the economy processor.
 *
 * Owns mutable slices of the simulator's world for the duration of one
 * `runEconomyProcessor` call. Markets are mutated in place (the simulator
 * already passes copies of its state in); the caller reads the final
 * arrays via the public fields once the processor returns.
 *
 * The synthetic `MarketView.id` (`"${systemId}|${goodId}"`) round-trips into
 * `MarketUpdate.id`, letting the adapter locate the underlying SimMarketEntry
 * by composite key on write.
 */
export class InMemoryEconomyWorld implements EconomyWorld {
  systems: SimSystem[];
  markets: SimMarketEntry[];
  modifiers: ModifierRow[];

  constructor(
    initial: {
      systems: SimSystem[];
      markets: SimMarketEntry[];
      modifiers: ModifierRow[];
    },
    private readonly regions: SimRegion[],
  ) {
    this.systems = initial.systems.map((s) => ({ ...s }));
    this.markets = initial.markets.map((m) => ({ ...m }));
    this.modifiers = initial.modifiers;
  }

  getRegions(): Promise<RegionView[]> {
    const sorted = [...this.regions].sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    return Promise.resolve(
      sorted.map((r) => ({
        id: r.id,
        name: r.name,
      })),
    );
  }

  getMarketsForRegion(regionId: string): Promise<MarketView[]> {
    const sysById = new Map(this.systems.map((s) => [s.id, s]));
    const fulfillmentBySystem = new Map<string, number>();
    const views: MarketView[] = [];
    for (const m of this.markets) {
      const sys = sysById.get(m.systemId);
      if (!sys || sys.regionId !== regionId) continue;
      let fulfillment = fulfillmentBySystem.get(sys.id);
      if (fulfillment === undefined) {
        fulfillment = labourFulfillment(sys.population, labourDemand(sys.buildings));
        fulfillmentBySystem.set(sys.id, fulfillment);
      }
      const production = buildingProduction(sys.buildings, m.goodId, fulfillment);
      const consumption = consumptionRate(m.goodId, sys.population);
      views.push({
        id: `${m.systemId}|${m.goodId}`,
        systemId: m.systemId,
        goodId: m.goodId,
        basePrice: m.basePrice,
        stock: m.stock,
        governmentType: sys.governmentType,
        baseProductionRate: production > 0 ? production : undefined,
        baseConsumptionRate: consumption > 0 ? consumption : undefined,
        traits: sys.traits.map((t) => ({
          traitId: toTraitId(t.traitId),
          quality: toQualityTier(t.quality),
        })),
      });
    }
    return Promise.resolve(views);
  }

  getModifiers(
    systemIds: string[],
    regionId: string,
  ): Promise<ModifierRow[]> {
    const sysSet = new Set(systemIds);
    const out: ModifierRow[] = [];
    for (const mod of this.modifiers) {
      if (mod.domain !== "economy") continue;
      if (mod.targetType === "region" && mod.targetId === regionId) {
        out.push(mod);
      } else if (
        mod.targetType === "system" &&
        mod.targetId &&
        sysSet.has(mod.targetId)
      ) {
        out.push(mod);
      }
    }
    return Promise.resolve(out);
  }

  getUnrest(systemIds: string[]): Promise<Map<string, number>> {
    const ids = new Set(systemIds);
    const result = new Map<string, number>();
    for (const s of this.systems) if (ids.has(s.id)) result.set(s.id, s.unrest);
    return Promise.resolve(result);
  }

  applyMarketUpdates(updates: MarketUpdate[]): Promise<void> {
    if (updates.length === 0) return Promise.resolve();
    const byKey = new Map<string, MarketUpdate>();
    for (const u of updates) byKey.set(u.id, u);

    this.markets = this.markets.map((m) => {
      const u = byKey.get(`${m.systemId}|${m.goodId}`);
      if (!u) return m;
      return {
        ...m,
        stock: isFinite(u.stock) ? u.stock : 0,
        anchorMult: isFinite(u.anchorMult) ? u.anchorMult : 1,
      };
    });
    return Promise.resolve();
  }
}
