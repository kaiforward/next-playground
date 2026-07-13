import type { Application, FederatedPointerEvent } from "pixi.js";
import type { SystemLayer } from "./layers/system-layer";
import type { SystemCells } from "./voronoi-cache";
import { SystemObject } from "./objects/system-object";
import { ANIM } from "./theme";

interface InteractionCallbacks {
  onSelectSystem: (systemId: string) => void;
  onEmptyClick: () => void;
}

/** Per-cell hit-testing context for empty-space clicks. */
interface CellContext {
  cells: SystemCells | null;
  toWorld: (screenX: number, screenY: number) => { x: number; y: number };
}

interface InteractionOptions {
  app: Application;
  systemLayer: SystemLayer;
  getCallbacks: () => InteractionCallbacks;
  getCellContext: () => CellContext;
}

/**
 * Sets up interaction event handlers for the map.
 * Configures onObjectCreated callbacks on layers so new objects
 * get events bound automatically during sync().
 * Returns a cleanup function.
 */
export function setupInteractions({
  app,
  systemLayer,
  getCallbacks,
  getCellContext,
}: InteractionOptions): () => void {
  // ── System binding ────────────────────────────────────────────
  function bindSystem(obj: SystemObject) {
    obj.on("pointerdown", (e) => {
      e.stopPropagation();
      getCallbacks().onSelectSystem(obj.systemId);
    });

    obj.on("pointerover", () => {
      // Hover reveals overlay-gated pills.
      obj.setHovered(true);
      obj.scale.set(ANIM.hoverScale);
    });

    obj.on("pointerout", () => {
      obj.setHovered(false);
      obj.scale.set(1);
    });
  }

  // Bind existing objects
  for (const obj of systemLayer.getAllObjects()) bindSystem(obj);

  // Auto-bind new objects created during sync
  systemLayer.onObjectCreated = bindSystem;

  // ── Stage click (empty space) ─────────────────────────────────
  app.stage.eventMode = "static";
  app.stage.hitArea = app.screen;

  const onStageClick = (e: FederatedPointerEvent) => {
    const { onSelectSystem, onEmptyClick } = getCallbacks();
    const { cells, toWorld } = getCellContext();

    // A click anywhere inside a system's Voronoi cell selects that system — in
    // every map mode, at every zoom. The star's own pointerdown handles direct
    // hits (and stopPropagation()s), so this resolves clicks that miss a star.
    if (cells) {
      const w = toWorld(e.global.x, e.global.y);
      const systemId = cells.findSystemAt(w.x, w.y);
      if (systemId != null) {
        onSelectSystem(systemId);
        return;
      }
    }

    // Outside the map extent → clear the selection.
    onEmptyClick();
  };
  app.stage.on("pointerdown", onStageClick);

  // ── Cleanup ───────────────────────────────────────────────────
  return () => {
    for (const obj of systemLayer.getAllObjects()) obj.removeAllListeners();
    systemLayer.onObjectCreated = undefined;
    app.stage.off("pointerdown", onStageClick);
  };
}
