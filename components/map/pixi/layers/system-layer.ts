import { Container } from "pixi.js";
import { SystemObject } from "../objects/system-object";
import type { SystemNodeData } from "@/lib/hooks/use-map-data";
import type { MapMode } from "@/lib/types/map";
import type { Frustum } from "../frustum";
import type { LODState } from "../lod";
import type { SystemCells } from "../voronoi-cache";
import { labelFitsCell } from "../label-fit";
import { GLYPH, LABEL } from "../theme";

/** Max SystemObjects to create per frame to avoid freezing on zoom transitions. */
const MAX_CREATES_PER_FRAME = 50;

export class SystemLayer {
  readonly container = new Container();
  private objects = new Map<string, SystemObject>();
  private active = true;
  /** All system data — creation is deferred to updateVisibility (frustum-gated). */
  private systemData = new Map<string, SystemNodeData>();
  private selectedId: string | null = null;
  private hoveredId: string | null = null;
  // Active map mode — stored so objects created later inherit it (they subdue
  // the star dot under value modes). Pushed to live objects via setMode.
  private currentMode: MapMode = "none";

  // Cell-fit label pass. `cells` is the map's one Voronoi diagram (set once per atlas/region
  // change, `setCells`); `fitsById` caches each system's last fit answer so setHovered/setSelected
  // can recombine it with the override rule without re-running the polygon test; `lastFitZoom`
  // gates the full-set re-evaluation to the same relative zoom-change band `updateOutlineZoom`
  // uses (`LABEL.fitZoomStep`), so a continuous zoom gesture re-tests a bounded number of times.
  private cells: SystemCells | null = null;
  private fitsById = new Map<string, boolean>();
  private lastFitZoom = 0;

  /** Toggle active state. Hides container when inactive — objects are preserved. */
  setActive(active: boolean) {
    if (this.active === active) return;
    this.active = active;
    this.container.visible = active;
  }

  /**
   * Set the active map mode. Stored so objects created later inherit it, and
   * pushed to all live objects now (they subdue the star dot under value modes).
   */
  setMode(mode: MapMode) {
    this.currentMode = mode;
    for (const obj of this.objects.values()) {
      obj.setMode(mode);
    }
  }

  /**
   * Receive new system data from React. Updates existing objects immediately
   * but does NOT create new ones — that's updateVisibility's job (frustum-gated).
   */
  sync(systems: SystemNodeData[], selectedId: string | null) {
    const prevSelectedId = this.selectedId;
    this.selectedId = selectedId;

    // Rebuild data lookup
    const newData = new Map<string, SystemNodeData>();
    for (const data of systems) {
      newData.set(data.id, data);
    }
    this.systemData = newData;

    if (!this.active) return;

    // Update existing objects with fresh data
    for (const [id, obj] of this.objects) {
      const data = newData.get(id);
      if (data) {
        obj.update(data, id === selectedId);
      }
    }

    // Remove objects whose systems no longer exist in data
    for (const [id, obj] of this.objects) {
      if (!newData.has(id)) {
        this.container.removeChild(obj);
        obj.destroy({ children: true });
        this.objects.delete(id);
        this.fitsById.delete(id);
      }
    }

    // Selection is a name-shown override independent of the cached fit answer — apply it
    // immediately (not gated by the zoom-step fit pass) to both the system losing and the system
    // gaining selection.
    if (selectedId !== prevSelectedId) {
      this.refreshNameShown(prevSelectedId);
      this.refreshNameShown(selectedId);
    }
  }

  /** Hovered system — a name-shown override, same rule as selection. Independent of the cell-fit
   *  pass's zoom-step gate: hover changes on every pointer move, so it always applies immediately. */
  setHovered(systemId: string | null) {
    if (systemId === this.hoveredId) return;
    const prev = this.hoveredId;
    this.hoveredId = systemId;
    this.refreshNameShown(prev);
    this.refreshNameShown(systemId);
  }

  /** The map's Voronoi cells (`voronoi-cache.ts`), rebuilt on atlas/region change. Forces the next
   *  `updateVisibility` to re-run the fit pass over every visible system, since the geometry the
   *  fit answers are cached against just changed. */
  setCells(cells: SystemCells | null) {
    this.cells = cells;
    this.lastFitZoom = 0;
  }

  /** Recombine a system's cached fit answer with the selected/hovered override and push it to the
   *  object. No-op for a system with no live object (not created, or removed from data). */
  private refreshNameShown(systemId: string | null) {
    if (systemId === null) return;
    const obj = this.objects.get(systemId);
    if (!obj) return;
    const fits = this.fitsById.get(systemId) ?? false;
    obj.setNameShown(fits || systemId === this.selectedId || systemId === this.hoveredId);
  }

  /** Run the cell-fit test for one system against the current LOD/zoom, cache the answer, and push
   *  the combined (fit || selected || hovered) name-shown state to its object. */
  private updateFit(data: SystemNodeData, obj: SystemObject, lod: LODState) {
    const cell = this.cells?.cellsBySystemId.get(data.id);
    let fits = false;
    if (cell) {
      const { halfW, halfH } = obj.labelHalfExtentsWorld(lod.zoom);
      // The label anchors top-centre at `lift` below the star, so its box centre sits a further
      // half-height down.
      const lift = GLYPH.coreRadius * lod.systemDotScale + LABEL.offsetY / lod.zoom;
      fits = labelFitsCell({ x: data.x, y: data.y + lift + halfH }, halfW, halfH, cell);
    }
    this.fitsById.set(data.id, fits);
    obj.setNameShown(fits || data.id === this.selectedId || data.id === this.hoveredId);
  }

  // Accumulated clock for the settlement-mark pulse — shared so every forming
  // colony pulses in phase rather than each drifting from its creation time.
  private pulseTime = 0;

  /**
   * Per-frame: frustum culling + LOD + on-demand object creation.
   * Only creates SystemObjects for systems in the viewport, capped per frame.
   */
  updateVisibility(frustum: Frustum, lod: LODState, dtMs: number) {
    let createdThisFrame = 0;
    this.pulseTime += dtMs;

    // Re-run the fit pass over every visible system only when the zoom moved past the relative
    // step gate (or on the very first pass) — a continuous zoom gesture re-tests a bounded number
    // of times rather than every frame. An object created or re-entering the frustum this frame
    // always gets its own fit test regardless, so a system never shows a stale answer from before
    // it existed.
    const zoomMoved =
      this.lastFitZoom === 0 || Math.abs(lod.zoom - this.lastFitZoom) / this.lastFitZoom >= LABEL.fitZoomStep;

    for (const [id, data] of this.systemData) {
      const inView = frustum.contains(data.x, data.y);
      let obj = this.objects.get(id);
      let enteredFrustum = false;

      // Create on demand for visible systems (batched to avoid frame spikes)
      if (inView && !obj && createdThisFrame < MAX_CREATES_PER_FRAME) {
        obj = new SystemObject();
        this.objects.set(id, obj);
        this.container.addChild(obj);
        obj.setMode(this.currentMode);
        obj.update(data, id === this.selectedId);
        createdThisFrame++;
        enteredFrustum = true;
      }

      if (obj) {
        const wasVisible = obj.visible;
        obj.visible = inView;
        if (inView) {
          if (!wasVisible) enteredFrustum = true;
          if (zoomMoved || enteredFrustum) this.updateFit(data, obj, lod);
          obj.setLOD(lod);
          obj.tickSettlementPulse(this.pulseTime);
        }
      }
    }

    if (zoomMoved) this.lastFitZoom = lod.zoom;
  }

  getObject(systemId: string): SystemObject | undefined {
    return this.objects.get(systemId);
  }

  destroy() {
    for (const obj of this.objects.values()) {
      obj.destroy({ children: true });
    }
    this.objects.clear();
    this.container.destroy({ children: true });
  }
}
