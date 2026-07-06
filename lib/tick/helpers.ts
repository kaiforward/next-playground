import type { ModifierRow } from "@/lib/engine/events";
import type { TickProcessorResult, GlobalEventMap, PlayerEventMap } from "./types";

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
    target.set(playerId, existing);
  }
}
