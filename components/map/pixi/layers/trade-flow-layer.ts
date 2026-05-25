import { Container } from "pixi.js";
import { TradeFlowEdge } from "../objects/trade-flow-edge";
import { getGoodColor } from "@/lib/constants/good-colors";
import { TRADE_FLOW } from "../theme";
import type { Frustum } from "../frustum";
import type { LODState } from "../lod";
import type { SystemNodeData } from "@/lib/hooks/use-map-data";
import type { TradeFlowEdgeInfo } from "@/lib/types/api";

/**
 * Pixi layer that renders the trade-flow overlay.
 *
 * Lifecycle:
 *   - `sync(systems, flowEdges)` — diff the live edge set: create
 *     `TradeFlowEdge` objects for newly-active edges, destroy ones that
 *     fell out of the visibility-filtered flow set. Endpoint positions are
 *     baked at construction time (taken from `systems`).
 *   - `updateVisibility(frustum, lod)` — per frame: cull off-screen edges,
 *     set layer alpha from LOD, skip the animation pass when invisible.
 *   - `update(dtMs)` — advance particle offsets for visible edges only.
 *
 * The total active-particle count is capped by `TRADE_FLOW.maxTotalParticles`;
 * highest-volume edges are kept first when the cap is hit.
 */
export class TradeFlowLayer {
  readonly container = new Container();
  private edges = new Map<string, TradeFlowEdge>();

  sync(
    systems: SystemNodeData[],
    flowEdges: Map<string, TradeFlowEdgeInfo>,
  ) {
    // Fast path: nothing to render. Tear down any leftover state so toggling
    // off doesn't leave stale particles around.
    if (flowEdges.size === 0) {
      this.clearAll();
      return;
    }

    const posById = new Map<string, { x: number; y: number }>();
    for (const s of systems) posById.set(s.id, { x: s.x, y: s.y });

    // Iterate flowEdges directly (not connections) because the data is the
    // source of truth — what's in the flow set is what we render.
    const incoming = new Set<string>();
    const wanted: Array<{ key: string; edge: TradeFlowEdgeInfo }> = [];

    for (const [key, edge] of flowEdges) {
      const from = posById.get(edge.fromSystemId);
      const to = posById.get(edge.toSystemId);
      if (!from || !to) continue;
      incoming.add(key);
      wanted.push({ key, edge });
    }

    // Particle-cap enforcement: sort by volume descending and accumulate until
    // we hit `maxTotalParticles`. Anything past the cap renders zero particles
    // (skipped entirely).
    wanted.sort((a, b) => b.edge.totalVolume - a.edge.totalVolume);

    let particleBudget = TRADE_FLOW.maxTotalParticles;
    const keepKeys = new Set<string>();

    for (const { key, edge } of wanted) {
      const desired = particleCountFor(edge.totalVolume);
      if (desired === 0 || particleBudget <= 0) continue;
      const allotted = Math.min(desired, particleBudget);
      particleBudget -= allotted;
      keepKeys.add(key);

      let obj = this.edges.get(key);
      // Recreate if particle count changed — TradeFlowEdge bakes the count at
      // construction; simpler than per-particle add/remove for v1.
      if (obj && obj.particleCount !== allotted) {
        this.disposeEdge(key);
        obj = undefined;
      }
      if (!obj) {
        const from = posById.get(edge.fromSystemId);
        const to = posById.get(edge.toSystemId);
        // Both lookups succeeded in the wanted-collection pass above; this
        // guard satisfies the type narrowing for the constructor call.
        if (!from || !to) continue;
        obj = new TradeFlowEdge(
          from,
          to,
          allotted,
          getGoodColor(edge.dominantGoodId),
        );
        this.edges.set(key, obj);
        this.container.addChild(obj.container);
      }
    }

    // Remove anything that fell out of the active set OR was trimmed by the cap.
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

  /** Advance particle offsets for visible edges. */
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

function particleCountFor(volume: number): number {
  if (volume <= 0) return 0;
  const extra = Math.floor(volume / TRADE_FLOW.volumePerExtraParticle);
  return Math.min(
    TRADE_FLOW.maxParticlesPerEdge,
    TRADE_FLOW.minParticlesPerEdge + extra,
  );
}
