import { createNotifications } from "@/lib/services/notifications";
import type { TxClient, PlayerEventMap, GameNotificationPayload } from "./types";

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
