import { mergeGlobalEvents } from "@/lib/tick/helpers";
import type {
  EconomyTickPayload,
  EventNotificationPayload,
  GlobalEventMap,
  TickProcessorResult,
} from "@/lib/tick/types";

function economyTick(shardIndex: number): EconomyTickPayload {
  return { systemCount: 10, shardIndex, shardCount: 24 };
}

function eventNotification(message: string): EventNotificationPayload {
  return { message, type: "trade_festival", refs: {} };
}

describe("mergeGlobalEvents", () => {
  it("initialises and then appends economyTick entries in order", () => {
    const target: Partial<GlobalEventMap> = {};

    mergeGlobalEvents(target, { globalEvents: { economyTick: [economyTick(0)] } });
    expect(target.economyTick).toEqual([economyTick(0)]);

    mergeGlobalEvents(target, { globalEvents: { economyTick: [economyTick(1)] } });
    expect(target.economyTick).toEqual([economyTick(0), economyTick(1)]);
  });

  it("initialises and then appends eventNotifications entries in order", () => {
    const target: Partial<GlobalEventMap> = {};

    mergeGlobalEvents(target, { globalEvents: { eventNotifications: [eventNotification("first")] } });
    expect(target.eventNotifications).toEqual([eventNotification("first")]);

    mergeGlobalEvents(target, { globalEvents: { eventNotifications: [eventNotification("second")] } });
    expect(target.eventNotifications).toEqual([eventNotification("first"), eventNotification("second")]);
  });

  it("leaves target untouched when the result carries no globalEvents", () => {
    const target: Partial<GlobalEventMap> = { economyTick: [economyTick(0)] };
    const result: TickProcessorResult = {};

    mergeGlobalEvents(target, result);

    expect(target).toEqual({ economyTick: [economyTick(0)] });
  });
});
