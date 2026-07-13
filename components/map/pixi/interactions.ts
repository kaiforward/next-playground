import type { Application, FederatedPointerEvent } from "pixi.js";
import type { SystemLayer } from "./layers/system-layer";
import type { StarSystemInfo } from "@/lib/types/game";
import type { MapData } from "@/lib/hooks/use-map-data";
import type { SystemCells } from "./voronoi-cache";
import { SystemObject } from "./objects/system-object";
import { ANIM } from "./theme";

interface InteractionCallbacks {
  onSystemClick: (system: StarSystemInfo) => void;
  onEmptyClick: () => void;
}

/** Per-cell hit-testing context for value-mode empty-space clicks. */
interface CellContext {
  cells: SystemCells | null;
  isValueMode: boolean;
  toWorld: (screenX: number, screenY: number) => { x: number; y: number };
}

interface InteractionOptions {
  app: Application;
  systemLayer: SystemLayer;
  getCallbacks: () => InteractionCallbacks;
  getMapData: () => MapData;
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
  getMapData,
  getCellContext,
}: InteractionOptions): () => void {
  // ── System binding ────────────────────────────────────────────
  function bindSystem(obj: SystemObject) {
    obj.on("pointerdown", (e) => {
      e.stopPropagation();
      const { onSystemClick } = getCallbacks();
      const mapData = getMapData();
      const system = mapData.allSystems.find((s) => s.id === obj.systemId);
      if (system) onSystemClick(system);
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
    const { onSystemClick, onEmptyClick } = getCallbacks();
    const { cells, isValueMode, toWorld } = getCellContext();

    if (isValueMode && cells) {
      const w = toWorld(e.global.x, e.global.y);
      const systemId = cells.findSystemAt(w.x, w.y);
      if (systemId != null) {
        const system = getMapData().allSystems.find((s) => s.id === systemId);
        if (system) {
          onSystemClick(system);
          return;
        }
      }
    }

    // Outside the map extent, or a non-value mode → clear selection.
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
