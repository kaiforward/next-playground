import { describe, it, expect, vi, beforeEach } from "vitest";
import { useIntegrationDb } from "@/lib/test-utils/integration";
import { seedTestUniverse } from "@/lib/test-utils/fixtures";

const { prisma } = useIntegrationDb();
vi.mock("@/lib/prisma", () => ({ prisma }));

const { getProsperityBySystem } = await import("@/lib/services/prosperity");

describe("getProsperityBySystem (integration)", () => {
  beforeEach(async () => {
    await seedTestUniverse(prisma);
  });

  it("returns one entry per seeded system with a systemId and numeric prosperity", async () => {
    const systemCount = await prisma.starSystem.count();
    const entries = await getProsperityBySystem();

    expect(entries.length).toBe(systemCount);
    expect(systemCount).toBeGreaterThan(0);
    for (const e of entries) {
      expect(typeof e.systemId).toBe("string");
      expect(e.systemId.length).toBeGreaterThan(0);
      expect(typeof e.prosperity).toBe("number");
      expect(Number.isFinite(e.prosperity)).toBe(true);
    }
  });

  it("reflects the persisted prosperity value for a system", async () => {
    const target = await prisma.starSystem.findFirstOrThrow();
    await prisma.starSystem.update({
      where: { id: target.id },
      data: { prosperity: 0.5 },
    });

    const entries = await getProsperityBySystem();
    const updated = entries.find((e) => e.systemId === target.id);

    expect(updated).toBeDefined();
    expect(updated?.prosperity).toBe(0.5);
  });
});
