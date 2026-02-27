import { Container } from "pixi.js";
import { ConnectionObject } from "../objects/connection-object";
import type { ConnectionData, SystemNodeData, RegionNodeData } from "@/lib/hooks/use-map-data";

export class ConnectionLayer {
  readonly container = new Container();
  private objects = new Map<string, ConnectionObject>();

  /** Sync connections in system view using system positions */
  syncSystems(connections: ConnectionData[], systems: SystemNodeData[]) {
    const posMap = new Map<string, { x: number; y: number }>();
    for (const s of systems) {
      posMap.set(s.id, { x: s.x, y: s.y });
    }
    this.syncInternal(connections, posMap, false);
  }

  /** Sync connections in region view using region positions */
  syncRegions(connections: ConnectionData[], regions: RegionNodeData[]) {
    const posMap = new Map<string, { x: number; y: number }>();
    for (const r of regions) {
      posMap.set(r.id, { x: r.x, y: r.y });
    }
    this.syncInternal(connections, posMap, true);
  }

  private syncInternal(
    connections: ConnectionData[],
    positions: Map<string, { x: number; y: number }>,
    isRegion: boolean,
  ) {
    const incoming = new Set<string>();

    for (const data of connections) {
      incoming.add(data.id);
      const from = positions.get(data.fromId);
      const to = positions.get(data.toId);
      if (!from || !to) continue;

      let obj = this.objects.get(data.id);
      if (!obj) {
        obj = new ConnectionObject();
        this.objects.set(data.id, obj);
        this.container.addChild(obj);
      }
      obj.update(data, from.x, from.y, to.x, to.y, isRegion);
    }

    // Remove stale
    for (const [id, obj] of this.objects) {
      if (!incoming.has(id)) {
        this.container.removeChild(obj);
        obj.destroy({ children: true });
        this.objects.delete(id);
      }
    }
  }

  destroy() {
    for (const obj of this.objects.values()) {
      obj.destroy({ children: true });
    }
    this.objects.clear();
    this.container.destroy({ children: true });
  }
}
