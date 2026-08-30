import { mergeGlobalEvents } from "@/lib/tick/helpers";
import type {
  EconomyTickPayload,
  GlobalEventMap,
  TickProcessorResult,
} from "@/lib/tick/types";

function economyTick(shardIndex: number): EconomyTickPayload {
  return { systemCount: 10, shardIndex, shardCount: 24 };
}

describe("mergeGlobalEvents", () => {
  it("initialises and then appends economyTick entries in order", () => {
    const target: Partial<GlobalEventMap> = {};

    mergeGlobalEvents(target, { globalEvents: { economyTick: [economyTick(0)] } });
    expect(target.economyTick).toEqual([economyTick(0)]);

    mergeGlobalEvents(target, { globalEvents: { economyTick: [economyTick(1)] } });
    expect(target.economyTick).toEqual([economyTick(0), economyTick(1)]);
  });

  it("leaves target untouched when the result carries no globalEvents", () => {
    const target: Partial<GlobalEventMap> = { economyTick: [economyTick(0)] };
    const result: TickProcessorResult = {};

    mergeGlobalEvents(target, result);

    expect(target).toEqual({ economyTick: [economyTick(0)] });
  });
});
