import { Container, Graphics, Text, TextStyle } from "pixi.js";
import { Delaunay } from "d3-delaunay";
import type { SystemNodeData } from "@/lib/hooks/use-map-data";
import type { LODState } from "../lod";
import { ECONOMY_COLORS, TERRITORY, TEXT_COLORS, TEXT_RESOLUTION } from "../theme";
import { UNIVERSE_GEN } from "@/lib/constants/universe-gen";
import { computeTerritoryPolygons } from "../territory-utils";
import type { EconomyType } from "@/lib/types/game";

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

export class TerritoryLayer {
  readonly container = new Container();
  private territoryGraphics = new Graphics();
  private labelContainer = new Container();
  private regionLabels = new Map<string, Text>();
  private playerRegionIds = new Set<string>();

  constructor() {
    this.container.addChild(this.territoryGraphics);
    this.container.addChild(this.labelContainer);
  }

  /**
   * Compute and render filled territory polygons per region.
   * Called when system data changes (not per frame).
   */
  sync(systems: SystemNodeData[], regions: RegionInfo[]) {
    if (systems.length < 3) {
      this.clear();
      return;
    }

    // Build Delaunay triangulation from system positions
    const points: [number, number][] = systems.map((s) => [s.x, s.y]);
    const delaunay = Delaunay.from(points);
    const size = UNIVERSE_GEN.MAP_SIZE;
    const voronoi = delaunay.voronoi([0, 0, size, size]);

    // Compute dominant economy per region for fill tinting
    const regionEconomyCounts = new Map<string, Map<EconomyType, number>>();
    for (const sys of systems) {
      let counts = regionEconomyCounts.get(sys.regionId);
      if (!counts) {
        counts = new Map();
        regionEconomyCounts.set(sys.regionId, counts);
      }
      counts.set(sys.economyType, (counts.get(sys.economyType) ?? 0) + 1);
    }

    const regionDominantEconomy = new Map<string, EconomyType>();
    for (const [regionId, counts] of regionEconomyCounts) {
      let maxCount = 0;
      let dominant: EconomyType = "industrial";
      for (const [econ, count] of counts) {
        if (count > maxCount) {
          maxCount = count;
          dominant = econ;
        }
      }
      regionDominantEconomy.set(regionId, dominant);
    }

    // Compute territory polygons by unioning Voronoi cells per region
    const territories = computeTerritoryPolygons(
      systems.length,
      voronoi,
      (i) => systems[i].regionId,
    );

    // Draw filled territory shapes
    this.territoryGraphics.clear();

    for (const [regionId, multiPoly] of territories) {
      const economy = regionDominantEconomy.get(regionId) ?? "industrial";
      const color = ECONOMY_COLORS[economy].core;
      const isPlayer = this.playerRegionIds.has(regionId);
      const fillAlpha = isPlayer ? TERRITORY.playerFillAlpha : TERRITORY.fillAlpha;

      for (const poly of multiPoly) {
        // Exterior ring (first ring)
        const exterior = poly[0];
        if (!exterior || exterior.length < 3) continue;

        this.territoryGraphics.poly(exterior.flat());
        this.territoryGraphics.fill({ color, alpha: fillAlpha });
        this.territoryGraphics.poly(exterior.flat());
        this.territoryGraphics.stroke({
          color,
          alpha: TERRITORY.strokeAlpha,
          width: TERRITORY.strokeWidth,
        });

        // Holes (remaining rings) — cut out with background color
        for (let h = 1; h < poly.length; h++) {
          const hole = poly[h];
          if (!hole || hole.length < 3) continue;
          this.territoryGraphics.poly(hole.flat());
          this.territoryGraphics.fill({ color: 0x030712, alpha: fillAlpha });
        }
      }
    }

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

  /** Update which regions have player presence (brighter fill) */
  setPlayerPresence(regionIds: Set<string>) {
    if (setsEqual(this.playerRegionIds, regionIds)) return;
    this.playerRegionIds = regionIds;
    // Requires re-sync to update fill colors — caller should trigger sync
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

function setsEqual<T>(a: Set<T>, b: Set<T>): boolean {
  if (a.size !== b.size) return false;
  for (const item of a) {
    if (!b.has(item)) return false;
  }
  return true;
}
