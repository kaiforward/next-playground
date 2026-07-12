import { Container, Graphics } from "pixi.js";
import { Delaunay } from "d3-delaunay";
import type { LODState } from "../lod";
import { TERRITORY } from "../theme";
import { computeTerritoryPolygons } from "../territory-utils";
import { developmentRampColorPixi } from "@/lib/utils/development";
import type { AtlasSystem } from "@/lib/types/game";

/**
 * Per-system development choropleth. Geometry mirrors the other territory
 * layers (one Voronoi cell per system, computed in sync() and cached); fills
 * are redrawn from a live development map in setDevelopment(). Sits in the
 * territory band, so only one MODE fill is ever visible.
 *
 * Semantics: the ramp is ABSOLUTE (unlike population's relative ramp). Each
 * cell is filled straight from its 0..1 development value — warm = built-out,
 * cool = raw frontier — so the gradient is comparable across the whole galaxy
 * and stable as the viewport pans.
 */
export class DevelopmentTerritoryLayer {
  readonly container = new Container();
  private graphics = new Graphics();
  private cachedCells: Map<string, [number, number][][][]> | null = null;
  private developmentBySystem = new Map<string, number>();

  constructor() {
    this.container.addChild(this.graphics);
  }

  /** Compute per-system Voronoi cells from atlas positions (not per frame). */
  sync(systems: AtlasSystem[], mapSize: number) {
    if (systems.length < 3) {
      this.clear();
      return;
    }
    const points: [number, number][] = systems.map((s) => [s.x, s.y]);
    const voronoi = Delaunay.from(points).voronoi([0, 0, mapSize, mapSize]);
    this.cachedCells = computeTerritoryPolygons(
      systems.length,
      voronoi,
      (i) => systems[i].id,
    );
    this.drawFills();
  }

  /** Update per-system development values and redraw fills (cheap — no recompute). */
  setDevelopment(developmentBySystem: Map<string, number>) {
    this.developmentBySystem = developmentBySystem;
    this.drawFills();
  }

  private drawFills() {
    if (!this.cachedCells) return;
    this.graphics.clear();
    for (const [systemId, multiPoly] of this.cachedCells) {
      const value = this.developmentBySystem.get(systemId);
      if (value === undefined) continue;
      const color = developmentRampColorPixi(value);
      for (const poly of multiPoly) {
        const exterior = poly[0];
        if (!exterior || exterior.length < 3) continue;
        // Flatten once — reused for both the fill and stroke passes.
        const points = exterior.flat();
        this.graphics.poly(points);
        this.graphics.fill({ color, alpha: TERRITORY.fillAlpha });
        this.graphics.poly(points);
        this.graphics.stroke({
          color,
          alpha: TERRITORY.strokeAlpha,
          width: TERRITORY.strokeWidth,
        });
      }
    }
  }

  /** Per-frame LOD update (same gating as the other territory layers). */
  updateVisibility(lod: LODState) {
    this.graphics.visible = lod.showTerritories;
    this.graphics.alpha = lod.territoryAlpha;
  }

  private clear() {
    this.cachedCells = null;
    this.graphics.clear();
  }

  destroy() {
    this.graphics.destroy();
    this.container.destroy({ children: true });
  }
}
