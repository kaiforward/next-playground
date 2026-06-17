import type {
  EconomyWorld,
  MarketUpdate,
  MarketView,
  ProsperityUpdate,
  ProsperityView,
  RegionView,
} from "@/lib/tick/world/economy-world";
import type { ModifierRow } from "@/lib/engine/events";
import { physicalRates } from "@/lib/engine/physical-economy";
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
    const views: MarketView[] = [];
    for (const m of this.markets) {
      const sys = sysById.get(m.systemId);
      if (!sys || sys.regionId !== regionId) continue;
      const { production, consumption } = physicalRates(m.goodId, sys.aggregate, sys.population);
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

  getProsperity(systemIds: string[]): Promise<ProsperityView[]> {
    const sysSet = new Set(systemIds);
    const out: ProsperityView[] = [];
    for (const s of this.systems) {
      if (!sysSet.has(s.id)) continue;
      out.push({
        systemId: s.id,
        prosperity: s.prosperity,
        tradeVolumeAccum: s.tradeVolumeAccum,
      });
    }
    return Promise.resolve(out);
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

  applyProsperityUpdates(updates: ProsperityUpdate[]): Promise<void> {
    if (updates.length === 0) return Promise.resolve();
    const bySystem = new Map(updates.map((u) => [u.systemId, u]));

    this.systems = this.systems.map((s) => {
      const u = bySystem.get(s.id);
      if (!u) return s;
      const nextProsperity = isFinite(u.prosperity) ? u.prosperity : 0;
      const nextVolume = Math.max(0, s.tradeVolumeAccum - u.capturedVolume);
      return {
        ...s,
        prosperity: nextProsperity,
        tradeVolumeAccum: nextVolume,
      };
    });
    return Promise.resolve();
  }
}
