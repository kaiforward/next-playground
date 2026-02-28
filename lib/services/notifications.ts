import { prisma } from "@/lib/prisma";
import type { TxClient } from "@/lib/tick/types";
import type { PlayerNotificationInfo, EntityRef } from "@/lib/types/game";
import { buildPaginatedArgs, paginateResults, type PaginatedResult } from "@/lib/services/pagination";

// ── Serialization ──────────────────────────────────────────────

function serializeNotification(row: {
  id: string;
  type: string;
  message: string;
  refs: string;
  tick: number;
  read: boolean;
  createdAt: Date;
}): PlayerNotificationInfo {
  let refs: Partial<Record<string, EntityRef>> = {};
  try {
    refs = JSON.parse(row.refs);
  } catch {
    // malformed JSON — use empty refs
  }

  return {
    id: row.id,
    type: row.type as PlayerNotificationInfo["type"],
    message: row.message,
    refs,
    tick: row.tick,
    read: row.read,
    createdAt: row.createdAt.toISOString(),
  };
}

// ── Write operations (used by tick processors) ─────────────────

/** Create a notification inside an existing transaction. */
export async function createNotification(
  tx: TxClient,
  playerId: string,
  type: string,
  message: string,
  refs: Partial<Record<string, EntityRef>>,
  tick: number,
): Promise<void> {
  await tx.playerNotification.create({
    data: {
      playerId,
      type,
      message,
      refs: JSON.stringify(refs),
      tick,
    },
  });
}

/** Batch-create notifications inside an existing transaction. */
export async function createNotifications(
  tx: TxClient,
  entries: Array<{
    playerId: string;
    type: string;
    message: string;
    refs: Partial<Record<string, EntityRef>>;
    tick: number;
  }>,
): Promise<void> {
  if (entries.length === 0) return;
  await tx.playerNotification.createMany({
    data: entries.map((e) => ({
      playerId: e.playerId,
      type: e.type,
      message: e.message,
      refs: JSON.stringify(e.refs),
      tick: e.tick,
    })),
  });
}

// ── Read operations (used by API routes) ───────────────────────

interface GetNotificationsOpts {
  cursor?: string;
  limit?: number;
  types?: string[];
  search?: string;
  unreadOnly?: boolean;
}

export async function getNotifications(
  playerId: string,
  opts: GetNotificationsOpts = {},
): Promise<PaginatedResult<PlayerNotificationInfo>> {
  const baseWhere: Record<string, unknown> = { playerId };
  if (opts.types && opts.types.length > 0) {
    baseWhere.type = { in: opts.types };
  }
  if (opts.unreadOnly) {
    baseWhere.read = false;
  }
  if (opts.search) {
    baseWhere.message = { contains: opts.search };
  }

  const args = buildPaginatedArgs(
    { cursor: opts.cursor, limit: opts.limit ?? 20 },
    baseWhere,
    "createdAt",
    "desc",
  );

  const [rows, total] = await Promise.all([
    prisma.playerNotification.findMany({
      where: args.where,
      orderBy: args.orderBy,
      take: args.take,
      skip: args.skip,
      cursor: args.cursor,
    }),
    prisma.playerNotification.count({ where: args.where }),
  ]);

  const result = paginateResults(rows, total, args.take - 1);
  return {
    items: result.items.map(serializeNotification),
    nextCursor: result.nextCursor,
    total: result.total,
  };
}

export async function getUnreadCount(playerId: string): Promise<number> {
  return prisma.playerNotification.count({
    where: { playerId, read: false },
  });
}

export async function markAsRead(
  playerId: string,
  beforeId?: string,
): Promise<number> {
  const where: Record<string, unknown> = { playerId, read: false };

  if (beforeId) {
    const cursor = await prisma.playerNotification.findUnique({
      where: { id: beforeId },
      select: { createdAt: true },
    });
    if (cursor) {
      where.createdAt = { lte: cursor.createdAt };
    }
  }

  const result = await prisma.playerNotification.updateMany({
    where,
    data: { read: true },
  });
  return result.count;
}

// ── Pruning (used by prune processor) ──────────────────────────

export async function pruneOldNotifications(
  tx: TxClient,
  maxAgeTicks: number,
  currentTick: number,
): Promise<number> {
  const cutoff = currentTick - maxAgeTicks;
  const result = await tx.playerNotification.deleteMany({
    where: { tick: { lt: cutoff } },
  });
  return result.count;
}

