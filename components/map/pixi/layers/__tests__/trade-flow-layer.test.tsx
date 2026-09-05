import { describe, it, expect, vi, afterEach } from "vitest";
import { TradeFlowLayer, type FlowLayerConfig } from "../trade-flow-layer";
import { TradeFlowEdge } from "../../objects/trade-flow-edge";
import type { LaneBand } from "../../objects/lane-band";
import type { SystemNodeData } from "@/lib/hooks/use-map-data";
import type { TradeFlowEdgeInfo } from "@/lib/types/api";

function sys(id: string, x: number, y: number): SystemNodeData {
  return {
    id, x, y, name: id, economyType: "agricultural", sunClass: "yellow",
    settlementMark: null, regionId: "r1", isGateway: false, visibility: "visible",
  };
}

function edge(overrides: Partial<TradeFlowEdgeInfo> & Pick<TradeFlowEdgeInfo, "laneKey" | "fromSystemId" | "toSystemId">): TradeFlowEdgeInfo {
  return { totalVolume: 10, ...overrides };
}

/** No static path/arrowhead/glow — so each edge's own Pixi container holds exactly one child
 *  Graphics per particle, and its child count is a direct readout of `particleCount` through the
 *  layer's public `container` tree (no reach into the layer's private edge map). */
const CONFIG: FlowLayerConfig = {
  buildPath: (from, to) => [from, to],
  style: {
    particleRadius: 1, particleAlpha: 1, particleSpeed: 1, glowBlur: 0,
    drawPath: false, pathAlpha: 0, arrowhead: false, arrowSize: 1,
  },
  particlesPerBand: { fine: 2, busy: 5, congested: 9 },
  maxTotalParticles: 1000,
};

const SYSTEMS = [sys("a", 0, 0), sys("b", 100, 0)];

function bands(map: Record<string, LaneBand>): Map<string, LaneBand> {
  return new Map(Object.entries(map));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("TradeFlowLayer.sync — particle count follows the lane's band, not raw volume", () => {
  it("gives an edge on a congested lane more particles than one on a fine lane, whatever their volumes", () => {
    const layer = new TradeFlowLayer(CONFIG);
    const flowEdges = new Map<string, TradeFlowEdgeInfo>([
      ["a|b|a", edge({ laneKey: "a|b", fromSystemId: "a", toSystemId: "b", totalVolume: 1 })],
      ["b|a|b", edge({ laneKey: "b|a", fromSystemId: "b", toSystemId: "a", totalVolume: 1000 })],
    ]);
    // Give the congested lane the tiny volume and the fine lane the huge one, so a pass driven by
    // volume rather than band would get this backwards.
    layer.sync(SYSTEMS, flowEdges, bands({ "a|b": "congested", "b|a": "fine" }));

    const particleCounts = layer.container.children.map((c) => c.children.length);
    expect(Math.max(...particleCounts)).toBe(CONFIG.particlesPerBand.congested);
    expect(Math.min(...particleCounts)).toBe(CONFIG.particlesPerBand.fine);
  });

  it("a lane missing from bandByLaneKey reads as fine", () => {
    const layer = new TradeFlowLayer(CONFIG);
    const flowEdges = new Map<string, TradeFlowEdgeInfo>([
      ["a|b|a", edge({ laneKey: "a|b", fromSystemId: "a", toSystemId: "b" })],
    ]);
    layer.sync(SYSTEMS, flowEdges, bands({}));

    expect(layer.container.children).toHaveLength(1);
    expect(layer.container.children[0].children).toHaveLength(CONFIG.particlesPerBand.fine);
  });
});

describe("TradeFlowLayer.sync — a band change recreates the edge object; an unchanged band does not", () => {
  it("disposes and recreates when the lane's band changes between syncs", () => {
    const layer = new TradeFlowLayer(CONFIG);
    const flowEdges = new Map<string, TradeFlowEdgeInfo>([
      ["a|b|a", edge({ laneKey: "a|b", fromSystemId: "a", toSystemId: "b" })],
    ]);
    layer.sync(SYSTEMS, flowEdges, bands({ "a|b": "fine" }));
    const firstContainer = layer.container.children[0];

    const destroySpy = vi.spyOn(TradeFlowEdge.prototype, "destroy");
    layer.sync(SYSTEMS, flowEdges, bands({ "a|b": "congested" }));

    expect(destroySpy).toHaveBeenCalledTimes(1);
    expect(layer.container.children[0]).not.toBe(firstContainer);
    expect(layer.container.children[0].children).toHaveLength(CONFIG.particlesPerBand.congested);
  });

  it("recreates on a band change even when the two bands share a particle count (colour alone changed)", () => {
    // Tie two bands to one count so the particle-count clause cannot be what triggers the rebuild —
    // only the band identity can.
    const tied: FlowLayerConfig = { ...CONFIG, particlesPerBand: { fine: 2, busy: 2, congested: 9 } };
    const layer = new TradeFlowLayer(tied);
    const flowEdges = new Map<string, TradeFlowEdgeInfo>([
      ["a|b|a", edge({ laneKey: "a|b", fromSystemId: "a", toSystemId: "b" })],
    ]);
    layer.sync(SYSTEMS, flowEdges, bands({ "a|b": "fine" }));
    const firstContainer = layer.container.children[0];

    const destroySpy = vi.spyOn(TradeFlowEdge.prototype, "destroy");
    layer.sync(SYSTEMS, flowEdges, bands({ "a|b": "busy" }));

    expect(destroySpy).toHaveBeenCalledTimes(1);
    expect(layer.container.children[0]).not.toBe(firstContainer);
  });

  it("does not recreate the edge object when the band is unchanged across syncs", () => {
    const layer = new TradeFlowLayer(CONFIG);
    const flowEdges = new Map<string, TradeFlowEdgeInfo>([
      ["a|b|a", edge({ laneKey: "a|b", fromSystemId: "a", toSystemId: "b" })],
    ]);
    layer.sync(SYSTEMS, flowEdges, bands({ "a|b": "fine" }));
    const firstContainer = layer.container.children[0];

    const destroySpy = vi.spyOn(TradeFlowEdge.prototype, "destroy");
    // Same band, same volume — a stale re-sync must not tear down and rebuild the object.
    layer.sync(SYSTEMS, flowEdges, bands({ "a|b": "fine" }));

    expect(destroySpy).not.toHaveBeenCalled();
    expect(layer.container.children[0]).toBe(firstContainer);
  });
});
