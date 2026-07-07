import type { Prisma } from "@/app/generated/prisma/client";
import type {
  DirectedBuildWorld,
  SystemBuildRow,
  BuildBuildingUpdate,
} from "@/lib/tick/world/directed-build-world";
import { GOOD_NAME_TO_KEY } from "@/lib/constants/goods";
import { resourceVectorFromColumns } from "@/lib/engine/resources";

/**
 * Live-game adapter for the directed-build processor. Mirrors
 * PrismaDirectedLogisticsWorld (per-faction sharded reads, identical market
 * assembly), with two divergences: it also reads the body-derived capacity
 * columns persisted on StarSystem (generalSpace / habitableSpace / slot*), and
 * its write INCREMENTS building counts.
 *
 * Write path: SystemBuilding rows exist only for count>0 (the seed filters
 * them), so a system building its FIRST unit of a type has no row. New
 * (systemId,buildingType) pairs are INSERTed via createMany (Prisma generates
 * the cuid id — a raw INSERT can't, since @default(cuid()) is client-side, not a
 * DB default); existing pairs are bulk-UPDATEd via unnest(). Counts are
 * continuous Float; the only write policy is the finite/non-negative guard (PG
 * aborts the tx on NaN/Infinity).
 *
 * Imports are TYPES + pure helpers only (never @/lib/prisma), so the processor
 * file that imports this class stays unit-loadable without a DATABASE_URL.
 */
export class PrismaDirectedBuildWorld implements DirectedBuildWorld {
  constructor(private readonly tx: Prisma.TransactionClient) {}

  async getFactionShardKeys(): Promise<Array<string | null>> {
    const rows = await this.tx.starSystem.findMany({
      distinct: ["factionId"],
      select: { factionId: true },
    });
    // Stable deterministic order so the shard split is consistent across ticks.
    // null (independents) sorts last. (Verbatim from PrismaDirectedLogisticsWorld.)
    return rows
      .map((r) => r.factionId)
      .sort((a, b) => (a === null ? 1 : b === null ? -1 : a.localeCompare(b)));
  }

  async getSystemsForFactions(
    factionKeys: Array<string | null>,
  ): Promise<SystemBuildRow[]> {
    if (factionKeys.length === 0) return [];

    const ids = factionKeys.filter((k): k is string => k !== null);
    const includeNull = factionKeys.some((k) => k === null);

    const where: Prisma.StarSystemWhereInput =
      includeNull && ids.length > 0
        ? { OR: [{ factionId: { in: ids } }, { factionId: null }] }
        : includeNull
          ? { factionId: null }
          : { factionId: { in: ids } };

    // Pull columns + buildings separately to avoid the concurrent sub-query
    // issue (CLAUDE.md pg gotcha). relationLoadStrategy: "join" consolidates the
    // station→markets sibling relation into a single LATERAL JOIN.
    const [systems, buildingRows] = await Promise.all([
      this.tx.starSystem.findMany({
        where,
        relationLoadStrategy: "join",
        select: {
          id: true,
          factionId: true,
          population: true,
          unrest: true,
          generalSpace: true,
          habitableSpace: true,
          slotGas: true,
          slotMinerals: true,
          slotOre: true,
          slotBiomass: true,
          slotArable: true,
          slotWater: true,
          slotRadioactive: true,
          yieldGas: true,
          yieldMinerals: true,
          yieldOre: true,
          yieldBiomass: true,
          yieldArable: true,
          yieldWater: true,
          yieldRadioactive: true,
          station: {
            select: {
              markets: {
                select: {
                  id: true,
                  stock: true,
                  anchorMult: true,
                  demandRate: true,
                  storageCapacity: true,
                  good: {
                    select: {
                      name: true,
                      basePrice: true,
                      priceFloor: true,
                      priceCeiling: true,
                    },
                  },
                },
              },
            },
          },
        },
      }),
      this.tx.systemBuilding.findMany({
        where: { system: where },
        select: { systemId: true, buildingType: true, count: true },
      }),
    ]);

    const buildingsBySystem = new Map<string, Record<string, number>>();
    for (const b of buildingRows) {
      const map = buildingsBySystem.get(b.systemId) ?? {};
      map[b.buildingType] = b.count;
      buildingsBySystem.set(b.systemId, map);
    }

    return systems.map((s): SystemBuildRow => {
      const buildings = buildingsBySystem.get(s.id) ?? {};

      const yields = resourceVectorFromColumns(
        {
          yieldGas: s.yieldGas,
          yieldMinerals: s.yieldMinerals,
          yieldOre: s.yieldOre,
          yieldBiomass: s.yieldBiomass,
          yieldArable: s.yieldArable,
          yieldWater: s.yieldWater,
          yieldRadioactive: s.yieldRadioactive,
        },
        "yield",
      );

      const slotCap = resourceVectorFromColumns(
        {
          slotGas: s.slotGas,
          slotMinerals: s.slotMinerals,
          slotOre: s.slotOre,
          slotBiomass: s.slotBiomass,
          slotArable: s.slotArable,
          slotWater: s.slotWater,
          slotRadioactive: s.slotRadioactive,
        },
        "slot",
      );

      const markets = (s.station?.markets ?? []).map((m) => ({
        id: m.id,
        goodId: GOOD_NAME_TO_KEY.get(m.good.name) ?? m.good.name,
        stock: m.stock,
        basePrice: m.good.basePrice,
        anchorMult: m.anchorMult,
        demandRate: m.demandRate,
        priceFloor: m.good.priceFloor,
        priceCeiling: m.good.priceCeiling,
        storageCapacity: m.storageCapacity,
      }));

      return {
        systemId: s.id,
        factionId: s.factionId,
        population: s.population,
        unrest: s.unrest,
        buildings,
        yields,
        slotCap,
        generalSpace: s.generalSpace,
        habitableSpace: s.habitableSpace,
        markets,
      };
    });
  }

  async applyBuildingIncreases(updates: BuildBuildingUpdate[]): Promise<void> {
    if (updates.length === 0) return;

    // Continuous Float counts. Only policy: finite + non-negative (PG aborts the
    // tx on NaN/Infinity). No rounding, no upper clamp — capacity-bounded upstream.
    const clean = updates.map((u) => ({
      systemId: u.systemId,
      buildingType: u.buildingType,
      count: Number.isFinite(u.count) ? Math.max(0, u.count) : 0,
    }));

    // Which (systemId,buildingType) rows already exist? (one bulk read). Nested
    // Set keyed by systemId — no concatenated string keys (CLAUDE.md \uXXXX note).
    // Narrowed to only the building types touched by this update to avoid pulling
    // every type for each system on the hot path.
    const systemIds = [...new Set(clean.map((u) => u.systemId))];
    const buildingTypes = [...new Set(clean.map((u) => u.buildingType))];
    const existingRows = await this.tx.systemBuilding.findMany({
      where: { systemId: { in: systemIds }, buildingType: { in: buildingTypes } },
      select: { systemId: true, buildingType: true },
    });
    const existingBySystem = new Map<string, Set<string>>();
    for (const e of existingRows) {
      const set = existingBySystem.get(e.systemId) ?? new Set<string>();
      set.add(e.buildingType);
      existingBySystem.set(e.systemId, set);
    }
    const exists = (u: { systemId: string; buildingType: string }): boolean =>
      existingBySystem.get(u.systemId)?.has(u.buildingType) ?? false;

    const toUpdate = clean.filter((u) => exists(u));
    const toInsert = clean.filter((u) => !exists(u));

    // Bulk UPDATE existing rows to the new absolute count.
    if (toUpdate.length > 0) {
      const ids = toUpdate.map((u) => u.systemId);
      const types = toUpdate.map((u) => u.buildingType);
      const counts = toUpdate.map((u) => u.count);
      await this.tx.$executeRaw`
        UPDATE "SystemBuilding" AS sb
        SET "count" = batch."count"
        FROM unnest(${ids}::text[], ${types}::text[], ${counts}::double precision[])
          AS batch("systemId", "buildingType", "count")
        WHERE sb."systemId" = batch."systemId" AND sb."buildingType" = batch."buildingType"`;
    }

    // Bulk INSERT brand-new pairs (createMany generates the cuid ids).
    if (toInsert.length > 0) {
      await this.tx.systemBuilding.createMany({
        data: toInsert.map((u) => ({
          systemId: u.systemId,
          buildingType: u.buildingType,
          count: u.count,
        })),
      });
    }
  }
}
