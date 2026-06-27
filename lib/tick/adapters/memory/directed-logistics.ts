import type {
  DirectedLogisticsWorld,
  SystemLogisticsRow,
  LogisticsMarketUpdate,
  LogisticsFlowInsert,
  LogisticsContractCreate,
  ExpiredLogisticsContract,
} from "@/lib/tick/world/directed-logistics-world";

/** In-memory DirectedLogisticsWorld for unit tests + the simulator. Captures writes for assertions. */
export class MemoryDirectedLogisticsWorld implements DirectedLogisticsWorld {
  readonly stockUpdates = new Map<string, number>();
  readonly flows: LogisticsFlowInsert[] = [];
  readonly createdContracts: LogisticsContractCreate[] = [];
  readonly closedContractIds: string[] = [];

  constructor(
    private readonly systems: SystemLogisticsRow[],
    private readonly expiredContracts: ExpiredLogisticsContract[] = [],
  ) {}

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

  async createLogisticsContracts(rows: LogisticsContractCreate[]): Promise<void> {
    this.createdContracts.push(...rows);
  }

  // The faction/tick filter is the Prisma adapter's job (integration-tested); the memory
  // adapter just returns its seeded list so the body's haul logic can be unit-tested.
  async takeExpiredLogisticsContracts(
    _tick: number,
    _factionKeys: Array<string | null>,
  ): Promise<ExpiredLogisticsContract[]> {
    return this.expiredContracts;
  }

  async closeLogisticsContracts(ids: string[]): Promise<void> {
    this.closedContractIds.push(...ids);
  }
}
