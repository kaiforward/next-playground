/**
 * Integration test helpers — database lifecycle for test suites.
 *
 * Usage in test files:
 * ```ts
 * const { prisma } = useIntegrationDb();
 * ```
 */
import { Prisma, PrismaClient } from "@/app/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// ── Singleton test client ────────────────────────────────────────

let testPrisma: PrismaClient | null = null;

export function getTestPrisma(): PrismaClient {
  if (testPrisma) return testPrisma;

  const url = process.env["DATABASE_URL"];
  if (!url) throw new Error("DATABASE_URL not set for integration tests");
  if (!url.includes("_test")) {
    throw new Error("DATABASE_URL must point to a test database (contain '_test')");
  }

  const adapter = new PrismaPg({ connectionString: url });
  testPrisma = new PrismaClient({ adapter });
  return testPrisma;
}

// ── Table truncation ─────────────────────────────────────────────

/** All Prisma model table names in FK-safe truncation order. */
const ALL_TABLES = [
  "PlayerNotification",
  "EventModifier",
  "TradeHistory",
  "PriceHistory",
  "CargoItem",
  "ShipUpgradeSlot",
  "ConvoyMember",
  "Battle",
  "Mission",
  "TradeMission",
  "GameEvent",
  "StationMarket",
  "Station",
  "SystemTrait",
  "SystemConnection",
  "Ship",
  "Convoy",
  "StarSystem",
  "Region",
  "Good",
  "GameWorld",
  "Player",
  "Session",
  "Account",
  "VerificationToken",
  "User",
];

/** TRUNCATE all tables with CASCADE — fast, FK-safe reset. */
export async function truncateAll(prisma: PrismaClient): Promise<void> {
  const tableList = Prisma.raw(ALL_TABLES.map((t) => `"${t}"`).join(", "));
  await prisma.$executeRaw`TRUNCATE ${tableList} CASCADE`;
}

// ── Lifecycle hook for describe blocks ───────────────────────────

/**
 * Call inside a `describe()` to get a managed test Prisma client.
 * - `beforeEach`: truncates all tables
 * - `afterAll`: disconnects the client
 */
export function useIntegrationDb() {
  const prisma = getTestPrisma();

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    testPrisma = null;
  });

  return { prisma };
}
