import type { Application } from "pixi.js";
import type { SystemLayer } from "./layers/system-layer";
import type { StarSystemInfo } from "@/lib/types/game";
import type { MapData } from "@/lib/hooks/use-map-data";
import { SystemObject } from "./objects/system-object";
import { ANIM } from "./theme";

interface InteractionCallbacks {
  onSystemClick: (system: StarSystemInfo) => void;
  onEmptyClick: () => void;
}

interface InteractionOptions {
  app: Application;
  systemLayer: SystemLayer;
  getCallbacks: () => InteractionCallbacks;
  getMapData: () => MapData;
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
      if (obj.cursor === "not-allowed") return;
      obj.scale.set(obj.scale.x * ANIM.hoverScale);
    });

    obj.on("pointerout", () => {
      const mapData = getMapData();
      const data = mapData.systems.find((s) => s.id === obj.systemId);
      if (data) {
        const baseScale =
          data.navigationState === "origin" || data.navigationState === "destination"
            ? 1.1
            : 1;
        obj.scale.set(baseScale);
      }
    });
  }

  // Bind existing objects
  for (const obj of systemLayer.getAllObjects()) bindSystem(obj);

  // Auto-bind new objects created during sync
  systemLayer.onObjectCreated = bindSystem;

  // ── Stage click (empty space) ─────────────────────────────────
  app.stage.eventMode = "static";
  app.stage.hitArea = app.screen;

  const onStageClick = () => {
    const { onEmptyClick } = getCallbacks();
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
