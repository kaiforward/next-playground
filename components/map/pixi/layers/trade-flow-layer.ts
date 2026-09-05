import { Container } from "pixi.js";
import { TradeFlowEdge, type FlowEdgeStyle } from "../objects/trade-flow-edge";
import { LANE_BAND_COLOR, LOGISTICS_FLOW } from "../theme";
import type { LaneBand } from "../objects/lane-band";
import type { Point } from "../flow-arc";
import type { Frustum } from "../frustum";
import type { LODState } from "../lod";
import type { SystemNodeData } from "@/lib/hooks/use-map-data";
import type { TradeFlowEdgeInfo } from "@/lib/types/api";

/** A lane missing from the map (no `bandByLaneKey` entry) reads as this band. */
const DEFAULT_BAND: LaneBand = "fine";

/** Rendering config for the directed-logistics flow particles. */
export interface FlowLayerConfig {
  /** Build the particle path between net-from and net-to endpoints. */
  buildPath: (from: Point, to: Point) => Point[];
  style: FlowEdgeStyle;
  /** Particle count per edge, keyed by the lane's `LaneBand`. */
  particlesPerBand: Record<LaneBand, number>;
  /** Global particle budget for this layer. */
  maxTotalParticles: number;
}

/** Directed logistics: particles travel the lane itself (straight segment), one edge per lane. */
export const LOGISTICS_FLOW_CONFIG: FlowLayerConfig = {
  buildPath: (from, to) => [from, to],
  style: {
    particleRadius: LOGISTICS_FLOW.particleRadius,
    particleAlpha: LOGISTICS_FLOW.particleAlpha,
    particleSpeed: LOGISTICS_FLOW.particleSpeed,
    glowBlur: LOGISTICS_FLOW.glowBlur,
    drawPath: false,
    pathAlpha: LOGISTICS_FLOW.pathAlpha,
    arrowhead: true,
    arrowSize: LOGISTICS_FLOW.arrowSize,
  },
  particlesPerBand: LOGISTICS_FLOW.particlesPerBand,
  maxTotalParticles: LOGISTICS_FLOW.maxTotalParticles,
};

/**
 * Pixi layer that renders the directed-logistics flow overlay, shown in the Lanes map mode. Config-
 * parameterised (see `LOGISTICS_FLOW_CONFIG`) so the path geometry + particle style stay data-driven.
 *
 * Lifecycle mirrors the prior single-overlay layer: `sync` diffs the live edge
 * set, `updateVisibility` culls + sets LOD alpha, `update` advances particles.
 * Total particles are capped by `config.maxTotalParticles`; highest-volume edges
 * are kept first (volume still orders the budget even though it no longer sets the per-edge count).
 */
export class TradeFlowLayer {
  readonly container = new Container();
  private edges = new Map<string, TradeFlowEdge>();

  constructor(private config: FlowLayerConfig = LOGISTICS_FLOW_CONFIG) {}

  sync(
    systems: SystemNodeData[],
    flowEdges: Map<string, TradeFlowEdgeInfo>,
    bandByLaneKey: Map<string, LaneBand>,
  ) {
    if (flowEdges.size === 0) {
      this.clearAll();
      return;
    }

    const posById = new Map<string, { x: number; y: number }>();
    for (const s of systems) posById.set(s.id, { x: s.x, y: s.y });

    const wanted: Array<{ key: string; edge: TradeFlowEdgeInfo; band: LaneBand }> = [];
    for (const [key, edge] of flowEdges) {
      const from = posById.get(edge.fromSystemId);
      const to = posById.get(edge.toSystemId);
      if (!from || !to) continue;
      wanted.push({ key, edge, band: bandByLaneKey.get(edge.laneKey) ?? DEFAULT_BAND });
    }

    wanted.sort((a, b) => b.edge.totalVolume - a.edge.totalVolume);

    let particleBudget = this.config.maxTotalParticles;
    const keepKeys = new Set<string>();

    for (const { key, edge, band } of wanted) {
      const desired = this.config.particlesPerBand[band];
      if (desired <= 0 || particleBudget <= 0) continue;
      const allotted = Math.min(desired, particleBudget);
      particleBudget -= allotted;
      keepKeys.add(key);

      let obj = this.edges.get(key);
      // Recreate if particle count, net direction, or band changed — all are baked at
      // construction (endpoints and colour determine the path/style).
      if (
        obj &&
        (obj.particleCount !== allotted ||
          obj.fromSystemId !== edge.fromSystemId ||
          obj.toSystemId !== edge.toSystemId ||
          obj.band !== band)
      ) {
        this.disposeEdge(key);
        obj = undefined;
      }
      if (!obj) {
        const from = posById.get(edge.fromSystemId);
        const to = posById.get(edge.toSystemId);
        if (!from || !to) continue;
        const path = this.config.buildPath(from, to);
        obj = new TradeFlowEdge(path, allotted, LANE_BAND_COLOR[band], this.config.style, {
          fromSystemId: edge.fromSystemId,
          toSystemId: edge.toSystemId,
          band,
        });
        this.edges.set(key, obj);
        this.container.addChild(obj.container);
      }
    }

    for (const key of [...this.edges.keys()]) {
      if (!keepKeys.has(key)) this.disposeEdge(key);
    }
  }

  /** Per-frame visibility update: frustum culling + layer alpha from LOD. */
  updateVisibility(frustum: Frustum, lod: LODState, layerAlpha = 1) {
    this.container.alpha = lod.logisticsAlpha * layerAlpha;
    if (this.container.alpha === 0) {
      this.container.visible = false;
      return;
    }
    this.container.visible = true;

    for (const edge of this.edges.values()) {
      edge.container.visible = edge.intersects(
        frustum.minX,
        frustum.minY,
        frustum.maxX,
        frustum.maxY,
      );
    }
  }

  update(dtMs: number) {
    for (const edge of this.edges.values()) {
      if (edge.container.visible) edge.update(dtMs);
    }
  }

  private disposeEdge(key: string) {
    const obj = this.edges.get(key);
    if (!obj) return;
    this.container.removeChild(obj.container);
    obj.destroy();
    this.edges.delete(key);
  }

  private clearAll() {
    for (const key of [...this.edges.keys()]) this.disposeEdge(key);
  }

  destroy() {
    this.clearAll();
    this.container.destroy({ children: true });
  }
}
