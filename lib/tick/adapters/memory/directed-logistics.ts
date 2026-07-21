import type {
  DirectedLogisticsWorld,
  SystemLogisticsRow,
  LogisticsMarketUpdate,
  LogisticsFlowInsert,
  LogisticsFundingBoundUpdate,
} from "@/lib/tick/world/directed-logistics-world";
import { factionShardKeys } from "@/lib/engine/shard-order";

/** The DirectedLogisticsWorld adapter — the only backend. Captures writes for assertions. */
export class MemoryDirectedLogisticsWorld implements DirectedLogisticsWorld {
  readonly stockUpdates = new Map<string, number>();
  readonly fundingBoundUpdates = new Map<string, boolean>();
  readonly flows: LogisticsFlowInsert[] = [];

  constructor(private readonly systems: SystemLogisticsRow[]) {}

  async getFactionShardKeys(): Promise<Array<string | null>> {
    return factionShardKeys(this.systems);
  }

  async getSystemsForFactions(factionKeys: Array<string | null>): Promise<SystemLogisticsRow[]> {
    const set = new Set(factionKeys);
    return this.systems.filter((s) => set.has(s.factionId));
  }

  async applyMarketUpdates(updates: LogisticsMarketUpdate[]): Promise<void> {
    for (const u of updates) this.stockUpdates.set(u.id, u.stock);
  }

  async applyFundingBoundUpdates(updates: LogisticsFundingBoundUpdate[]): Promise<void> {
    for (const u of updates) this.fundingBoundUpdates.set(u.id, u.logisticsFundingBound);
  }

  async appendLogisticsFlows(flows: LogisticsFlowInsert[]): Promise<void> {
    this.flows.push(...flows);
  }
}
