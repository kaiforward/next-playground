import { createNotifications } from "@/lib/services/notifications";
import type { ModifierRow } from "@/lib/engine/events";
import type { TxClient, TickProcessorResult, GlobalEventMap, PlayerEventMap, GameNotificationPayload } from "./types";

/**
 * Add a notification to a player's event map. Gets or creates the player entry
 * and appends the notification to `gameNotifications`.
 */
export function addPlayerNotification(
  playerEvents: Map<string, Partial<PlayerEventMap>>,
  playerId: string,
  notification: GameNotificationPayload,
): void {
  const existing = playerEvents.get(playerId) ?? {};
  existing.gameNotifications = existing.gameNotifications
    ? [...existing.gameNotifications, notification]
    : [notification];
  playerEvents.set(playerId, existing);
}

/**
 * Group an array of modifier rows by their targetId for quick lookup.
 * Modifiers with null targetId are skipped.
 */
export function groupModifiersByTarget(modifiers: ModifierRow[]): Map<string, ModifierRow[]> {
  const grouped = new Map<string, ModifierRow[]>();
  for (const mod of modifiers) {
    if (!mod.targetId) continue;
    const existing = grouped.get(mod.targetId) ?? [];
    existing.push(mod);
    grouped.set(mod.targetId, existing);
  }
  return grouped;
}

/**
 * Persist all gameNotifications from player events to the database.
 * Replaces identical extraction blocks across 4 processors.
 */
export async function persistPlayerNotifications(
  tx: TxClient,
  playerEvents: Map<string, Partial<PlayerEventMap>>,
  tick: number,
): Promise<void> {
  const entries: Array<GameNotificationPayload & { playerId: string; tick: number }> = [];

  for (const [playerId, events] of playerEvents) {
    const notifications = events.gameNotifications;
    if (!notifications) continue;
    for (const n of notifications) {
      entries.push({
        playerId,
        type: n.type,
        message: n.message,
        refs: n.refs,
        tick,
      });
    }
  }

  await createNotifications(tx, entries);
}

/**
 * Merge global events from a single processor result into a target accumulator.
 */
export function mergeGlobalEvents(
  target: Partial<GlobalEventMap>,
  result: TickProcessorResult,
): void {
  if (!result.globalEvents) return;
  const src = result.globalEvents;
  if (src.economyTick) {
    target.economyTick = target.economyTick ? [...target.economyTick, ...src.economyTick] : [...src.economyTick];
  }
  if (src.eventNotifications) {
    target.eventNotifications = target.eventNotifications ? [...target.eventNotifications, ...src.eventNotifications] : [...src.eventNotifications];
  }
  if (src.priceSnapshot) {
    target.priceSnapshot = target.priceSnapshot ? [...target.priceSnapshot, ...src.priceSnapshot] : [...src.priceSnapshot];
  }
  if (src.missionsUpdated) {
    target.missionsUpdated = target.missionsUpdated ? [...target.missionsUpdated, ...src.missionsUpdated] : [...src.missionsUpdated];
  }
  if (src.opMissionsUpdated) {
    target.opMissionsUpdated = target.opMissionsUpdated ? [...target.opMissionsUpdated, ...src.opMissionsUpdated] : [...src.opMissionsUpdated];
  }
  if (src.battlesUpdated) {
    target.battlesUpdated = target.battlesUpdated ? [...target.battlesUpdated, ...src.battlesUpdated] : [...src.battlesUpdated];
  }
}

/**
 * Merge player events from a single processor result into a target accumulator.
 */
export function mergePlayerEvents(
  target: Map<string, Partial<PlayerEventMap>>,
  result: TickProcessorResult,
): void {
  if (!result.playerEvents) return;
  for (const [playerId, events] of result.playerEvents) {
    const existing = target.get(playerId) ?? {};
    if (events.shipArrived) {
      existing.shipArrived = existing.shipArrived ? [...existing.shipArrived, ...events.shipArrived] : [...events.shipArrived];
    }
    if (events.cargoLost) {
      existing.cargoLost = existing.cargoLost ? [...existing.cargoLost, ...events.cargoLost] : [...events.cargoLost];
    }
    if (events.gameNotifications) {
      existing.gameNotifications = existing.gameNotifications ? [...existing.gameNotifications, ...events.gameNotifications] : [...events.gameNotifications];
    }
    target.set(playerId, existing);
  }
}
