import { Container } from "pixi.js";
import { TradeFlowEdge, type FlowEdgeStyle } from "../objects/trade-flow-edge";
import { getGoodColor } from "@/lib/constants/good-colors";
import { LOGISTICS_FLOW } from "../theme";
import { arcPolyline, type Point } from "../flow-arc";
import type { Frustum } from "../frustum";
import type { LODState } from "../lod";
import type { SystemNodeData } from "@/lib/hooks/use-map-data";
import type { TradeFlowEdgeInfo } from "@/lib/types/api";

/** Rendering config for the directed-logistics flow particles. */
export interface FlowLayerConfig {
  /** Build the particle path between net-from and net-to endpoints. */
  buildPath: (from: Point, to: Point) => Point[];
  style: FlowEdgeStyle;
  minParticlesPerEdge: number;
  volumePerExtraParticle: number;
  maxParticlesPerEdge: number;
  /** Global particle budget for this layer. */
  maxTotalParticles: number;
}

/** Directed logistics: arced path, larger glowing convoys, route line + arrow. */
export const LOGISTICS_FLOW_CONFIG: FlowLayerConfig = {
  buildPath: (from, to) =>
    arcPolyline(from, to, LOGISTICS_FLOW.arcBowFraction, LOGISTICS_FLOW.arcMaxBow, LOGISTICS_FLOW.arcSegments),
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
  minParticlesPerEdge: LOGISTICS_FLOW.minParticlesPerEdge,
  volumePerExtraParticle: LOGISTICS_FLOW.volumePerExtraParticle,
  maxParticlesPerEdge: LOGISTICS_FLOW.maxParticlesPerEdge,
  maxTotalParticles: LOGISTICS_FLOW.maxTotalParticles,
};

/**
 * Pixi layer that renders the directed-logistics flow overlay. Config-parameterised
 * (see `LOGISTICS_FLOW_CONFIG`) so the path geometry + particle style stay data-driven.
 *
 * Lifecycle mirrors the prior single-overlay layer: `sync` diffs the live edge
 * set, `updateVisibility` culls + sets LOD alpha, `update` advances particles.
 * Total particles are capped by `config.maxTotalParticles`; highest-volume edges
 * are kept first.
 */
export class TradeFlowLayer {
  readonly container = new Container();
  private edges = new Map<string, TradeFlowEdge>();

  constructor(private config: FlowLayerConfig = LOGISTICS_FLOW_CONFIG) {}

  sync(systems: SystemNodeData[], flowEdges: Map<string, TradeFlowEdgeInfo>) {
    if (flowEdges.size === 0) {
      this.clearAll();
      return;
    }

    const posById = new Map<string, { x: number; y: number }>();
    for (const s of systems) posById.set(s.id, { x: s.x, y: s.y });

    const wanted: Array<{ key: string; edge: TradeFlowEdgeInfo }> = [];
    for (const [key, edge] of flowEdges) {
      const from = posById.get(edge.fromSystemId);
      const to = posById.get(edge.toSystemId);
      if (!from || !to) continue;
      wanted.push({ key, edge });
    }

    wanted.sort((a, b) => b.edge.totalVolume - a.edge.totalVolume);

    let particleBudget = this.config.maxTotalParticles;
    const keepKeys = new Set<string>();

    for (const { key, edge } of wanted) {
      const desired = this.particleCountFor(edge.totalVolume);
      if (desired === 0 || particleBudget <= 0) continue;
      const allotted = Math.min(desired, particleBudget);
      particleBudget -= allotted;
      keepKeys.add(key);

      let obj = this.edges.get(key);
      // Recreate if particle count, net direction, or dominant good changed —
      // all are baked at construction (endpoints determine the path).
      if (
        obj &&
        (obj.particleCount !== allotted ||
          obj.fromSystemId !== edge.fromSystemId ||
          obj.toSystemId !== edge.toSystemId ||
          obj.dominantGoodId !== edge.dominantGoodId)
      ) {
        this.disposeEdge(key);
        obj = undefined;
      }
      if (!obj) {
        const from = posById.get(edge.fromSystemId);
        const to = posById.get(edge.toSystemId);
        if (!from || !to) continue;
        const path = this.config.buildPath(from, to);
        obj = new TradeFlowEdge(path, allotted, getGoodColor(edge.dominantGoodId), this.config.style, {
          fromSystemId: edge.fromSystemId,
          toSystemId: edge.toSystemId,
          dominantGoodId: edge.dominantGoodId,
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
    this.container.alpha = lod.tradeFlowAlpha * layerAlpha;
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

  private particleCountFor(volume: number): number {
    if (volume <= 0) return 0;
    const extra = Math.floor(volume / this.config.volumePerExtraParticle);
    return Math.min(
      this.config.maxParticlesPerEdge,
      this.config.minParticlesPerEdge + extra,
    );
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
