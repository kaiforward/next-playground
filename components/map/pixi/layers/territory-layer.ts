import { Container, Graphics, Text, TextStyle } from "pixi.js";
import type { LODState } from "../lod";
import { TERRITORY, TEXT_COLORS, TEXT_RESOLUTION } from "../theme";
import type { MultiPolygon } from "../territory-utils";
import type { SystemCells } from "../voronoi-cache";
import type { AtlasSystem } from "@/lib/types/game";

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

/**
 * Pixi layer that draws region territory outlines: a uniform neutral-slate
 * border per region, no fill. Same Voronoi-union approach as the other
 * territory-band layers — the shared `SystemCells` grouped by `regionId` — and
 * the border carries no economy or faction tint, it's a plain spatial outline.
 * Region name labels sit at each region's system centroid.
 */
export class TerritoryLayer {
  readonly container = new Container();
  private territoryGraphics = new Graphics();
  private labelContainer = new Container();
  private regionLabels = new Map<string, Text>();

  // Cached region unions for lightweight border-only redraws
  private cachedTerritories: Map<string, MultiPolygon> | null = null;
  private lastRegionIds: string[] = [];

  constructor() {
    this.container.addChild(this.territoryGraphics);
    this.container.addChild(this.labelContainer);
  }

  /**
   * Render region border polygons from the shared cell diagram.
   * Called when system data changes (not per frame).
   */
  sync(cells: SystemCells, regions: RegionInfo[]) {
    const systems = cells.systems;
    if (systems.length < 3) {
      this.clear();
      return;
    }

    // Cache the region unions for lightweight border redraws
    this.cachedTerritories = cells.groupBy((s) => s.regionId);

    // Draw borders
    this.drawBorders();

    // Rebuild labels only if regions changed
    const regionIds = regions.map((r) => r.id).sort();
    const regionsChanged = regionIds.length !== this.lastRegionIds.length
      || regionIds.some((id, i) => id !== this.lastRegionIds[i]);

    if (regionsChanged) {
      this.lastRegionIds = regionIds;
      this.rebuildLabels(systems, regions);
    }
  }

  /** Redraw only polygon borders (no Voronoi recompute). No fill — transparent interior. */
  private drawBorders() {
    if (!this.cachedTerritories) return;

    this.territoryGraphics.clear();

    for (const [, multiPoly] of this.cachedTerritories) {
      for (const poly of multiPoly) {
        // Exterior ring (first ring)
        const exterior = poly[0];
        if (!exterior || exterior.length < 3) continue;

        this.territoryGraphics.poly(exterior.flat());
        this.territoryGraphics.stroke({
          color: TERRITORY.strokeColor,
          alpha: TERRITORY.strokeAlpha,
          width: TERRITORY.strokeWidth,
        });

        // Holes (remaining rings) — no fill underneath to cut out; stroke the
        // hole ring itself so the inner boundary still reads.
        for (let h = 1; h < poly.length; h++) {
          const hole = poly[h];
          if (!hole || hole.length < 3) continue;
          this.territoryGraphics.poly(hole.flat());
          this.territoryGraphics.stroke({
            color: TERRITORY.strokeColor,
            alpha: TERRITORY.strokeAlpha,
            width: TERRITORY.strokeWidth,
          });
        }
      }
    }
  }

  private rebuildLabels(systems: AtlasSystem[], regions: RegionInfo[]) {
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
    this.territoryGraphics.visible = lod.showTerritories;
    this.territoryGraphics.alpha = lod.territoryAlpha;

    this.labelContainer.visible = lod.showRegionLabels;
    this.labelContainer.alpha = lod.regionLabelAlpha;
  }

  private clear() {
    this.territoryGraphics.clear();
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
    this.territoryGraphics.destroy();
    this.labelContainer.destroy({ children: true });
    this.container.destroy({ children: true });
  }
}
