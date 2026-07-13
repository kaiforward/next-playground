import { Container, Graphics } from "pixi.js";
import type { SystemCells } from "../voronoi-cache";

const HIGHLIGHT_COLOR = 0xffffff;
/** Stroke thickness in screen pixels, kept ~constant across zoom (world width = this / zoom). */
const HIGHLIGHT_SCREEN_WIDTH = 3;

/**
 * Draws a thick white edge around the hovered and selected Voronoi cells, so a
 * click's target is obvious before and after selecting. Always present (every
 * map mode, every zoom); never intercepts pointer events. Redraws only when the
 * hovered/selected cell changes or the zoom band shifts.
 */
export class CellHighlightLayer {
  readonly container = new Container();
  private gfx = new Graphics();
  private cells: SystemCells | null = null;
  private hoveredId: string | null = null;
  private selectedId: string | null = null;
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

  /** Per-frame: keep the edge a ~constant on-screen thickness. Redraws only on a real zoom change. */
  updateZoom(zoom: number) {
    if (Math.abs(zoom - this.zoom) < 1e-4) return;
    this.zoom = zoom;
    if (this.hoveredId !== null || this.selectedId !== null) this.redraw();
  }

  private redraw() {
    this.gfx.clear();
    if (!this.cells) return;
    const width = HIGHLIGHT_SCREEN_WIDTH / this.zoom;
    // Selected drawn first, hovered on top; both white, so overlap is seamless.
    for (const id of [this.selectedId, this.hoveredId]) {
      if (id === null) continue;
      const multiPoly = this.cells.cellsBySystemId.get(id);
      if (!multiPoly) continue;
      for (const poly of multiPoly) {
        const exterior = poly[0];
        if (!exterior || exterior.length < 3) continue;
        this.gfx.poly(exterior.flat()).stroke({ color: HIGHLIGHT_COLOR, width, alpha: 1 });
      }
    }
  }

  destroy() {
    this.gfx.destroy();
    this.container.destroy({ children: true });
  }
}
