import { Container, Graphics, Text, TextStyle } from "pixi.js";
import type { SystemNodeData } from "@/lib/hooks/use-map-data";
import type { Frustum } from "../frustum";
import { priceRampColorPixi } from "@/lib/utils/price-ramp";
import { TEXT_RESOLUTION } from "../theme";

const RING_RADIUS = 14;
const RING_THICKNESS = 3;
const RING_ALPHA = 0.85;

// Delta badge — small pill anchored top-right of the system carrying the
// rounded % deviation from base price. Disambiguates colour buckets that
// look similar at a glance (e.g. mild bargain vs neutral).
const BADGE_OFFSET_X = 17;
const BADGE_OFFSET_Y = -12;
const BADGE_PAD_X = 4;
const BADGE_PAD_Y = 1;
const BADGE_CORNER = 2;
const BADGE_BG_ALPHA = 0.92;

const BADGE_TEXT_STYLE = new TextStyle({
  fontSize: 12,
  fontFamily: "system-ui, -apple-system, sans-serif",
  fontWeight: "700",
  fill: 0x1a1c1f,
});

interface HeatmapEntry {
  currentPrice: number;
  basePrice: number;
}

interface RenderEntry {
  ring: Graphics;
  badge: Container;
  pill: Graphics;
  label: Text;
}

/**
 * Per system with price data for the selected good, renders:
 *   - a coloured ring (bucketed via priceRampColorPixi) around the system glyph
 *   - a tiny delta badge with the rounded % deviation from base price
 *
 * Both fade with systemLayerAlpha so the overlay disappears at universe zoom
 * alongside the system glyphs it annotates.
 */
export class PriceHeatmapLayer {
  readonly container = new Container();
  private ringLayer = new Container();
  private badgeLayer = new Container();
  private entries = new Map<string, RenderEntry>();

  constructor() {
    // Badges sit above all rings so neighbour rings can't paint over labels.
    this.container.addChild(this.ringLayer, this.badgeLayer);
  }

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
      const pct = Math.round((entry.currentPrice / entry.basePrice - 1) * 100);
      wanted.add(systemId);

      let render = this.entries.get(systemId);
      if (!render) {
        const ring = new Graphics();
        const badge = new Container();
        const pill = new Graphics();
        const label = new Text({
          text: "",
          style: BADGE_TEXT_STYLE,
          resolution: TEXT_RESOLUTION,
        });
        label.anchor.set(0, 0.5);
        badge.addChild(pill, label);

        this.ringLayer.addChild(ring);
        this.badgeLayer.addChild(badge);
        render = { ring, badge, pill, label };
        this.entries.set(systemId, render);
      }

      // Ring
      render.ring.clear();
      render.ring.circle(0, 0, RING_RADIUS);
      render.ring.stroke({ width: RING_THICKNESS, color: tint, alpha: RING_ALPHA });
      render.ring.position.set(pos.x, pos.y);

      // Badge label — positive deltas get an explicit '+'; negatives already carry '-'.
      render.label.text = pct > 0 ? `+${pct}%` : `${pct}%`;
      render.label.x = BADGE_PAD_X;
      render.label.y = 0;

      // Pill background sized to the text
      const w = render.label.width + BADGE_PAD_X * 2;
      const h = render.label.height + BADGE_PAD_Y * 2;
      render.pill.clear();
      render.pill.roundRect(0, -h / 2, w, h, BADGE_CORNER);
      render.pill.fill({ color: tint, alpha: BADGE_BG_ALPHA });

      render.badge.position.set(pos.x + BADGE_OFFSET_X, pos.y + BADGE_OFFSET_Y);
    }

    for (const id of [...this.entries.keys()]) {
      if (!wanted.has(id)) this.disposeEntry(id);
    }
  }

  updateVisibility(frustum: Frustum, layerAlpha = 1) {
    this.container.alpha = layerAlpha;
    if (this.container.alpha === 0) {
      this.container.visible = false;
      return;
    }
    this.container.visible = true;
    for (const [, e] of this.entries) {
      const visible = frustum.contains(e.ring.x, e.ring.y);
      e.ring.visible = visible;
      e.badge.visible = visible;
    }
  }

  private disposeEntry(id: string) {
    const e = this.entries.get(id);
    if (!e) return;
    this.ringLayer.removeChild(e.ring);
    this.badgeLayer.removeChild(e.badge);
    e.ring.destroy();
    e.badge.destroy({ children: true });
    this.entries.delete(id);
  }

  private clearAll() {
    for (const id of [...this.entries.keys()]) this.disposeEntry(id);
  }

  destroy() {
    this.clearAll();
    this.container.destroy({ children: true });
  }
}
