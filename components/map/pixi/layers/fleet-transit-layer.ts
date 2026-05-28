import { Container, Graphics, Text, TextStyle } from "pixi.js";
import type { Frustum } from "../frustum";
import type { ConnectionInfo } from "@/lib/engine/navigation";
import type { TransitUnit } from "@/lib/hooks/use-map-data";
import {
  reconstructTransitPath,
  interpolateTransit,
  clusterMarkers,
  type TransitPath,
  type Vec2,
} from "@/lib/engine/transit-position";
import { FLEET, TEXT_RESOLUTION } from "../theme";

const DEFAULT_TICK_MS = 5000;

const COUNT_STYLE = new TextStyle({
  fontSize: 12,
  fontWeight: "700",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fill: FLEET.pillContent,
});

const ETA_STYLE = new TextStyle({
  fontSize: 11,
  fontWeight: "600",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fill: FLEET.routeActive.color,
});

interface MarkerObject {
  container: Container;
  pill: Graphics;
  nose: Graphics;
  count: Text;
  hit: Graphics;
  /** Single-unit id for hover/click, or "" for a multi-ship cluster. */
  unitId: string;
}

/**
 * Renders always-on in-transit ship markers (directional pills) plus on-demand
 * routes (hover ghost / selected / all-routes overlay). Markers are held at a
 * constant screen size and cluster in screen space so they don't pile up.
 */
export class FleetTransitLayer {
  readonly container = new Container();
  private routeLayer = new Container();
  private markerLayer = new Container();
  private hoverRoute = new Graphics();
  private selectedRoute = new Graphics();
  private allRoutes = new Graphics();
  private etaLabel: Text;

  private units: TransitUnit[] = [];
  private positions = new Map<string, Vec2>();
  private paths = new Map<string, TransitPath>();
  private pathKey = "";

  private currentTick = 0;
  private lastTickAt = 0;
  private tickMs = DEFAULT_TICK_MS;

  private hoveredId: string | null = null;
  private selectedId: string | null = null;
  private showAllRoutes = false;
  private onClick: (unitId: string | null) => void = () => {};

  private markerPool = new Map<string, MarkerObject>();

  constructor() {
    this.routeLayer.addChild(this.allRoutes, this.hoverRoute, this.selectedRoute);
    this.etaLabel = new Text({ text: "", style: ETA_STYLE, resolution: TEXT_RESOLUTION });
    this.etaLabel.anchor.set(0.5, 1);
    this.etaLabel.visible = false;
    this.container.addChild(this.routeLayer, this.markerLayer, this.etaLabel);
  }

  setOnClick(cb: (unitId: string | null) => void) {
    this.onClick = cb;
  }

  setSelected(id: string | null) {
    this.selectedId = id;
  }

  setShowAllRoutes(v: boolean) {
    this.showAllRoutes = v;
  }

  setTick(tick: number) {
    if (tick === this.currentTick) return;
    const now = performance.now();
    if (this.lastTickAt > 0) {
      this.tickMs = Math.min(30000, Math.max(500, now - this.lastTickAt));
    }
    this.lastTickAt = now;
    this.currentTick = tick;
  }

  sync(units: TransitUnit[], positions: Map<string, Vec2>, connections: ConnectionInfo[]) {
    this.units = units;
    this.positions = positions;

    const key = units
      .map((u) => `${u.id}:${u.originSystemId}>${u.destinationSystemId}@${u.departureTick}-${u.arrivalTick}`)
      .join("|");
    if (key !== this.pathKey) {
      this.pathKey = key;
      this.paths = new Map();
      for (const u of units) {
        this.paths.set(u.id, reconstructTransitPath(u.originSystemId, u.destinationSystemId, connections, u.speed));
      }
    }

    if (this.selectedId && !units.some((u) => u.id === this.selectedId)) this.selectedId = null;
    if (this.hoveredId && !units.some((u) => u.id === this.hoveredId)) this.hoveredId = null;
  }

  private nowTick(): number {
    const frac = this.lastTickAt > 0 ? clamp01((performance.now() - this.lastTickAt) / this.tickMs) : 0;
    return this.currentTick + frac;
  }

  private placement(u: TransitUnit, nowTick: number) {
    const path = this.paths.get(u.id);
    if (!path) return null;
    const span = u.arrivalTick - u.departureTick;
    const progress = span <= 0 ? 1 : clamp01((nowTick - u.departureTick) / span);
    return interpolateTransit(path, this.positions, progress);
  }

  /** Per-frame: interpolate, cluster (screen-space), reconcile markers, draw routes. */
  update(_dtMs: number, zoom: number, frustum: Frustum) {
    const nowTick = this.nowTick();

    const placed: { unit: TransitUnit; x: number; y: number; angle: number }[] = [];
    for (const u of this.units) {
      const p = this.placement(u, nowTick);
      if (p) placed.push({ unit: u, x: p.x, y: p.y, angle: p.angleRad });
    }

    const worldThreshold = FLEET.clusterThresholdPx / Math.max(zoom, 0.0001);
    const clusters = clusterMarkers(
      placed.map((p) => ({ id: p.unit.id, x: p.x, y: p.y, item: p })),
      worldThreshold,
    );

    const wanted = new Set<string>();
    const markerScale = FLEET.markerScreenScale / Math.max(zoom, 0.0001);
    for (const c of clusters) {
      const memberIds = c.items.map((i) => i.unit.id).sort();
      const ckey = memberIds.join(",");
      wanted.add(ckey);
      const single = c.items.length === 1;
      const count = c.items.reduce((n, i) => n + i.unit.memberCount, 0);
      const lead = c.items[0];

      let m = this.markerPool.get(ckey);
      if (!m) {
        m = this.createMarker(single ? lead.unit.id : "");
        this.markerPool.set(ckey, m);
      }
      m.container.position.set(lead.x, lead.y);
      m.container.scale.set(markerScale);
      m.container.visible = frustum.contains(lead.x, lead.y);
      this.drawMarker(m, lead.angle, count, single);
    }

    for (const [k, m] of this.markerPool) {
      if (!wanted.has(k)) {
        this.markerLayer.removeChild(m.container);
        m.container.destroy({ children: true });
        this.markerPool.delete(k);
      }
    }

    this.drawRoutes(zoom);
  }

  private createMarker(unitId: string): MarkerObject {
    const container = new Container();
    const pill = new Graphics();
    const nose = new Graphics();
    const count = new Text({ text: "", style: COUNT_STYLE, resolution: TEXT_RESOLUTION });
    count.anchor.set(0.5, 0.5);
    const hit = new Graphics();
    hit.circle(0, 0, FLEET.hitRadius);
    hit.fill({ color: 0xffffff, alpha: 0.001 });
    container.addChild(pill, nose, count, hit);
    container.eventMode = "static";
    container.cursor = "pointer";

    const m: MarkerObject = { container, pill, nose, count, hit, unitId };

    container.on("pointerover", () => {
      if (m.unitId) this.hoveredId = m.unitId;
    });
    container.on("pointerout", () => {
      if (m.unitId && this.hoveredId === m.unitId) this.hoveredId = null;
    });
    container.on("pointerdown", (e) => {
      e.stopPropagation();
      this.onClick(m.unitId || null);
    });

    this.markerLayer.addChild(container);
    return m;
  }

  private drawMarker(m: MarkerObject, angle: number, count: number, single: boolean) {
    const h = FLEET.markerHeight;
    const w = single ? FLEET.markerMinWidth : FLEET.markerMinWidth + String(count).length * FLEET.countDigitWidth;

    m.pill.clear();
    m.pill.roundRect(-w / 2, -h / 2, w, h, FLEET.pillCorner);
    m.pill.fill(FLEET.pillFill);

    // direction nose: a triangle just off the pill edge, rotated to the heading
    const r = w / 2 + 3;
    const cx = Math.cos(angle) * r;
    const cy = Math.sin(angle) * r;
    const s = FLEET.chevronSize;
    m.nose.clear();
    m.nose.poly([
      cx + Math.cos(angle) * s, cy + Math.sin(angle) * s,
      cx + Math.cos(angle + 2.5) * s, cy + Math.sin(angle + 2.5) * s,
      cx + Math.cos(angle - 2.5) * s, cy + Math.sin(angle - 2.5) * s,
    ]);
    m.nose.fill(FLEET.pillFill);

    if (single) {
      m.count.visible = false;
    } else {
      m.count.visible = true;
      m.count.text = String(count);
      m.count.position.set(0, 0);
    }
  }

  private strokePath(g: Graphics, unit: TransitUnit, style: { color: number; alpha: number; width: number }, zoom: number) {
    const path = this.paths.get(unit.id);
    if (!path) return;
    const pts: Vec2[] = [];
    for (const node of path.nodes) {
      const pos = this.positions.get(node.systemId);
      if (!pos) return;
      pts.push(pos);
    }
    g.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
    g.stroke({ color: style.color, alpha: style.alpha, width: style.width / Math.max(zoom, 0.0001) });
  }

  private drawRoutes(zoom: number) {
    this.allRoutes.clear();
    this.hoverRoute.clear();
    this.selectedRoute.clear();

    if (this.showAllRoutes) {
      for (const u of this.units) this.strokePath(this.allRoutes, u, FLEET.routeAll, zoom);
    }

    if (this.selectedId) {
      const u = this.units.find((x) => x.id === this.selectedId);
      if (u) this.strokePath(this.selectedRoute, u, FLEET.routeActive, zoom);
    }

    if (this.hoveredId && this.hoveredId !== this.selectedId) {
      const u = this.units.find((x) => x.id === this.hoveredId);
      if (u) {
        this.strokePath(this.hoverRoute, u, FLEET.routeHover, zoom);
        const p = this.placement(u, this.nowTick());
        if (p) {
          const remaining = Math.max(0, u.arrivalTick - this.currentTick);
          this.etaLabel.text = `→ ${u.destinationName} · ${remaining}t`;
          this.etaLabel.position.set(p.x, p.y - FLEET.markerHeight / Math.max(zoom, 0.0001) - 4);
          this.etaLabel.scale.set(1 / Math.max(zoom, 0.0001));
          this.etaLabel.visible = true;
          return;
        }
      }
    }
    this.etaLabel.visible = false;
  }

  updateVisibility(layerAlpha: number) {
    this.container.alpha = layerAlpha;
    this.container.visible = layerAlpha > 0.01;
  }

  destroy() {
    for (const m of this.markerPool.values()) m.container.destroy({ children: true });
    this.markerPool.clear();
    this.container.destroy({ children: true });
  }
}

function clamp01(n: number): number {
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}
