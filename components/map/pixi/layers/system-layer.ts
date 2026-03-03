import { Container } from "pixi.js";
import { SystemObject } from "../objects/system-object";
import type { SystemNodeData } from "@/lib/hooks/use-map-data";
import type { Frustum } from "../frustum";
import type { LODState } from "../lod";

/** Max SystemObjects to create per frame to avoid freezing on zoom transitions. */
const MAX_CREATES_PER_FRAME = 50;

export class SystemLayer {
  readonly container = new Container();
  private objects = new Map<string, SystemObject>();
  private active = true;
  /** All system data — creation is deferred to updateVisibility (frustum-gated). */
  private systemData = new Map<string, SystemNodeData>();
  private selectedId: string | null = null;
  onObjectCreated?: (obj: SystemObject) => void;

  /** Toggle active state. Hides container when inactive — objects are preserved. */
  setActive(active: boolean) {
    if (this.active === active) return;
    this.active = active;
    this.container.visible = active;
  }

  /**
   * Receive new system data from React. Updates existing objects immediately
   * but does NOT create new ones — that's updateVisibility's job (frustum-gated).
   */
  sync(systems: SystemNodeData[], selectedId: string | null) {
    this.selectedId = selectedId;

    // Rebuild data lookup
    const newData = new Map<string, SystemNodeData>();
    for (const data of systems) {
      newData.set(data.id, data);
    }
    this.systemData = newData;

    if (!this.active) return;

    // Update existing objects with fresh data
    for (const [id, obj] of this.objects) {
      const data = newData.get(id);
      if (data) {
        obj.update(data, id === selectedId);
      }
    }

    // Remove objects whose systems no longer exist in data
    for (const [id, obj] of this.objects) {
      if (!newData.has(id)) {
        obj.removeAllListeners();
        this.container.removeChild(obj);
        obj.destroy({ children: true });
        this.objects.delete(id);
      }
    }
  }

  /**
   * Per-frame: frustum culling + LOD + on-demand object creation.
   * Only creates SystemObjects for systems in the viewport, capped per frame.
   */
  updateVisibility(frustum: Frustum, lod: LODState) {
    let createdThisFrame = 0;

    for (const [id, data] of this.systemData) {
      const inView = frustum.contains(data.x, data.y);
      let obj = this.objects.get(id);

      // Create on demand for visible systems (batched to avoid frame spikes)
      if (inView && !obj && createdThisFrame < MAX_CREATES_PER_FRAME) {
        obj = new SystemObject();
        this.objects.set(id, obj);
        this.container.addChild(obj);
        this.onObjectCreated?.(obj);
        obj.update(data, id === this.selectedId);
        createdThisFrame++;
      }

      if (obj) {
        obj.visible = inView;
        if (inView) {
          obj.setLOD(lod);
        }
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
