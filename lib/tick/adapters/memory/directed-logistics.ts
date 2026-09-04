import type {
  DirectedLogisticsWorld,
  SystemLogisticsRow,
  LogisticsMarketUpdate,
  LogisticsFundingBoundUpdate,
  UnservedShortfallUpdate,
  LaneLoadUpdate,
  PendingArrivalInsert,
} from "@/lib/tick/world/directed-logistics-world";
import { factionShardKeys } from "@/lib/engine/shard-order";

/** The DirectedLogisticsWorld adapter — the only backend. Captures writes for assertions. */
export class MemoryDirectedLogisticsWorld implements DirectedLogisticsWorld {
  readonly stockUpdates = new Map<string, number>();
  readonly fundingBoundUpdates = new Map<string, boolean>();
  /** Market id → this run's structural-shortfall level: positive means unservable, 0 means the row
   *  was assessed servable and the world layer should clear the key. Absent means untouched. */
  readonly unservedShortfallUpdates = new Map<string, number>();
  /** laneKey → this run's booked/blocked load, written for every lane in the network. */
  readonly laneUpdates = new Map<string, { bookedLoad: number; blockedVolume: number }>();
  readonly pendingArrivals: PendingArrivalInsert[] = [];

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

  async applyUnservedShortfallUpdates(updates: UnservedShortfallUpdate[]): Promise<void> {
    for (const u of updates) this.unservedShortfallUpdates.set(u.id, u.unservedShortfall);
  }

  async applyLaneLoadUpdates(updates: LaneLoadUpdate[]): Promise<void> {
    for (const u of updates) this.laneUpdates.set(u.key, { bookedLoad: u.bookedLoad, blockedVolume: u.blockedVolume });
  }

  async appendPendingArrivals(arrivals: PendingArrivalInsert[]): Promise<void> {
    this.pendingArrivals.push(...arrivals);
  }
}
