import { Container, Graphics, Text, TextStyle } from "pixi.js";
import type { SystemNodeData } from "@/lib/hooks/use-map-data";
import type { Frustum } from "../frustum";
import { priceRampColorPixi } from "@/lib/utils/price-ramp";
import { TEXT_RESOLUTION } from "../theme";

const RING_RADIUS = 14;
const RING_THICKNESS = 3;
const RING_ALPHA = 0.85;

/** Max heatmap entries to create per frame to avoid freezing on zoom/pan. */
const MAX_CREATES_PER_FRAME = 50;

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

/**
 * Resolved, render-ready data for one system: its world position plus the
 * pre-computed tint and delta percentage. Creation is deferred to
 * updateVisibility (frustum-gated), so we cache everything sync() resolved.
 */
interface SystemHeatmapData {
  x: number;
  y: number;
  tint: number;
  pct: number;
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
 *
 * Object creation is frustum-gated: sync() resolves render data into a map but
 * does NOT create Pixi objects — updateVisibility() creates them on demand for
 * in-frustum systems only, batched per frame.
 */
export class PriceHeatmapLayer {
  readonly container = new Container();
  private ringLayer = new Container();
  private badgeLayer = new Container();
  private entries = new Map<string, RenderEntry>();
  /** Resolved render data for every system with price data — creation deferred. */
  private systemData = new Map<string, SystemHeatmapData>();

  constructor() {
    // Badges sit above all rings so neighbour rings can't paint over labels.
    this.container.addChild(this.ringLayer, this.badgeLayer);
  }

  /**
   * Receive new heatmap data from React. Resolves position + tint + delta for
   * each system into systemData and refreshes any already-created objects, but
   * does NOT create new ones — that's updateVisibility's job (frustum-gated).
   */
  sync(systems: SystemNodeData[], priceMap: Map<string, HeatmapEntry> | null) {
    if (!priceMap || priceMap.size === 0) {
      this.clearAll();
      return;
    }

    const posById = new Map<string, { x: number; y: number }>();
    for (const s of systems) posById.set(s.id, { x: s.x, y: s.y });

    const newData = new Map<string, SystemHeatmapData>();
    for (const [systemId, entry] of priceMap) {
      const pos = posById.get(systemId);
      if (!pos) continue;
      const tint = priceRampColorPixi(entry.currentPrice, entry.basePrice);
      if (tint === null) continue;
      const pct = Math.round((entry.currentPrice / entry.basePrice - 1) * 100);
      newData.set(systemId, { x: pos.x, y: pos.y, tint, pct });
    }
    this.systemData = newData;

    // Refresh any objects that already exist so live price changes show up
    // without waiting to scroll out and back in.
    for (const [id, render] of this.entries) {
      const data = newData.get(id);
      if (data) {
        this.renderEntry(render, data);
      }
    }

    // Drop objects whose systems no longer have render-worthy price data.
    for (const id of [...this.entries.keys()]) {
      if (!newData.has(id)) this.disposeEntry(id);
    }
  }

  /**
   * Per-frame: frustum culling + on-demand object creation. Only creates
   * heatmap objects for systems in the viewport, capped per frame.
   */
  updateVisibility(frustum: Frustum, layerAlpha = 1) {
    this.container.alpha = layerAlpha;
    if (this.container.alpha === 0) {
      this.container.visible = false;
      return;
    }
    this.container.visible = true;

    let createdThisFrame = 0;

    for (const [id, data] of this.systemData) {
      const inView = frustum.contains(data.x, data.y);
      let render = this.entries.get(id);

      // Create on demand for visible systems (batched to avoid frame spikes).
      if (inView && !render && createdThisFrame < MAX_CREATES_PER_FRAME) {
        render = this.createEntry(id);
        this.renderEntry(render, data);
        createdThisFrame++;
      }

      if (render) {
        render.ring.visible = inView;
        render.badge.visible = inView;
      }
    }
  }

  /** Allocate Pixi objects for a system and register them in the scene graph. */
  private createEntry(id: string): RenderEntry {
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
    const render: RenderEntry = { ring, badge, pill, label };
    this.entries.set(id, render);
    return render;
  }

  /** Draw the ring + delta badge for an entry from its resolved data. */
  private renderEntry(render: RenderEntry, data: SystemHeatmapData) {
    // Ring
    render.ring.clear();
    render.ring.circle(0, 0, RING_RADIUS);
    render.ring.stroke({ width: RING_THICKNESS, color: data.tint, alpha: RING_ALPHA });
    render.ring.position.set(data.x, data.y);

    // Badge label — positive deltas get an explicit '+'; negatives already carry '-'.
    render.label.text = data.pct > 0 ? `+${data.pct}%` : `${data.pct}%`;
    render.label.x = BADGE_PAD_X;
    render.label.y = 0;

    // Pill background sized to the text
    const w = render.label.width + BADGE_PAD_X * 2;
    const h = render.label.height + BADGE_PAD_Y * 2;
    render.pill.clear();
    render.pill.roundRect(0, -h / 2, w, h, BADGE_CORNER);
    render.pill.fill({ color: data.tint, alpha: BADGE_BG_ALPHA });

    render.badge.position.set(data.x + BADGE_OFFSET_X, data.y + BADGE_OFFSET_Y);
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
    this.systemData.clear();
  }

  destroy() {
    this.clearAll();
    this.container.destroy({ children: true });
  }
}
