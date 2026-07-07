import { mergeGlobalEvents } from "@/lib/tick/helpers";
import type {
  EconomyTickPayload,
  EventNotificationPayload,
  GlobalEventMap,
  ShipArrivedPayload,
  TickProcessorResult,
} from "@/lib/tick/types";

function economyTick(shardIndex: number): EconomyTickPayload {
  return { systemCount: 10, shardIndex, shardCount: 24 };
}

function eventNotification(message: string): EventNotificationPayload {
  return { message, type: "trade_festival", refs: {} };
}

function shipArrived(shipId: string): ShipArrivedPayload {
  return { shipId, shipName: shipId, systemId: "s1", destName: "Sol" };
}

describe("mergeGlobalEvents", () => {
  it("initializes and then appends economyTick entries in order", () => {
    const target: Partial<GlobalEventMap> = {};

    mergeGlobalEvents(target, { globalEvents: { economyTick: [economyTick(0)] } });
    expect(target.economyTick).toEqual([economyTick(0)]);

    mergeGlobalEvents(target, { globalEvents: { economyTick: [economyTick(1)] } });
    expect(target.economyTick).toEqual([economyTick(0), economyTick(1)]);
  });

  it("initializes and then appends eventNotifications entries in order", () => {
    const target: Partial<GlobalEventMap> = {};

    mergeGlobalEvents(target, { globalEvents: { eventNotifications: [eventNotification("first")] } });
    expect(target.eventNotifications).toEqual([eventNotification("first")]);

    mergeGlobalEvents(target, { globalEvents: { eventNotifications: [eventNotification("second")] } });
    expect(target.eventNotifications).toEqual([eventNotification("first"), eventNotification("second")]);
  });

  it("initializes and then appends shipArrived entries in order", () => {
    const target: Partial<GlobalEventMap> = {};

    mergeGlobalEvents(target, { globalEvents: { shipArrived: [shipArrived("ship-1")] } });
    expect(target.shipArrived).toEqual([shipArrived("ship-1")]);

    mergeGlobalEvents(target, { globalEvents: { shipArrived: [shipArrived("ship-2")] } });
    expect(target.shipArrived).toEqual([shipArrived("ship-1"), shipArrived("ship-2")]);
  });

  it("leaves target untouched when the result carries no globalEvents", () => {
    const target: Partial<GlobalEventMap> = { economyTick: [economyTick(0)] };
    const result: TickProcessorResult = {};

    mergeGlobalEvents(target, result);

    expect(target).toEqual({ economyTick: [economyTick(0)] });
  });
});
