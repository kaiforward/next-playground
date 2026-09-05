import type { SystemNodeData } from "@/lib/hooks/use-map-data";

/** A minimal `SystemNodeData` at a position — the shape the Pixi layer tests place systems with. */
export function systemNode(id: string, x: number, y: number): SystemNodeData {
  return {
    id, x, y, name: id, economyType: "agricultural", sunClass: "yellow",
    settlementMark: null, regionId: "r1", isGateway: false, visibility: "visible",
  };
}
