import { Container } from "pixi.js";
import { SystemObject } from "../objects/system-object";
import type { SystemNodeData } from "@/lib/hooks/use-map-data";

export class SystemLayer {
  readonly container = new Container();
  private objects = new Map<string, SystemObject>();
  onObjectCreated?: (obj: SystemObject) => void;

  sync(systems: SystemNodeData[], selectedId: string | null) {
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
