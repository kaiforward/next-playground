import { describe, it, expect, beforeEach, vi } from "vitest";
import { useIntegrationDb } from "@/lib/test-utils/integration";
import { seedTestUniverse } from "@/lib/test-utils/fixtures";
import type { TestUniverse } from "@/lib/test-utils/fixtures";

const { prisma } = useIntegrationDb();
vi.mock("@/lib/prisma", () => ({ prisma }));

// Imported after the prisma mock so any module-level prisma resolves to the integration client.
const { PrismaDirectedBuildWorld } = await import("@/lib/tick/adapters/prisma/directed-build");

describe("PrismaDirectedBuildWorld (integration)", () => {
  let universe: TestUniverse;

  beforeEach(async () => {
    universe = await seedTestUniverse(prisma);
  });

  it("getSystemsForFactions reads persisted capacity columns into SystemBuildRow", async () => {
    const sysId = universe.systems.industrial;
    await prisma.starSystem.update({
      where: { id: sysId },
      data: { generalSpace: 100, habitableSpace: 40, slotArable: 7 },
    });
    const { factionId } = await prisma.starSystem.findUniqueOrThrow({
      where: { id: sysId },
      select: { factionId: true },
    });

    const rows = await prisma.$transaction((tx) =>
      new PrismaDirectedBuildWorld(tx).getSystemsForFactions([factionId]),
    );

    const row = rows.find((r) => r.systemId === sysId);
    expect(row).toBeDefined();
    if (!row) return; // narrow for TS; the expect above is the real assertion
    expect(row.generalSpace).toBe(100);
    expect(row.habitableSpace).toBe(40);
    expect(row.slotCap.arable).toBe(7);
    // Markets + buildings still assembled (mirrors logistics).
    expect(Array.isArray(row.markets)).toBe(true);
    expect(typeof row.buildings).toBe("object");
  });

  it("applyBuildingIncreases UPDATES an existing row and INSERTS a brand-new (system,type) pair", async () => {
    const sysId = universe.systems.industrial;
    // Existing food row at count 2; guarantee NO water row exists.
    await prisma.systemBuilding.upsert({
      where: { systemId_buildingType: { systemId: sysId, buildingType: "food" } },
      create: { systemId: sysId, buildingType: "food", count: 2 },
      update: { count: 2 },
    });
    await prisma.systemBuilding.deleteMany({ where: { systemId: sysId, buildingType: "water" } });

    await prisma.$transaction((tx) =>
      new PrismaDirectedBuildWorld(tx).applyBuildingIncreases([
        { systemId: sysId, buildingType: "food", count: 5 },   // existing → UPDATE to absolute 5
        { systemId: sysId, buildingType: "water", count: 3 },  // new → INSERT count 3
      ]),
    );

    const food = await prisma.systemBuilding.findUniqueOrThrow({
      where: { systemId_buildingType: { systemId: sysId, buildingType: "food" } },
      select: { count: true },
    });
    const water = await prisma.systemBuilding.findUniqueOrThrow({
      where: { systemId_buildingType: { systemId: sysId, buildingType: "water" } },
      select: { count: true },
    });
    expect(food.count).toBe(5);
    expect(water.count).toBe(3);
  });

  it("applyBuildingIncreases clamps non-finite / negative counts to 0", async () => {
    const sysId = universe.systems.tech;
    await prisma.systemBuilding.upsert({
      where: { systemId_buildingType: { systemId: sysId, buildingType: "food" } },
      create: { systemId: sysId, buildingType: "food", count: 9 },
      update: { count: 9 },
    });

    await prisma.$transaction((tx) =>
      new PrismaDirectedBuildWorld(tx).applyBuildingIncreases([
        { systemId: sysId, buildingType: "food", count: Number.NaN },
      ]),
    );

    const food = await prisma.systemBuilding.findUniqueOrThrow({
      where: { systemId_buildingType: { systemId: sysId, buildingType: "food" } },
      select: { count: true },
    });
    expect(food.count).toBe(0);
  });
});
