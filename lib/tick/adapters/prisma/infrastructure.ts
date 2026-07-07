import type { Prisma } from "@/app/generated/prisma/client";
import type {
  InfrastructureWorld,
  InfrastructureStateView,
  BuildingCountUpdate,
  PopCapUpdate,
} from "@/lib/tick/world/infrastructure-world";

/**
 * Live-game adapter for the infrastructure-decay processor. Reads the building
 * roster + population + unrest, then bulk-writes downward-only count decays and the
 * recomputed popCap via `unnest()` SQL (same pattern as the economy/migration
 * adapters). `count` is set with LEAST(current, new) so a write can only ever lower
 * it; NaN/Infinity are guarded before raw SQL (PG aborts the tx on them).
 */
export class PrismaInfrastructureWorld implements InfrastructureWorld {
  constructor(private tx: Prisma.TransactionClient) {}

  async getInfrastructureState(systemIds: string[]): Promise<InfrastructureStateView[]> {
    if (systemIds.length === 0) return [];
    const [systems, buildingRows] = await Promise.all([
      this.tx.starSystem.findMany({
        where: { id: { in: systemIds } },
        select: { id: true, population: true, unrest: true },
      }),
      this.tx.systemBuilding.findMany({
        where: { systemId: { in: systemIds } },
        select: { systemId: true, buildingType: true, count: true },
      }),
    ]);
    const buildingsBySystem = new Map<string, Record<string, number>>();
    for (const b of buildingRows) {
      const map = buildingsBySystem.get(b.systemId) ?? {};
      map[b.buildingType] = b.count;
      buildingsBySystem.set(b.systemId, map);
    }
    return systems.map((s) => ({
      systemId: s.id,
      population: s.population,
      unrest: s.unrest,
      buildings: buildingsBySystem.get(s.id) ?? {},
    }));
  }

  async applyBuildingDecays(updates: BuildingCountUpdate[]): Promise<void> {
    if (updates.length === 0) return;
    const sysIds = updates.map((u) => u.systemId);
    const types = updates.map((u) => u.buildingType);
    const counts = updates.map((u) => (isFinite(u.count) ? Math.max(0, u.count) : 0));
    await this.tx.$executeRaw`
      UPDATE "SystemBuilding" AS sb
      SET "count" = LEAST(sb."count", batch."count")
      FROM unnest(${sysIds}::text[], ${types}::text[], ${counts}::double precision[])
        AS batch("systemId", "buildingType", "count")
      WHERE sb."systemId" = batch."systemId" AND sb."buildingType" = batch."buildingType"`;
  }

  async applyPopCapUpdates(updates: PopCapUpdate[]): Promise<void> {
    if (updates.length === 0) return;
    const ids = updates.map((u) => u.systemId);
    const popCaps = updates.map((u) => (isFinite(u.popCap) ? Math.max(0, u.popCap) : 0));
    await this.tx.$executeRaw`
      UPDATE "StarSystem" AS ss
      SET "popCap" = batch."popCap"
      FROM unnest(${ids}::text[], ${popCaps}::double precision[])
        AS batch("id", "popCap")
      WHERE ss."id" = batch."id"`;
  }
}
