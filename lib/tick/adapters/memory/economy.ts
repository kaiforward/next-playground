import type {
  EconomyWorld,
  MarketUpdate,
  MarketView,
} from "@/lib/tick/world/economy-world";
import type { ModifierRow } from "@/lib/engine/events";
import { consumptionRate } from "@/lib/engine/physical-economy";
import { computeSystemLabourSnapshot, buildingProduction } from "@/lib/engine/industry";
import type { SystemLabourSnapshot } from "@/lib/engine/industry";
import { economyShardOrder } from "@/lib/engine/shard-order";
import { isEconomicallyActive } from "@/lib/engine/control";
import type { TickSystem } from "@/lib/tick/rows";
import type { WorldMarket } from "@/lib/world/types";

/**
 * In-memory adapter for the economy processor.
 *
 * Owns mutable slices of the tick's rows for the duration of one
 * `runEconomyProcessor` call. Markets are mutated in place (the caller
 * already passes copies in); the caller reads the final arrays via the
 * public fields once the processor returns.
 *
 * The synthetic `MarketView.id` (`"${systemId}|${goodId}"`) round-trips into
 * `MarketUpdate.id`, letting the adapter locate the underlying market row
 * by composite key on write.
 */
export class InMemoryEconomyWorld implements EconomyWorld {
  systems: TickSystem[];
  markets: WorldMarket[];
  modifiers: ModifierRow[];

  constructor(initial: {
    systems: TickSystem[];
    markets: WorldMarket[];
    modifiers: ModifierRow[];
  }) {
    this.systems = initial.systems.map((s) => ({ ...s }));
    this.markets = initial.markets.map((m) => ({ ...m }));
    this.modifiers = initial.modifiers;
  }

  getSystemIds(): Promise<string[]> {
    // Only developed systems participate in the economy. Non-developed systems stay
    // in `this.systems`/`this.markets` untouched (frozen) — they are simply never
    // selected here, and the population/infrastructure-decay processors key off this
    // set's dissatisfaction signals, so gating here cascades to both.
    return Promise.resolve(
      economyShardOrder(this.systems.filter((s) => isEconomicallyActive(s.control))),
    );
  }

  getMarketsForSystems(systemIds: string[]): Promise<MarketView[]> {
    const sysById = new Map(this.systems.map((s) => [s.id, s]));
    const wanted = new Set(systemIds);
    const labourBySystem = new Map<string, SystemLabourSnapshot>();
    const views: MarketView[] = [];
    for (const m of this.markets) {
      if (!wanted.has(m.systemId)) continue;
      const sys = sysById.get(m.systemId);
      if (!sys) continue;
      let snap = labourBySystem.get(sys.id);
      if (snap === undefined) {
        snap = computeSystemLabourSnapshot(sys.buildings, sys.population);
        labourBySystem.set(sys.id, snap);
      }
      const production = buildingProduction(sys.buildings, m.goodId, snap.state, sys.yields);
      const consumption = consumptionRate(m.goodId, snap.basis);
      views.push({
        id: `${m.systemId}|${m.goodId}`,
        systemId: m.systemId,
        regionId: sys.regionId,
        goodId: m.goodId,
        stock: m.stock,
        governmentType: sys.governmentType,
        baseProductionRate: production > 0 ? production : undefined,
        baseConsumptionRate: consumption > 0 ? consumption : undefined,
        demandRate: m.demandRate,
        storageCapacity: m.storageCapacity,
      });
    }
    return Promise.resolve(views);
  }

  getModifiers(systemIds: string[]): Promise<ModifierRow[]> {
    const sysSet = new Set(systemIds);
    // Region-targeted mods apply to the distinct regions the slice's systems
    // belong to — derive that set from the systems themselves.
    const regionIds = new Set<string>();
    for (const s of this.systems) if (sysSet.has(s.id)) regionIds.add(s.regionId);
    const out: ModifierRow[] = [];
    for (const mod of this.modifiers) {
      if (mod.domain !== "economy") continue;
      if (mod.targetType === "region" && mod.targetId && regionIds.has(mod.targetId)) {
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
        satisfaction: isFinite(u.satisfaction) ? Math.max(0, Math.min(1, u.satisfaction)) : 1,
      };
    });
    return Promise.resolve();
  }
}
