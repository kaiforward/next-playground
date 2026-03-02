import { Container } from "pixi.js";
import { SystemObject } from "../objects/system-object";
import type { SystemNodeData } from "@/lib/hooks/use-map-data";
import type { Frustum } from "../frustum";
import type { LODState } from "../lod";

export class SystemLayer {
  readonly container = new Container();
  private objects = new Map<string, SystemObject>();
  private active = true;
  /** Pending data to sync when re-activated */
  private pendingSync: { systems: SystemNodeData[]; selectedId: string | null } | null = null;
  onObjectCreated?: (obj: SystemObject) => void;

  /** Toggle active state. When inactive, destroys all SystemObjects to free GPU memory. */
  setActive(active: boolean) {
    if (this.active === active) return;
    this.active = active;

    if (!active) {
      // Destroy all objects — point cloud covers universe view
      for (const obj of this.objects.values()) {
        obj.removeAllListeners();
        obj.destroy({ children: true });
      }
      this.objects.clear();
    } else if (this.pendingSync) {
      // Re-entering active: rebuild from pending data
      this.sync(this.pendingSync.systems, this.pendingSync.selectedId);
    }
  }

  sync(systems: SystemNodeData[], selectedId: string | null) {
    // Always store latest data for re-activation
    this.pendingSync = { systems, selectedId };
    if (!this.active) return;

    const incoming = new Set<string>();

    for (const data of systems) {
      incoming.add(data.id);
      let obj = this.objects.get(data.id);
      if (!obj) {
        obj = new SystemObject();
        this.objects.set(data.id, obj);
        this.container.addChild(obj);
        this.onObjectCreated?.(obj);
      }
      obj.update(data, data.id === selectedId);
    }

    // Remove stale objects
    for (const [id, obj] of this.objects) {
      if (!incoming.has(id)) {
        obj.removeAllListeners();
        this.container.removeChild(obj);
        obj.destroy({ children: true });
        this.objects.delete(id);
      }
    }
  }

  /** Per-frame visibility update: frustum culling + LOD */
  updateVisibility(frustum: Frustum, lod: LODState) {
    for (const obj of this.objects.values()) {
      const inView = frustum.contains(obj.position.x, obj.position.y);
      obj.visible = inView;
      if (inView) {
        obj.setLOD(lod);
      }
    }
  }

  getObject(systemId: string): SystemObject | undefined {
    return this.objects.get(systemId);
  }

  getAllObjects(): IterableIterator<SystemObject> {
    return this.objects.values();
  }

  destroy() {
    for (const obj of this.objects.values()) {
      obj.destroy({ children: true });
    }
    this.objects.clear();
    this.container.destroy({ children: true });
  }
}
