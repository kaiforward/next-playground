import { Container } from "pixi.js";
import { RegionObject } from "../objects/region-object";
import type { RegionNodeData } from "@/lib/hooks/use-map-data";

export class RegionLayer {
  readonly container = new Container();
  private objects = new Map<string, RegionObject>();
  onObjectCreated?: (obj: RegionObject) => void;

  sync(regions: RegionNodeData[]) {
    const incoming = new Set<string>();

    for (const data of regions) {
      incoming.add(data.id);
      let obj = this.objects.get(data.id);
      if (!obj) {
        obj = new RegionObject();
        this.objects.set(data.id, obj);
        this.container.addChild(obj);
        this.onObjectCreated?.(obj);
      }
      obj.update(data);
    }

    // Remove stale
    for (const [id, obj] of this.objects) {
      if (!incoming.has(id)) {
        obj.removeAllListeners();
        this.container.removeChild(obj);
        obj.destroy({ children: true });
        this.objects.delete(id);
      }
    }
  }

  getObject(regionId: string): RegionObject | undefined {
    return this.objects.get(regionId);
  }

  getAllObjects(): IterableIterator<RegionObject> {
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
