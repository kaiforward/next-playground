import type {
  InfrastructureWorld,
  InfrastructureStateView,
  BuildingCountUpdate,
  IdleMonthsUpdate,
  CollapseDebtUpdate,
  PopCapUpdate,
} from "@/lib/tick/world/infrastructure-world";
import type { TickSystem } from "@/lib/tick/rows";

/**
 * In-memory adapter for the infrastructure-decay processor. Owns a mutable copy of
 * the tick's system rows for one processor run; the caller reads `systems` back
 * after the processor returns. Decays are downward-only and floored at 0.
 */
export class InMemoryInfrastructureWorld implements InfrastructureWorld {
  systems: TickSystem[];

  constructor(initial: { systems: TickSystem[] }) {
    this.systems = initial.systems.map((s) => ({
      ...s,
      buildings: { ...s.buildings },
      buildingIdleMonths: { ...s.buildingIdleMonths },
      buildingCollapseDebt: { ...s.buildingCollapseDebt },
    }));
  }

  getInfrastructureState(systemIds: string[]): Promise<InfrastructureStateView[]> {
    const wanted = new Set(systemIds);
    return Promise.resolve(
      this.systems
        .filter((s) => wanted.has(s.id))
        .map((s) => ({
          systemId: s.id,
          population: s.population,
          unrest: s.unrest,
          buildings: { ...s.buildings },
          buildingIdleMonths: { ...s.buildingIdleMonths },
          buildingCollapseDebt: { ...s.buildingCollapseDebt },
        })),
    );
  }

  applyBuildingDecays(updates: BuildingCountUpdate[]): Promise<void> {
    if (updates.length === 0) return Promise.resolve();
    const bySystem = new Map<string, Map<string, number>>();
    for (const u of updates) {
      const m = bySystem.get(u.systemId) ?? new Map<string, number>();
      m.set(u.buildingType, u.count);
      bySystem.set(u.systemId, m);
    }
    this.systems = this.systems.map((s) => {
      const m = bySystem.get(s.id);
      if (!m) return s;
      const buildings = { ...s.buildings };
      for (const [type, next] of m) {
        // Downward-only + floor (mirrors the SQL LEAST(count, GREATEST(0, …))).
        buildings[type] = Math.min(buildings[type] ?? 0, Math.max(0, next));
      }
      return { ...s, buildings };
    });
    return Promise.resolve();
  }

  applyIdleMonths(updates: IdleMonthsUpdate[]): Promise<void> {
    if (updates.length === 0) return Promise.resolve();
    const bySystem = new Map<string, Map<string, number>>();
    for (const u of updates) {
      const m = bySystem.get(u.systemId) ?? new Map<string, number>();
      m.set(u.buildingType, u.idleMonths);
      bySystem.set(u.systemId, m);
    }
    this.systems = this.systems.map((s) => {
      const m = bySystem.get(s.id);
      if (!m) return s;
      const buildingIdleMonths = { ...s.buildingIdleMonths };
      for (const [type, idle] of m) buildingIdleMonths[type] = idle;
      return { ...s, buildingIdleMonths };
    });
    return Promise.resolve();
  }

  applyCollapseDebts(updates: CollapseDebtUpdate[]): Promise<void> {
    if (updates.length === 0) return Promise.resolve();
    const bySystem = new Map<string, Map<string, number>>();
    for (const u of updates) {
      const m = bySystem.get(u.systemId) ?? new Map<string, number>();
      m.set(u.buildingType, u.collapseDebt);
      bySystem.set(u.systemId, m);
    }
    this.systems = this.systems.map((s) => {
      const m = bySystem.get(s.id);
      if (!m) return s;
      const buildingCollapseDebt = { ...s.buildingCollapseDebt };
      for (const [type, debt] of m) buildingCollapseDebt[type] = debt;
      return { ...s, buildingCollapseDebt };
    });
    return Promise.resolve();
  }

  applyPopCapUpdates(updates: PopCapUpdate[]): Promise<void> {
    if (updates.length === 0) return Promise.resolve();
    const byId = new Map(updates.map((u) => [u.systemId, Math.max(0, u.popCap)]));
    this.systems = this.systems.map((s) => {
      const pc = byId.get(s.id);
      return pc === undefined ? s : { ...s, popCap: pc };
    });
    return Promise.resolve();
  }
}
