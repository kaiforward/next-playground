import type { TickProcessorResult, GlobalEventMap } from "./types";

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
  if (src.shipArrived) {
    target.shipArrived = target.shipArrived ? [...target.shipArrived, ...src.shipArrived] : [...src.shipArrived];
  }
}
