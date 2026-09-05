import { describe, it, expect, vi, afterEach } from "vitest";
import { ConnectionLayer } from "../connection-layer";
import { ConnectionObject } from "../../objects/connection-object";
import type { ConnectionData, SystemNodeData } from "@/lib/hooks/use-map-data";

function sys(id: string): SystemNodeData {
  return {
    id, x: 0, y: 0, name: id, economyType: "agricultural", sunClass: "yellow",
    settlementMark: null, regionId: "r1", isGateway: false, visibility: "visible",
  };
}

function conn(overrides: Partial<ConnectionData> & { id: string; fromId: string; toId: string }): ConnectionData {
  return {
    fuelCost: 1,
    laneKey: `${overrides.fromId}|${overrides.toId}`,
    level: 0,
    load: 0,
    blocked: false,
    investorFactionId: null,
    band: "fine",
    ...overrides,
  };
}

const SYSTEMS = [sys("a"), sys("b"), sys("c")];

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ConnectionLayer.update — the congested pulse touches only congested lanes", () => {
  it("advances the pulse on the congested lane and never on the fine one", () => {
    const layer = new ConnectionLayer();
    layer.setMode("lanes", null);
    layer.sync(
      [
        conn({ id: "a-b", fromId: "a", toId: "b", band: "fine" }),
        conn({ id: "a-c", fromId: "a", toId: "c", band: "congested" }),
      ],
      SYSTEMS,
    );

    const pulseSpy = vi.spyOn(ConnectionObject.prototype, "setPulseAlpha");
    layer.update(16);

    expect(pulseSpy).toHaveBeenCalledTimes(1);
  });

  it("does nothing outside lanes mode, even with a congested lane in the data", () => {
    const layer = new ConnectionLayer();
    layer.setMode("political", null);
    layer.sync([conn({ id: "a-c", fromId: "a", toId: "c", band: "congested" })], SYSTEMS);

    const pulseSpy = vi.spyOn(ConnectionObject.prototype, "setPulseAlpha");
    layer.update(16);

    expect(pulseSpy).not.toHaveBeenCalled();
  });

  it("clears a lane's pulse once it stops being congested (a stale re-sync doesn't leave it lit)", () => {
    const layer = new ConnectionLayer();
    layer.setMode("lanes", null);
    layer.sync([conn({ id: "a-c", fromId: "a", toId: "c", band: "congested" })], SYSTEMS);

    const pulseSpy = vi.spyOn(ConnectionObject.prototype, "setPulseAlpha");
    layer.sync([conn({ id: "a-c", fromId: "a", toId: "c", band: "fine" })], SYSTEMS);
    expect(pulseSpy).toHaveBeenCalledWith(0);

    pulseSpy.mockClear();
    layer.update(16);
    expect(pulseSpy).not.toHaveBeenCalled();
  });
});
