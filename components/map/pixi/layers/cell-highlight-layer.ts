import { Container, Graphics } from "pixi.js";
import type { SystemCells } from "../voronoi-cache";
import type { MultiPolygon } from "../territory-utils";

const HIGHLIGHT_COLOR = 0xffffff;
/** Stroke thickness in screen pixels, kept ~constant across zoom (world width = this / zoom). */
const HIGHLIGHT_SCREEN_WIDTH = 3;

/**
 * Draws a thick white edge around the current hover/selection target so a click's target is obvious
 * before and after selecting. Always present (every map mode, every zoom); never intercepts pointer
 * events. Zoomed IN the target is a single Voronoi cell (a system); zoomed OUT (where a click selects a
 * faction) the hover target is the whole faction union — the caller decides which by setting `hovered`
 * (cell) vs `hoveredFaction` (union) and clearing the other. Redraws only when a target or the zoom band
 * changes.
 */
export class CellHighlightLayer {
  readonly container = new Container();
  private gfx = new Graphics();
  private cells: SystemCells | null = null;
  private factionUnions: Map<string, MultiPolygon> | null = null;
  private hoveredId: string | null = null;
  private selectedId: string | null = null;
  private hoveredFactionId: string | null = null;
  private zoom = 1;

  constructor() {
    this.container.addChild(this.gfx);
    // Purely decorative — clicks pass through to the stars / stage.
    this.container.eventMode = "none";
  }

  /** Static geometry — call on atlas change. */
  setCells(cells: SystemCells) {
    this.cells = cells;
    this.redraw();
  }

  /** Faction unions (from the political layer) — call on atlas/faction change. */
  setFactionUnions(unions: Map<string, MultiPolygon> | null) {
    this.factionUnions = unions;
    this.redraw();
  }

  setHovered(systemId: string | null) {
    if (systemId === this.hoveredId) return;
    this.hoveredId = systemId;
    this.redraw();
  }

  setSelected(systemId: string | null) {
    if (systemId === this.selectedId) return;
    this.selectedId = systemId;
    this.redraw();
  }

  /** Zoomed-out hover target: outline the whole faction union instead of a single cell. */
  setHoveredFaction(factionId: string | null) {
    if (factionId === this.hoveredFactionId) return;
    this.hoveredFactionId = factionId;
    this.redraw();
  }

  /** Per-frame: keep the edge a ~constant on-screen thickness. Redraws only on a real zoom change. */
  updateZoom(zoom: number) {
    if (Math.abs(zoom - this.zoom) < 1e-4) return;
    this.zoom = zoom;
    if (this.hoveredId !== null || this.selectedId !== null || this.hoveredFactionId !== null) this.redraw();
  }

  private strokeExteriorRings(multiPoly: MultiPolygon, width: number) {
    for (const poly of multiPoly) {
      const exterior = poly[0];
      if (!exterior || exterior.length < 3) continue;
      this.gfx.poly(exterior.flat()).stroke({ color: HIGHLIGHT_COLOR, width, alpha: 1 });
    }
  }

  private redraw() {
    this.gfx.clear();
    const width = HIGHLIGHT_SCREEN_WIDTH / this.zoom;

    // Zoomed-out faction hover — outline the whole union.
    if (this.hoveredFactionId !== null) {
      const union = this.factionUnions?.get(this.hoveredFactionId);
      if (union) this.strokeExteriorRings(union, width);
    }

    // Cell hover/selection — outline the cell(s). Selected drawn first, hovered on top; both white, so
    // overlap is seamless.
    if (this.cells) {
      for (const id of [this.selectedId, this.hoveredId]) {
        if (id === null) continue;
        const multiPoly = this.cells.cellsBySystemId.get(id);
        if (!multiPoly) continue;
        this.strokeExteriorRings(multiPoly, width);
      }
    }
  }

  destroy() {
    this.gfx.destroy();
    this.container.destroy({ children: true });
  }
}
