import type {
  MarketView,
  PriceHistoryView,
  SnapshotsWorld,
} from "@/lib/tick/world/snapshots-world";
import type { PriceHistoryEntry } from "@/lib/engine/snapshot";

/**
 * In-memory adapter for the price-snapshots processor. Used by unit tests
 * today; the simulator does not yet track price history, so this adapter
 * holds its own state rather than referencing a SimWorld slice.
 *
 * The state shape matches the live game: one history row per system,
 * pre-created in the constructor (`systemIds`). The processor only updates
 * existing rows — it never creates new ones. Writes to unknown systems are
 * silently dropped, matching the Prisma adapter.
 */
export class InMemorySnapshotsWorld implements SnapshotsWorld {
  private histories: Map<string, PriceHistoryEntry[]>;

  constructor(
    private markets: MarketView[],
    systemIds: string[],
  ) {
    this.histories = new Map(systemIds.map((id) => [id, []]));
  }

  getMarketsForSystems(systemIds: string[]): Promise<MarketView[]> {
    const ids = new Set(systemIds);
    return Promise.resolve(
      this.markets.filter((m) => ids.has(m.systemId)).map((m) => ({ ...m })),
    );
  }

  getPriceHistoriesForSystems(systemIds: string[]): Promise<PriceHistoryView[]> {
    const ids = new Set(systemIds);
    const views: PriceHistoryView[] = [];
    for (const [systemId, entries] of this.histories) {
      if (!ids.has(systemId)) continue;
      views.push({ systemId, entries: entries.map((e) => ({ ...e })) });
    }
    return Promise.resolve(views);
  }

  writePriceHistories(views: PriceHistoryView[]): Promise<void> {
    for (const v of views) {
      if (!this.histories.has(v.systemId)) continue;
      this.histories.set(v.systemId, v.entries);
    }
    return Promise.resolve();
  }

  /** Test helper — direct access to current state. */
  snapshot(systemId: string): PriceHistoryEntry[] | undefined {
    return this.histories.get(systemId);
  }
}
