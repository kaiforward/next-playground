import { Container, Graphics } from "pixi.js";
import { Delaunay } from "d3-delaunay";
import type { LODState } from "../lod";
import { TERRITORY } from "../theme";
import { computeTerritoryPolygons } from "../territory-utils";
import { populationRampColorPixi } from "@/lib/utils/population";
import type { AtlasSystem } from "@/lib/types/game";

/**
 * Per-system population choropleth. Geometry mirrors StabilityTerritoryLayer
 * (one Voronoi cell per system, computed in sync() and cached); fills are
 * redrawn from a live population map in setPopulation(). Sits in the territory
 * band, so it never stacks with the other MODE fills — only one is visible.
 *
 * Semantics: the ramp is RELATIVE. Each redraw normalises against the highest
 * population among the systems in the map (which the caller has already
 * fog-gated), so green = the fullest visible system and red = zero population.
 */
export class PopulationTerritoryLayer {
  readonly container = new Container();
  private graphics = new Graphics();
  private cachedCells: Map<string, [number, number][][][]> | null = null;
  private populationBySystem = new Map<string, number>();

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

  /** Update per-system population values and redraw fills (cheap — no recompute). */
  setPopulation(populationBySystem: Map<string, number>) {
    this.populationBySystem = populationBySystem;
    this.drawFills();
  }

  private drawFills() {
    if (!this.cachedCells) return;
    this.graphics.clear();
    // Normalise against the highest population in the (already fog-gated) map so
    // the ramp is relative to the systems the player can currently see.
    let max = 0;
    for (const value of this.populationBySystem.values()) {
      if (value > max) max = value;
    }
    for (const [systemId, multiPoly] of this.cachedCells) {
      const value = this.populationBySystem.get(systemId);
      if (value === undefined) continue;
      const ratio = max > 0 ? value / max : 0;
      const color = populationRampColorPixi(ratio);
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
