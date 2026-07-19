import type { WorldFactionTreasury } from "@/lib/world/types";
import type { TreasuryWorld, TreasuryFactionSystemRow } from "@/lib/tick/world/treasury-world";

export class InMemoryTreasuryWorld implements TreasuryWorld {
  treasuries: WorldFactionTreasury[];
  systems: TreasuryFactionSystemRow[];

  constructor(initial: { treasuries: WorldFactionTreasury[]; systems: TreasuryFactionSystemRow[] }) {
    this.treasuries = initial.treasuries.map((t) => ({ ...t }));
    this.systems = initial.systems.map((s) => ({ ...s, buildings: { ...s.buildings } }));
  }

  getTreasuries(): Promise<WorldFactionTreasury[]> {
    return Promise.resolve(this.treasuries);
  }

  getFactionSystems(): Promise<TreasuryFactionSystemRow[]> {
    return Promise.resolve(this.systems);
  }

  applyTreasuryUpdates(updates: WorldFactionTreasury[]): Promise<void> {
    const byFaction = new Map(updates.map((u) => [u.factionId, u]));
    this.treasuries = this.treasuries.map((t) => byFaction.get(t.factionId) ?? t);
    return Promise.resolve();
  }
}
