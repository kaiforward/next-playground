import type { Application, FederatedPointerEvent } from "pixi.js";
import type { SystemLayer } from "./layers/system-layer";
import type { SystemCells } from "./voronoi-cache";
import { SystemObject } from "./objects/system-object";
import { ANIM, CAMERA } from "./theme";
import { findFactionAt } from "./faction-hit-test";
import { movedBeyond } from "./camera";
import type { MultiPolygon } from "./territory-utils";

interface InteractionCallbacks {
  onSelectSystem: (systemId: string) => void;
  onEmptyClick: () => void;
  onSelectFaction: (factionId: string) => void;
}

/** Per-cell hit-testing context for empty-space clicks. */
interface CellContext {
  cells: SystemCells | null;
  toWorld: (screenX: number, screenY: number) => { x: number; y: number };
}

/** Zoomed-out faction hit-testing context — a click on a faction's territory selects the faction
 *  instead of the individual system underneath it (see `selectActive`, gated on zoom). */
interface FactionContext {
  unions: Map<string, MultiPolygon> | null;
  selectActive: boolean;
}

interface InteractionOptions {
  app: Application;
  systemLayer: SystemLayer;
  getCallbacks: () => InteractionCallbacks;
  getCellContext: () => CellContext;
  getFactionContext: () => FactionContext;
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
  getFactionContext,
}: InteractionOptions): () => void {
  // ── System binding ────────────────────────────────────────────
  // Selection is resolved centrally on the stage's pointer-up (below) via the Voronoi cell hit-test —
  // a star always sits inside its own cell, so the object only owns hover.
  function bindSystem(obj: SystemObject) {
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

  // ── Stage selection (pointer-up, click vs drag) ───────────────
  app.stage.eventMode = "static";
  app.stage.hitArea = app.screen;

  // Selection resolves on pointer-UP, and only when the pointer barely moved between down and up. A
  // real drag (past CAMERA.clickDragThreshold) pans the camera — handled by Camera's own DOM
  // listeners — and must NOT also select, which is what made the clickable cells "swallow" pans.
  let downX = 0;
  let downY = 0;
  let downRecorded = false;
  const onStageDown = (e: FederatedPointerEvent) => {
    downX = e.global.x;
    downY = e.global.y;
    downRecorded = true;
  };

  const onStageUp = (e: FederatedPointerEvent) => {
    // Only resolve a click for a pointerup that had its own pointerdown on the stage. Without one
    // (a gesture begun over an overlay, dragged onto the canvas) the down coords are stale, so skip
    // rather than measure travel from a bogus origin.
    const hadDown = downRecorded;
    downRecorded = false;
    if (!hadDown) return;
    if (movedBeyond(downX, downY, e.global.x, e.global.y, CAMERA.clickDragThreshold)) return;

    const { onSelectSystem, onEmptyClick, onSelectFaction } = getCallbacks();
    const { cells, toWorld } = getCellContext();
    const w = toWorld(e.global.x, e.global.y);

    // Zoomed out, a click on a faction's territory selects the faction (opens /factions/[id]); this
    // runs in every mode (political → panel; a value mode → also re-scopes via the pathname). Zoomed
    // in, selectActive is false and we fall through to per-cell system selection.
    const { unions, selectActive } = getFactionContext();
    if (selectActive && unions) {
      const factionId = findFactionAt(unions, w.x, w.y);
      if (factionId != null) {
        onSelectFaction(factionId);
        return;
      }
    }

    // A click anywhere inside a system's Voronoi cell selects that system — in every map mode, at
    // every zoom, whether or not it landed on the star.
    if (cells) {
      const systemId = cells.findSystemAt(w.x, w.y);
      if (systemId != null) {
        onSelectSystem(systemId);
        return;
      }
    }

    // Outside the map extent → clear the selection.
    onEmptyClick();
  };
  app.stage.on("pointerdown", onStageDown);
  app.stage.on("pointerup", onStageUp);

  // ── Cleanup ───────────────────────────────────────────────────
  return () => {
    for (const obj of systemLayer.getAllObjects()) obj.removeAllListeners();
    systemLayer.onObjectCreated = undefined;
    app.stage.off("pointerdown", onStageDown);
    app.stage.off("pointerup", onStageUp);
  };
}
