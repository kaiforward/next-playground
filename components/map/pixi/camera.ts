import { CAMERA, ANIM } from "./theme";

export interface CameraState {
  x: number;
  y: number;
  zoom: number;
}

/* ------------------------------------------------------------------ */
/*  Keyboard-pan + click/drag helpers (pure)                          */
/* ------------------------------------------------------------------ */

export type PanDirection = "up" | "down" | "left" | "right";

/** WASD + arrow keys → a pan direction; null for anything else. */
export function codeToPanDirection(code: string): PanDirection | null {
  switch (code) {
    case "KeyW":
    case "ArrowUp":
      return "up";
    case "KeyS":
    case "ArrowDown":
      return "down";
    case "KeyA":
    case "ArrowLeft":
      return "left";
    case "KeyD":
    case "ArrowRight":
      return "right";
    default:
      return null;
  }
}

/** Sum held directions into a normalised screen-space vector (diagonals aren't faster). */
function panVector(dirs: Iterable<PanDirection>): { x: number; y: number } {
  let x = 0;
  let y = 0;
  for (const d of dirs) {
    if (d === "up") y -= 1;
    else if (d === "down") y += 1;
    else if (d === "left") x -= 1;
    else x += 1;
  }
  const len = Math.hypot(x, y);
  if (len === 0) return { x: 0, y: 0 };
  return { x: x / len, y: y / len };
}

interface PanDeltaOptions {
  dtMs: number;
  zoom: number;
  shiftHeld: boolean;
  speed: number;
  boost: number;
}

/**
 * World-space camera delta for the held pan keys this frame. Speed is constant in *screen* space
 * (÷ zoom), so panning feels identical at every zoom level; Shift applies the boost.
 */
export function keyboardPanDelta(
  dirs: Iterable<PanDirection>,
  { dtMs, zoom, shiftHeld, speed, boost }: PanDeltaOptions,
): { dx: number; dy: number } {
  const { x, y } = panVector(dirs);
  if (x === 0 && y === 0) return { dx: 0, dy: 0 };
  const screenPerSec = speed * (shiftHeld ? boost : 1);
  const worldStep = (screenPerSec * (dtMs / 1000)) / zoom;
  return { dx: x * worldStep, dy: y * worldStep };
}

/** True once the pointer has travelled past the threshold — a drag, not a click. */
export function movedBeyond(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  threshold: number,
): boolean {
  return Math.hypot(bx - ax, by - ay) > threshold;
}

/** Focus lives in a text-entry field → keyboard pan must stand down so it doesn't eat keystrokes. */
export function isTypingTarget(
  el: { tagName: string; isContentEditable: boolean } | null,
): boolean {
  if (!el) return false;
  if (el.isContentEditable) return true;
  return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT";
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

  // ── Keyboard-pan state ──────────────────────────────────────────
  private heldDirs = new Set<PanDirection>();
  private shiftHeld = false;

  // Bound handlers for cleanup
  private boundPointerDown: (e: PointerEvent) => void;
  private boundPointerMove: (e: PointerEvent) => void;
  private boundPointerUp: (e: PointerEvent) => void;
  private boundWheel: (e: WheelEvent) => void;
  private boundKeyDown: (e: KeyboardEvent) => void;
  private boundKeyUp: (e: KeyboardEvent) => void;
  private boundBlur: () => void;

  constructor() {
    this.boundPointerDown = this.onPointerDown.bind(this);
    this.boundPointerMove = this.onPointerMove.bind(this);
    this.boundPointerUp = this.onPointerUp.bind(this);
    this.boundWheel = this.onWheel.bind(this);
    this.boundKeyDown = this.onKeyDown.bind(this);
    this.boundKeyUp = this.onKeyUp.bind(this);
    this.boundBlur = this.clearHeldKeys.bind(this);
  }

  // ── Input binding ───────────────────────────────────────────────

  attach(canvas: HTMLCanvasElement) {
    canvas.addEventListener("pointerdown", this.boundPointerDown);
    canvas.addEventListener("pointermove", this.boundPointerMove);
    canvas.addEventListener("pointerup", this.boundPointerUp);
    canvas.addEventListener("pointerleave", this.boundPointerUp);
    canvas.addEventListener("wheel", this.boundWheel, { passive: false });
    // Keyboard pan is window-level so it works without first clicking the canvas.
    window.addEventListener("keydown", this.boundKeyDown);
    window.addEventListener("keyup", this.boundKeyUp);
    // The window can't see keyup while it's blurred (alt-tab, devtools, app switch), so drop any held
    // keys on blur — otherwise a key held at focus-loss would pan forever after the user returns.
    window.addEventListener("blur", this.boundBlur);
  }

  detach(canvas: HTMLCanvasElement) {
    canvas.removeEventListener("pointerdown", this.boundPointerDown);
    canvas.removeEventListener("pointermove", this.boundPointerMove);
    canvas.removeEventListener("pointerup", this.boundPointerUp);
    canvas.removeEventListener("pointerleave", this.boundPointerUp);
    canvas.removeEventListener("wheel", this.boundWheel);
    window.removeEventListener("keydown", this.boundKeyDown);
    window.removeEventListener("keyup", this.boundKeyUp);
    window.removeEventListener("blur", this.boundBlur);
    this.clearHeldKeys();
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

  /**
   * Centre the camera on world (x,y). `centerOffsetX` shifts the target left by that many screen
   * px worth of world units (at the final zoom), so the point lands `centerOffsetX` px RIGHT of
   * screen-center instead of dead-center — used to clear a left-docked drawer. Default 0 keeps the
   * point exactly at screen-center (unchanged behaviour).
   */
  setCenter(
    x: number,
    y: number,
    zoom: number,
    duration: number = ANIM.setCenterDuration,
    centerOffsetX = 0,
  ) {
    const cx = centerOffsetX ? x - centerOffsetX / zoom : x;
    if (duration > 0) {
      this.animateTo(cx, y, zoom, duration);
    } else {
      this.x = cx;
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
    let changed = false;

    // Held-key panning, independent of any glide animation (a keypress cancels the glide).
    if (this.heldDirs.size > 0) {
      const { dx, dy } = keyboardPanDelta(this.heldDirs, {
        dtMs,
        zoom: this.zoom,
        shiftHeld: this.shiftHeld,
        speed: CAMERA.panKeySpeed,
        boost: CAMERA.panKeyBoost,
      });
      if (dx !== 0 || dy !== 0) {
        this.x += dx;
        this.y += dy;
        changed = true;
      }
    }

    if (this.animation) {
      const a = this.animation;
      a.elapsed += dtMs;
      const t = Math.min(1, a.elapsed / a.duration);
      const e = easeOutCubic(t);

      this.x = a.startX + (a.endX - a.startX) * e;
      this.y = a.startY + (a.endY - a.startY) * e;
      this.zoom = a.startZoom + (a.endZoom - a.startZoom) * e;

      if (t >= 1) this.animation = null;
      changed = true;
    }

    return changed;
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
    if (!(e.target instanceof HTMLElement)) return;
    const rect = e.target.getBoundingClientRect();
    this.zoomAt(e.clientX - rect.left, e.clientY - rect.top, e.deltaY);
  }

  private onKeyDown(e: KeyboardEvent) {
    // Stand down while the player is typing (save-name box, dev tools, …).
    if (e.target instanceof HTMLElement && isTypingTarget(e.target)) return;
    // Let modifier shortcuts through (Ctrl/Cmd+A select-all, Ctrl/Cmd+arrow, …) — only Shift, the
    // pan boost, is ours. Without this the window-level listener would hijack them app-wide.
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    this.shiftHeld = e.shiftKey;
    const dir = codeToPanDirection(e.code);
    if (!dir) return;
    e.preventDefault(); // arrows would otherwise scroll the page
    this.heldDirs.add(dir);
    this.animation = null; // manual pan takes over any in-flight glide
  }

  private onKeyUp(e: KeyboardEvent) {
    this.shiftHeld = e.shiftKey;
    const dir = codeToPanDirection(e.code);
    if (dir) this.heldDirs.delete(dir);
  }

  /** Drop all held pan keys — used on window blur (no keyup arrives while blurred) and on detach. */
  private clearHeldKeys() {
    this.heldDirs.clear();
    this.shiftHeld = false;
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
