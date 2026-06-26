import type {
  DirectedLogisticsWorld,
  SystemLogisticsRow,
  LogisticsMarketUpdate,
  LogisticsFlowInsert,
} from "@/lib/tick/world/directed-logistics-world";

/** In-memory DirectedLogisticsWorld for unit tests + the simulator. Captures writes for assertions. */
export class MemoryDirectedLogisticsWorld implements DirectedLogisticsWorld {
  readonly stockUpdates = new Map<string, number>();
  readonly flows: LogisticsFlowInsert[] = [];

  constructor(private readonly systems: SystemLogisticsRow[]) {}

  async getFactionShardKeys(): Promise<Array<string | null>> {
    const seen = new Set<string | null>();
    for (const s of this.systems) seen.add(s.factionId);
    return [...seen];
  }

  async getSystemsForFactions(factionKeys: Array<string | null>): Promise<SystemLogisticsRow[]> {
    const set = new Set(factionKeys);
    return this.systems.filter((s) => set.has(s.factionId));
  }

  async applyMarketUpdates(updates: LogisticsMarketUpdate[]): Promise<void> {
    for (const u of updates) this.stockUpdates.set(u.id, u.stock);
  }

  async appendLogisticsFlows(flows: LogisticsFlowInsert[]): Promise<void> {
    this.flows.push(...flows);
  }
}
