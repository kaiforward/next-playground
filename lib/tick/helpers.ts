import { createNotifications } from "@/lib/services/notifications";
import type { ModifierRow } from "@/lib/engine/events";
import type { TxClient, PlayerEventMap, GameNotificationPayload } from "./types";

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
