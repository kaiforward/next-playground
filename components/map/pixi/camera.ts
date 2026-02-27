import { CAMERA, ANIM } from "./theme";

export interface CameraState {
  x: number;
  y: number;
  zoom: number;
}

interface CameraAnimation {
  startX: number;
  startY: number;
  startZoom: number;
  endX: number;
  endY: number;
  endZoom: number;
  duration: number;
  elapsed: number;
}

/** Ease-out cubic: decelerates nicely into target */
function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

export class Camera {
  x = 0;
  y = 0;
  zoom = 1;

  private screenWidth = 0;
  private screenHeight = 0;
  private animation: CameraAnimation | null = null;

  // ── Drag state ──────────────────────────────────────────────────
  private dragging = false;
  private lastPointerX = 0;
  private lastPointerY = 0;

  // Bound handlers for cleanup
  private boundPointerDown: (e: PointerEvent) => void;
  private boundPointerMove: (e: PointerEvent) => void;
  private boundPointerUp: (e: PointerEvent) => void;
  private boundWheel: (e: WheelEvent) => void;

  constructor() {
    this.boundPointerDown = this.onPointerDown.bind(this);
    this.boundPointerMove = this.onPointerMove.bind(this);
    this.boundPointerUp = this.onPointerUp.bind(this);
    this.boundWheel = this.onWheel.bind(this);
  }

  // ── Input binding ───────────────────────────────────────────────

  attach(canvas: HTMLCanvasElement) {
    canvas.addEventListener("pointerdown", this.boundPointerDown);
    canvas.addEventListener("pointermove", this.boundPointerMove);
    canvas.addEventListener("pointerup", this.boundPointerUp);
    canvas.addEventListener("pointerleave", this.boundPointerUp);
    canvas.addEventListener("wheel", this.boundWheel, { passive: false });
  }

  detach(canvas: HTMLCanvasElement) {
    canvas.removeEventListener("pointerdown", this.boundPointerDown);
    canvas.removeEventListener("pointermove", this.boundPointerMove);
    canvas.removeEventListener("pointerup", this.boundPointerUp);
    canvas.removeEventListener("pointerleave", this.boundPointerUp);
    canvas.removeEventListener("wheel", this.boundWheel);
  }

  setScreenSize(w: number, h: number) {
    this.screenWidth = w;
    this.screenHeight = h;
  }

  // ── Public API ──────────────────────────────────────────────────

  pan(dx: number, dy: number) {
    this.x -= dx / this.zoom;
    this.y -= dy / this.zoom;
  }

  zoomAt(screenX: number, screenY: number, delta: number) {
    const worldBefore = this.screenToWorld(screenX, screenY);
    this.zoom = Math.max(
      CAMERA.minZoom,
      Math.min(CAMERA.maxZoom, this.zoom * (1 - delta * CAMERA.zoomStep)),
    );
    const worldAfter = this.screenToWorld(screenX, screenY);
    this.x += worldBefore.x - worldAfter.x;
    this.y += worldBefore.y - worldAfter.y;
  }

  fitView(
    bounds: { minX: number; minY: number; maxX: number; maxY: number },
    padding: number = CAMERA.fitViewPadding,
    duration: number = ANIM.fitViewDuration,
  ) {
    const bw = bounds.maxX - bounds.minX;
    const bh = bounds.maxY - bounds.minY;
    const cx = bounds.minX + bw / 2;
    const cy = bounds.minY + bh / 2;
    const zx = this.screenWidth / (bw * (1 + padding * 2));
    const zy = this.screenHeight / (bh * (1 + padding * 2));
    const zoom = Math.max(CAMERA.minZoom, Math.min(CAMERA.maxZoom, Math.min(zx, zy)));

    if (duration > 0) {
      this.animateTo(cx, cy, zoom, duration);
    } else {
      this.x = cx;
      this.y = cy;
      this.zoom = zoom;
    }
  }

  setCenter(x: number, y: number, zoom: number, duration: number = ANIM.setCenterDuration) {
    if (duration > 0) {
      this.animateTo(x, y, zoom, duration);
    } else {
      this.x = x;
      this.y = y;
      this.zoom = zoom;
    }
  }

  // ── Transforms ──────────────────────────────────────────────────

  worldToScreen(wx: number, wy: number): { x: number; y: number } {
    return {
      x: (wx - this.x) * this.zoom + this.screenWidth / 2,
      y: (wy - this.y) * this.zoom + this.screenHeight / 2,
    };
  }

  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    return {
      x: (sx - this.screenWidth / 2) / this.zoom + this.x,
      y: (sy - this.screenHeight / 2) / this.zoom + this.y,
    };
  }

  getTransform(): { x: number; y: number; scale: number } {
    return {
      x: this.screenWidth / 2 - this.x * this.zoom,
      y: this.screenHeight / 2 - this.y * this.zoom,
      scale: this.zoom,
    };
  }

  // ── Animation tick ──────────────────────────────────────────────

  /** Call from Pixi ticker. Returns true if camera changed. */
  update(dtMs: number): boolean {
    if (!this.animation) return false;
    const a = this.animation;
    a.elapsed += dtMs;
    const t = Math.min(1, a.elapsed / a.duration);
    const e = easeOutCubic(t);

    this.x = a.startX + (a.endX - a.startX) * e;
    this.y = a.startY + (a.endY - a.startY) * e;
    this.zoom = a.startZoom + (a.endZoom - a.startZoom) * e;

    if (t >= 1) this.animation = null;
    return true;
  }

  get isAnimating(): boolean {
    return this.animation !== null;
  }

  // ── Input handlers ──────────────────────────────────────────────

  private onPointerDown(e: PointerEvent) {
    // Left button or middle button for pan
    if (e.button === 0 || e.button === 1) {
      this.dragging = true;
      this.lastPointerX = e.clientX;
      this.lastPointerY = e.clientY;
    }
  }

  private onPointerMove(e: PointerEvent) {
    if (!this.dragging) return;
    const dx = e.clientX - this.lastPointerX;
    const dy = e.clientY - this.lastPointerY;
    this.lastPointerX = e.clientX;
    this.lastPointerY = e.clientY;
    this.pan(dx, dy);
  }

  private onPointerUp(_e: PointerEvent) {
    this.dragging = false;
  }

  private onWheel(e: WheelEvent) {
    e.preventDefault();
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    this.zoomAt(e.clientX - rect.left, e.clientY - rect.top, e.deltaY);
  }

  // ── Internal ────────────────────────────────────────────────────

  private animateTo(x: number, y: number, zoom: number, duration: number) {
    this.animation = {
      startX: this.x,
      startY: this.y,
      startZoom: this.zoom,
      endX: x,
      endY: y,
      endZoom: zoom,
      duration,
      elapsed: 0,
    };
  }
}
