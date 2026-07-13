import { Container, Graphics } from "pixi.js";
import { Delaunay } from "d3-delaunay";
import type { LODState } from "../lod";
import { TERRITORY } from "../theme";
import { computeTerritoryPolygons } from "../territory-utils";
import { stabilityRampColorPixi } from "@/lib/utils/stability";
import type { AtlasSystem } from "@/lib/types/game";

/**
 * Per-system stability choropleth. Geometry (one Voronoi cell per system) is
 * computed from atlas positions in sync() and cached; fills are redrawn from a
 * live unrest map in setStability(). Sits in the territory band; only one map
 * MODE is visible at a time, so it never stacks with the other territory
 * fills.
 *
 * Semantics: high unrest = hot (red), low unrest = cool (green). Inverted from
 * the old prosperity ramp.
 */
export class StabilityTerritoryLayer {
  readonly container = new Container();
  private graphics = new Graphics();
  private cachedCells: Map<string, [number, number][][][]> | null = null;
  private unrestBySystem = new Map<string, number>();

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

  /** Update per-system unrest values and redraw fills (cheap — no recompute). */
  setStability(unrestBySystem: Map<string, number>) {
    this.unrestBySystem = unrestBySystem;
    this.drawFills();
  }

  private drawFills() {
    if (!this.cachedCells) return;
    this.graphics.clear();
    for (const [systemId, multiPoly] of this.cachedCells) {
      const value = this.unrestBySystem.get(systemId);
      if (value === undefined) continue;
      const color = stabilityRampColorPixi(value);
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
