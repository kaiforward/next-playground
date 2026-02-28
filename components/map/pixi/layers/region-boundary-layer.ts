import { Container, Graphics, Text, TextStyle } from "pixi.js";
import { Delaunay } from "d3-delaunay";
import type { SystemNodeData } from "@/lib/hooks/use-map-data";
import type { LODState } from "../lod";
import { TEXT_COLORS, TEXT_RESOLUTION } from "../theme";
import { UNIVERSE_GEN } from "@/lib/constants/universe-gen";

const REGION_NAME_STYLE = new TextStyle({
  fontSize: 64,
  fill: TEXT_COLORS.secondary,
  fontFamily: "system-ui, -apple-system, sans-serif",
  fontWeight: "bold",
  align: "center",
  letterSpacing: 8,
});

interface RegionInfo {
  id: string;
  name: string;
}

export class RegionBoundaryLayer {
  readonly container = new Container();
  private boundaryGraphics = new Graphics();
  private labelContainer = new Container();
  private regionLabels = new Map<string, Text>();

  constructor() {
    this.container.addChild(this.boundaryGraphics);
    this.container.addChild(this.labelContainer);
  }

  /**
   * Compute and render Voronoi-based region boundaries.
   * Called when system data changes (not per frame).
   */
  sync(systems: SystemNodeData[], regions: RegionInfo[]) {
    if (systems.length < 3) {
      this.clear();
      return;
    }

    // Build Delaunay triangulation from system positions
    const points = systems.map((s) => [s.x, s.y] as [number, number]);
    const delaunay = Delaunay.from(points);
    const size = UNIVERSE_GEN.MAP_SIZE;
    const voronoi = delaunay.voronoi([0, 0, size, size]);

    // Draw boundary edges: Voronoi edges where adjacent cells belong to different regions
    this.boundaryGraphics.clear();
    this.boundaryGraphics.setStrokeStyle({ color: 0x475569, width: 1.5, alpha: 0.35 });

    for (let i = 0; i < systems.length; i++) {
      // Get neighbors of cell i
      const neighbors = [...voronoi.neighbors(i)];
      for (const j of neighbors) {
        if (j <= i) continue; // avoid drawing each edge twice
        if (systems[i].regionId === systems[j].regionId) continue; // same region, skip

        // Find the shared Voronoi edge between cells i and j
        const cellI = voronoi.cellPolygon(i);
        const cellJ = voronoi.cellPolygon(j);
        if (!cellI || !cellJ) continue;

        // Find shared vertices between the two cell polygons
        const shared = findSharedEdge(cellI, cellJ);
        if (shared) {
          this.boundaryGraphics.moveTo(shared.x1, shared.y1);
          this.boundaryGraphics.lineTo(shared.x2, shared.y2);
        }
      }
    }
    this.boundaryGraphics.stroke();

    // Compute region centroids for labels
    const regionSums = new Map<string, { x: number; y: number; count: number }>();
    for (const sys of systems) {
      const sum = regionSums.get(sys.regionId) ?? { x: 0, y: 0, count: 0 };
      sum.x += sys.x;
      sum.y += sys.y;
      sum.count++;
      regionSums.set(sys.regionId, sum);
    }

    // Clean up old labels
    for (const label of this.regionLabels.values()) {
      label.destroy();
    }
    this.regionLabels.clear();
    this.labelContainer.removeChildren();

    // Create region name labels at centroids
    for (const region of regions) {
      const sum = regionSums.get(region.id);
      if (!sum) continue;
      const cx = sum.x / sum.count;
      const cy = sum.y / sum.count;

      const label = new Text({
        text: region.name.toUpperCase(),
        style: REGION_NAME_STYLE,
        resolution: TEXT_RESOLUTION,
      });
      label.anchor.set(0.5, 0.5);
      label.position.set(cx, cy);
      this.labelContainer.addChild(label);
      this.regionLabels.set(region.id, label);
    }
  }

  /** Per-frame LOD update */
  updateVisibility(lod: LODState) {
    this.boundaryGraphics.visible = lod.showRegionBoundaries;
    this.boundaryGraphics.alpha = lod.regionBoundaryAlpha;

    this.labelContainer.visible = lod.showRegionLabels;
    this.labelContainer.alpha = lod.regionLabelAlpha;
  }

  private clear() {
    this.boundaryGraphics.clear();
    for (const label of this.regionLabels.values()) {
      label.destroy();
    }
    this.regionLabels.clear();
    this.labelContainer.removeChildren();
  }

  destroy() {
    for (const label of this.regionLabels.values()) {
      label.destroy();
    }
    this.regionLabels.clear();
    this.boundaryGraphics.destroy();
    this.labelContainer.destroy({ children: true });
    this.container.destroy({ children: true });
  }
}

/**
 * Find the shared edge between two Voronoi cell polygons.
 * Returns the two endpoints of the shared edge, or null if none found.
 */
function findSharedEdge(
  polyA: Float64Array | number[][],
  polyB: Float64Array | number[][],
): { x1: number; y1: number; x2: number; y2: number } | null {
  const verticesA = polygonVertices(polyA);
  const verticesB = polygonVertices(polyB);

  const shared: { x: number; y: number }[] = [];
  for (const va of verticesA) {
    for (const vb of verticesB) {
      if (Math.abs(va.x - vb.x) < 0.5 && Math.abs(va.y - vb.y) < 0.5) {
        // Found a shared vertex
        if (!shared.some((s) => Math.abs(s.x - va.x) < 0.5 && Math.abs(s.y - va.y) < 0.5)) {
          shared.push(va);
        }
      }
    }
  }

  if (shared.length >= 2) {
    return { x1: shared[0].x, y1: shared[0].y, x2: shared[1].x, y2: shared[1].y };
  }
  return null;
}

function polygonVertices(poly: Float64Array | number[][]): { x: number; y: number }[] {
  const vertices: { x: number; y: number }[] = [];
  if (poly instanceof Float64Array) {
    for (let i = 0; i < poly.length; i += 2) {
      vertices.push({ x: poly[i], y: poly[i + 1] });
    }
  } else {
    for (const p of poly) {
      vertices.push({ x: p[0], y: p[1] });
    }
  }
  return vertices;
}
