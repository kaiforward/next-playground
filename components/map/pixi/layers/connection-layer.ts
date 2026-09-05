import { Container } from "pixi.js";
import { ConnectionObject } from "../objects/connection-object";
import type { ConnectionData, SystemNodeData } from "@/lib/hooks/use-map-data";
import type { Frustum } from "../frustum";
import type { LODState } from "../lod";

export class ConnectionLayer {
  readonly container = new Container();
  private objects = new Map<string, ConnectionObject>();
  /** Position cache for frustum checks and fuel label LOD */
  private positions = new Map<string, { fromX: number; fromY: number; toX: number; toY: number }>();
  /** Last-synced data per connection id, so `setHovered` can re-`update()` a single lane without a
   *  full `sync`. */
  private dataById = new Map<string, ConnectionData>();
  /** `laneKey` → connection id, so `setHovered` can find the object for a hovered lane. */
  private idByLaneKey = new Map<string, string>();
  private selectedLaneKey: string | null = null;
  private hoveredLaneKey: string | null = null;

  /** Sync all connections using system positions. `selectedLaneKey` drives the copper highlight. */
  sync(connections: ConnectionData[], systems: SystemNodeData[], selectedLaneKey: string | null = null) {
    const posMap = new Map<string, { x: number; y: number }>();
    for (const s of systems) {
      posMap.set(s.id, { x: s.x, y: s.y });
    }

    this.selectedLaneKey = selectedLaneKey;
    const incoming = new Set<string>();

    for (const data of connections) {
      incoming.add(data.id);
      const from = posMap.get(data.fromId);
      const to = posMap.get(data.toId);
      if (!from || !to) continue;

      let obj = this.objects.get(data.id);
      if (!obj) {
        obj = new ConnectionObject();
        this.objects.set(data.id, obj);
        this.container.addChild(obj);
      }
      obj.update(data, from.x, from.y, to.x, to.y, {
        selected: data.laneKey === selectedLaneKey,
        hovered: data.laneKey === this.hoveredLaneKey,
      });
      this.positions.set(data.id, { fromX: from.x, fromY: from.y, toX: to.x, toY: to.y });
      this.dataById.set(data.id, data);
      this.idByLaneKey.set(data.laneKey, data.id);
    }

    // Remove stale
    for (const [id, obj] of this.objects) {
      if (!incoming.has(id)) {
        const data = this.dataById.get(id);
        if (data) this.idByLaneKey.delete(data.laneKey);
        this.container.removeChild(obj);
        obj.destroy({ children: true });
        this.objects.delete(id);
        this.positions.delete(id);
        this.dataById.delete(id);
      }
    }
  }

  /** Re-renders only the lane leaving hover and the lane entering it, using the data/positions
   *  cached by the last `sync` — no full re-sync needed on a pointer move. */
  setHovered(laneKey: string | null) {
    if (laneKey === this.hoveredLaneKey) return;
    const previous = this.hoveredLaneKey;
    this.hoveredLaneKey = laneKey;
    this.redrawLane(previous);
    this.redrawLane(laneKey);
  }

  private redrawLane(laneKey: string | null) {
    if (laneKey === null) return;
    const id = this.idByLaneKey.get(laneKey);
    if (id === undefined) return;
    const obj = this.objects.get(id);
    const data = this.dataById.get(id);
    const pos = this.positions.get(id);
    if (!obj || !data || !pos) return;
    obj.update(data, pos.fromX, pos.fromY, pos.toX, pos.toY, {
      selected: data.laneKey === this.selectedLaneKey,
      hovered: data.laneKey === this.hoveredLaneKey,
    });
  }

  /** Per-frame visibility update: frustum culling */
  updateVisibility(frustum: Frustum, _lod: LODState, layerAlpha = 1) {
    // Skip entirely when invisible (universe view)
    this.container.alpha = layerAlpha;
    if (layerAlpha === 0) {
      this.container.visible = false;
      return;
    }
    this.container.visible = true;

    for (const [id, obj] of this.objects) {
      const pos = this.positions.get(id);
      if (!pos) { obj.visible = false; continue; }
      obj.visible = frustum.intersects(pos.fromX, pos.fromY, pos.toX, pos.toY);
    }
  }

  destroy() {
    for (const obj of this.objects.values()) {
      obj.destroy({ children: true });
    }
    this.objects.clear();
    this.positions.clear();
    this.dataById.clear();
    this.idByLaneKey.clear();
    this.container.destroy({ children: true });
  }
}
