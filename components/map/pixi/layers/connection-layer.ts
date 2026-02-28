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

  /** Sync all connections using system positions */
  sync(connections: ConnectionData[], systems: SystemNodeData[]) {
    const posMap = new Map<string, { x: number; y: number }>();
    for (const s of systems) {
      posMap.set(s.id, { x: s.x, y: s.y });
    }

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
      obj.update(data, from.x, from.y, to.x, to.y);
      this.positions.set(data.id, { fromX: from.x, fromY: from.y, toX: to.x, toY: to.y });
    }

    // Remove stale
    for (const [id, obj] of this.objects) {
      if (!incoming.has(id)) {
        this.container.removeChild(obj);
        obj.destroy({ children: true });
        this.objects.delete(id);
        this.positions.delete(id);
      }
    }
  }

  /** Per-frame visibility update: frustum culling + fuel label LOD */
  updateVisibility(frustum: Frustum, lod: LODState) {
    for (const [id, obj] of this.objects) {
      const pos = this.positions.get(id);
      if (!pos) { obj.visible = false; continue; }
      const inView = frustum.intersects(pos.fromX, pos.fromY, pos.toX, pos.toY);
      obj.visible = inView;
      if (inView) {
        obj.setFuelLabelVisible(lod.showFuelLabels, lod.detailAlpha);
      }
    }
  }

  destroy() {
    for (const obj of this.objects.values()) {
      obj.destroy({ children: true });
    }
    this.objects.clear();
    this.positions.clear();
    this.container.destroy({ children: true });
  }
}
