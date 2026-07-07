import type { Prisma } from "@/app/generated/prisma/client";
import type { EdgeView } from "@/lib/tick/world/trade-flow-world";
import type {
  MigrationDelta, MigrationNodeView, MigrationWorld,
} from "@/lib/tick/world/migration-world";
import { getOpenEdges } from "@/lib/services/topology";

/** Live-game adapter for the migration processor. Bulk writes via unnest(). */
export class PrismaMigrationWorld implements MigrationWorld {
  constructor(private tx: Prisma.TransactionClient) {}

  getOpenEdges(): Promise<EdgeView[]> {
    return getOpenEdges();
  }

  async getNodesForSystems(systemIds: string[]): Promise<MigrationNodeView[]> {
    if (systemIds.length === 0) return [];
    const rows = await this.tx.starSystem.findMany({
      where: { id: { in: systemIds } },
      select: { id: true, population: true, popCap: true, unrest: true },
    });
    return rows.map((r) => ({ systemId: r.id, population: r.population, popCap: r.popCap, unrest: r.unrest }));
  }

  async applyMigrationDeltas(deltas: MigrationDelta[]): Promise<void> {
    if (deltas.length === 0) return;
    const ids = deltas.map((d) => d.systemId);
    const amounts = deltas.map((d) => (isFinite(d.delta) ? d.delta : 0));
    await this.tx.$executeRaw`
      UPDATE "StarSystem" AS ss
      SET "population" = GREATEST(0, ss."population" + batch."delta")
      FROM unnest(${ids}::text[], ${amounts}::double precision[])
        AS batch("id", "delta")
      WHERE ss."id" = batch."id"`;
  }
}
