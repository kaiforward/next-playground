import { Container, Graphics, Text, TextStyle } from "pixi.js";
import { Delaunay } from "d3-delaunay";
import type { LODState } from "../lod";
import { BG_COLOR, TERRITORY, TEXT_COLORS, TEXT_RESOLUTION } from "../theme";
import { computeTerritoryPolygons } from "../territory-utils";
import type { AtlasFaction, AtlasSystem } from "@/lib/types/game";

const FACTION_NAME_STYLE = new TextStyle({
  fontSize: 64,
  fill: TEXT_COLORS.primary,
  fontFamily: "system-ui, -apple-system, sans-serif",
  fontWeight: "bold",
  align: "center",
  letterSpacing: 8,
});

/** Factions with fewer systems than this don't get a name label. */
const LABEL_MIN_TERRITORY = 6;

/** Polygon fill / stroke alpha for political mode (slightly stronger than economy). */
const POLITICAL = {
  fillAlpha: 0.18,
  strokeAlpha: 0.55,
  strokeWidth: TERRITORY.strokeWidth,
} as const;

/**
 * Pixi layer that paints faction-coloured territory polygons.
 *
 * Sibling of `TerritoryLayer`: same Voronoi-union approach, but cells are
 * grouped by `factionId` (not `regionId`) and tinted with `Faction.color`.
 * The map's overlay-toggle picks which of the two is visible — the user
 * sees either the economy palette or the political palette, never both.
 */
export class PoliticalTerritoryLayer {
  readonly container = new Container();
  private territoryGraphics = new Graphics();
  private labelContainer = new Container();
  private factionLabels = new Map<string, Text>();

  private cachedTerritories: Map<string, [number, number][][][]> | null = null;
  private cachedColors: Map<string, number> | null = null;
  private lastFactionIds: string[] = [];

  constructor() {
    this.container.addChild(this.territoryGraphics);
    this.container.addChild(this.labelContainer);
    this.container.visible = false;
  }

  /** Show/hide the layer. When hidden, per-frame visibility logic still runs but nothing paints. */
  setActive(active: boolean) {
    this.container.visible = active;
  }

  /** Recompute territory polygons keyed by factionId. Call on system/faction data changes. */
  sync(systems: AtlasSystem[], factions: AtlasFaction[], mapSize: number) {
    if (systems.length < 3 || factions.length === 0) {
      this.clear();
      return;
    }

    const points: [number, number][] = systems.map((s) => [s.x, s.y]);
    const delaunay = Delaunay.from(points);
    const voronoi = delaunay.voronoi([0, 0, mapSize, mapSize]);

    const territories = computeTerritoryPolygons(
      systems.length,
      voronoi,
      (i) => systems[i].factionId ?? null,
    );

    const colors = new Map<string, number>();
    for (const f of factions) {
      colors.set(f.id, hexToNumber(f.color));
    }

    this.cachedTerritories = territories;
    this.cachedColors = colors;
    this.drawFills();

    const factionIds = factions.map((f) => f.id).sort();
    const factionsChanged =
      factionIds.length !== this.lastFactionIds.length ||
      factionIds.some((id, i) => id !== this.lastFactionIds[i]);

    if (factionsChanged) {
      this.lastFactionIds = factionIds;
      this.rebuildLabels(systems, factions);
    }
  }

  /** Per-frame LOD update (only matters while the layer is active). */
  updateVisibility(lod: LODState) {
    if (!this.container.visible) return;
    this.territoryGraphics.alpha = lod.politicalTerritoryAlpha;
    this.labelContainer.visible = lod.showRegionLabels;
    this.labelContainer.alpha = lod.regionLabelAlpha;
  }

  destroy() {
    for (const label of this.factionLabels.values()) {
      label.destroy();
    }
    this.factionLabels.clear();
    this.territoryGraphics.destroy();
    this.labelContainer.destroy({ children: true });
    this.container.destroy({ children: true });
  }

  private drawFills() {
    if (!this.cachedTerritories || !this.cachedColors) return;

    this.territoryGraphics.clear();

    for (const [factionId, multiPoly] of this.cachedTerritories) {
      const color = this.cachedColors.get(factionId);
      if (color === undefined) continue;

      for (const poly of multiPoly) {
        const exterior = poly[0];
        if (!exterior || exterior.length < 3) continue;

        this.territoryGraphics.poly(exterior.flat());
        this.territoryGraphics.fill({ color, alpha: POLITICAL.fillAlpha });
        this.territoryGraphics.poly(exterior.flat());
        this.territoryGraphics.stroke({
          color,
          alpha: POLITICAL.strokeAlpha,
          width: POLITICAL.strokeWidth,
        });

        for (let h = 1; h < poly.length; h++) {
          const hole = poly[h];
          if (!hole || hole.length < 3) continue;
          this.territoryGraphics.poly(hole.flat());
          this.territoryGraphics.fill({ color: BG_COLOR, alpha: POLITICAL.fillAlpha });
        }
      }
    }
  }

  private rebuildLabels(systems: AtlasSystem[], factions: AtlasFaction[]) {
    const sums = new Map<string, { x: number; y: number; count: number }>();
    for (const sys of systems) {
      if (!sys.factionId) continue;
      const sum = sums.get(sys.factionId) ?? { x: 0, y: 0, count: 0 };
      sum.x += sys.x;
      sum.y += sys.y;
      sum.count++;
      sums.set(sys.factionId, sum);
    }

    for (const label of this.factionLabels.values()) label.destroy();
    this.factionLabels.clear();
    this.labelContainer.removeChildren();

    for (const f of factions) {
      const sum = sums.get(f.id);
      if (!sum || sum.count < LABEL_MIN_TERRITORY) continue;
      const cx = sum.x / sum.count;
      const cy = sum.y / sum.count;

      const label = new Text({
        text: f.name.toUpperCase(),
        style: FACTION_NAME_STYLE,
        resolution: TEXT_RESOLUTION,
      });
      label.anchor.set(0.5, 0.5);
      label.position.set(cx, cy);
      this.labelContainer.addChild(label);
      this.factionLabels.set(f.id, label);
    }
  }

  private clear() {
    this.territoryGraphics.clear();
    for (const label of this.factionLabels.values()) label.destroy();
    this.factionLabels.clear();
    this.labelContainer.removeChildren();
    this.cachedTerritories = null;
    this.cachedColors = null;
  }
}

/** Convert "#aabbcc" → 0xaabbcc. Falls back to slate-400 on malformed input. */
function hexToNumber(hex: string): number {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return 0x94a3b8;
  return parseInt(m[1], 16);
}
