import type { EdgeView } from "@/lib/tick/world/trade-flow-world";
import type {
  MigrationDelta, MigrationNodeView, MigrationWorld,
} from "@/lib/tick/world/migration-world";
import { buildOpenEdges } from "@/lib/tick/world/trade-flow-topology";
import type { SimConnection, SimSystem } from "@/lib/engine/simulator/types";

/**
 * In-memory adapter for the migration processor (sim + unit tests). Open edges
 * are built from the same faction-bounded topology helper as trade-flow.
 */
export class InMemoryMigrationWorld implements MigrationWorld {
  systems: SimSystem[];
  private openEdgesCache: EdgeView[] | null = null;

  constructor(
    initial: { systems: SimSystem[] },
    private readonly connections: SimConnection[],
  ) {
    this.systems = initial.systems.map((s) => ({ ...s }));
  }

  getOpenEdges(): Promise<EdgeView[]> {
    if (this.openEdgesCache) return Promise.resolve(this.openEdgesCache);
    const sysFaction = new Map(this.systems.map((s) => [s.id, s.factionId]));
    this.openEdgesCache = buildOpenEdges(this.connections, sysFaction);
    return Promise.resolve(this.openEdgesCache);
  }

  getNodesForSystems(systemIds: string[]): Promise<MigrationNodeView[]> {
    const ids = new Set(systemIds);
    const out: MigrationNodeView[] = [];
    for (const s of this.systems) {
      if (!ids.has(s.id)) continue;
      out.push({ systemId: s.id, population: s.population, popCap: s.popCap, unrest: s.unrest });
    }
    return Promise.resolve(out);
  }

  applyMigrationDeltas(deltas: MigrationDelta[]): Promise<void> {
    if (deltas.length === 0) return Promise.resolve();
    const bySystem = new Map<string, number>();
    for (const d of deltas) bySystem.set(d.systemId, (bySystem.get(d.systemId) ?? 0) + (isFinite(d.delta) ? d.delta : 0));
    this.systems = this.systems.map((s) => {
      const delta = bySystem.get(s.id);
      if (delta == null) return s;
      return { ...s, population: Math.max(0, s.population + delta) };
    });
    return Promise.resolve();
  }
}
