import { Container, Graphics } from "pixi.js";
import type { SystemNodeData } from "@/lib/hooks/use-map-data";
import type { Frustum } from "../frustum";
import { priceRampColorPixi } from "@/lib/utils/price-ramp";

const RING_RADIUS = 14;
const RING_THICKNESS = 3;
const RING_ALPHA = 0.85;

interface HeatmapEntry {
  currentPrice: number;
  basePrice: number;
}

/**
 * Renders a colored ring around each visible system whose system has price
 * data for the selected good. The ring color comes from priceRampColorPixi.
 *
 * Sync model: rebuild graphics on every sync (the data set is small and
 * changes per-tick anyway).
 */
export class PriceHeatmapLayer {
  readonly container = new Container();
  private rings = new Map<string, Graphics>();

  /**
   * Rebuild rings from current price data. `priceMap` is keyed by systemId.
   * Empty/null map clears all rings.
   */
  sync(systems: SystemNodeData[], priceMap: Map<string, HeatmapEntry> | null) {
    if (!priceMap || priceMap.size === 0) {
      this.clearAll();
      return;
    }

    const posById = new Map<string, { x: number; y: number }>();
    for (const s of systems) posById.set(s.id, { x: s.x, y: s.y });

    const wanted = new Set<string>();

    for (const [systemId, entry] of priceMap) {
      const pos = posById.get(systemId);
      if (!pos) continue;
      const tint = priceRampColorPixi(entry.currentPrice, entry.basePrice);
      if (tint === null) continue;
      wanted.add(systemId);

      let ring = this.rings.get(systemId);
      if (!ring) {
        ring = new Graphics();
        this.rings.set(systemId, ring);
        this.container.addChild(ring);
      }
      ring.clear();
      ring.circle(0, 0, RING_RADIUS);
      ring.stroke({ width: RING_THICKNESS, color: tint, alpha: RING_ALPHA });
      ring.position.set(pos.x, pos.y);
    }

    // Remove rings for systems no longer in the wanted set
    for (const id of [...this.rings.keys()]) {
      if (!wanted.has(id)) this.disposeRing(id);
    }
  }

  updateVisibility(frustum: Frustum, layerAlpha = 1) {
    this.container.alpha = layerAlpha;
    if (this.container.alpha === 0) {
      this.container.visible = false;
      return;
    }
    this.container.visible = true;
    for (const [, ring] of this.rings) {
      // Treat ring center as the point — cheap test, no per-ring radius math.
      ring.visible = frustum.contains(ring.x, ring.y);
    }
  }

  private disposeRing(id: string) {
    const ring = this.rings.get(id);
    if (!ring) return;
    this.container.removeChild(ring);
    ring.destroy();
    this.rings.delete(id);
  }

  private clearAll() {
    for (const id of [...this.rings.keys()]) this.disposeRing(id);
  }

  destroy() {
    this.clearAll();
    this.container.destroy({ children: true });
  }
}
