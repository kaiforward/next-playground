import { PrismaClient } from "@/app/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

function createPrismaClient() {
  const adapter = new PrismaBetterSqlite3({
    url: process.env.DATABASE_URL ?? "file:./dev.db",
  });
  const client = new PrismaClient({ adapter });
  // Enable WAL mode so readers don't block on tick transaction writes.
  // Persistent once set — survives restarts.
  client.$executeRawUnsafe("PRAGMA journal_mode=WAL").catch(() => {});
  return client;
}

export const prisma = globalThis.__prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalThis.__prisma = prisma;
