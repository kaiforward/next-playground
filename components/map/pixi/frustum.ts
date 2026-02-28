/**
 * Axis-aligned bounding box viewport check for frustum culling.
 * Computed once per frame from camera state, passed to layers.
 */

export class Frustum {
  private minX = 0;
  private minY = 0;
  private maxX = 0;
  private maxY = 0;

  /**
   * Update viewport bounds from camera state.
   * Adds generous padding (20%) to avoid pop-in at edges.
   */
  update(cameraX: number, cameraY: number, zoom: number, screenW: number, screenH: number) {
    const halfW = screenW / zoom / 2;
    const halfH = screenH / zoom / 2;
    const padX = halfW * 0.2;
    const padY = halfH * 0.2;
    this.minX = cameraX - halfW - padX;
    this.minY = cameraY - halfH - padY;
    this.maxX = cameraX + halfW + padX;
    this.maxY = cameraY + halfH + padY;
  }

  /** Is a point inside the viewport? */
  contains(x: number, y: number): boolean {
    return x >= this.minX && x <= this.maxX && y >= this.minY && y <= this.maxY;
  }

  /** Does a line segment intersect the viewport? */
  intersects(x1: number, y1: number, x2: number, y2: number): boolean {
    // If either endpoint is inside, it intersects
    if (this.contains(x1, y1) || this.contains(x2, y2)) return true;

    // Cohen-Sutherland-style: check if the line crosses any edge
    // Simplified: check if bounding box of segment overlaps viewport
    const segMinX = Math.min(x1, x2);
    const segMaxX = Math.max(x1, x2);
    const segMinY = Math.min(y1, y2);
    const segMaxY = Math.max(y1, y2);

    return segMaxX >= this.minX && segMinX <= this.maxX &&
           segMaxY >= this.minY && segMinY <= this.maxY;
  }
}
