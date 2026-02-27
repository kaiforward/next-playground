"use client";

import { useEffect, useRef, useState } from "react";
import { Application, Container } from "pixi.js";
import { Camera } from "./camera";
import { StarfieldLayer } from "./layers/starfield-layer";
import { SystemLayer } from "./layers/system-layer";
import { ConnectionLayer } from "./layers/connection-layer";
import { RegionLayer } from "./layers/region-layer";
import { EffectLayer } from "./layers/effect-layer";
import { setupInteractions } from "./interactions";
import { BG_COLOR } from "./theme";
import type { MapData } from "@/lib/hooks/use-map-data";
import type { MapViewLevel } from "@/lib/hooks/use-map-view-state";
import type { StarSystemInfo } from "@/lib/types/game";
import type { NavigationMode } from "@/lib/hooks/use-navigation-state";

export interface PixiMapCanvasProps {
  mapData: MapData;
  viewLevel: MapViewLevel;
  selectedSystem: StarSystemInfo | null;
  navigationMode: NavigationMode;
  onSystemClick: (system: StarSystemInfo) => void;
  onRegionClick: (regionId: string) => void;
  onEmptyClick: () => void;
  fitViewTrigger: number;
  centerTarget?: { x: number; y: number; zoom: number };
  onReady: () => void;
}

/** Holds all mutable Pixi references. Created once during mount. */
interface PixiRefs {
  app: Application;
  camera: Camera;
  world: Container;
  starfield: StarfieldLayer;
  systemLayer: SystemLayer;
  connectionLayer: ConnectionLayer;
  regionLayer: RegionLayer;
  effectLayer: EffectLayer;
}

export function PixiMapCanvas({
  mapData,
  viewLevel,
  selectedSystem,
  navigationMode,
  onSystemClick,
  onRegionClick,
  onEmptyClick,
  fitViewTrigger,
  centerTarget,
  onReady,
}: PixiMapCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const pixiRef = useRef<PixiRefs | null>(null);
  const readyFired = useRef(false);

  // Store callbacks in refs so Pixi event handlers always see latest
  const callbacksRef = useRef({ onSystemClick, onRegionClick, onEmptyClick });
  callbacksRef.current = { onSystemClick, onRegionClick, onEmptyClick };

  // Store latest data in ref for interaction handlers
  const mapDataRef = useRef(mapData);
  mapDataRef.current = mapData;

  // Signal to trigger data sync after Pixi is ready
  const [pixiReady, setPixiReady] = useState(false);

  // ── Mount: create Pixi application ──────────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let app: Application | null = null;
    const camera = new Camera();
    let destroyed = false;
    let interactionCleanup: (() => void) | undefined;

    (async () => {
      const pixi = new Application();
      await pixi.init({
        resizeTo: container,
        antialias: true,
        background: BG_COLOR,
        resolution: window.devicePixelRatio || 1,
        autoDensity: true,
      });

      if (destroyed) {
        pixi.destroy(true, { children: true });
        return;
      }

      app = pixi;
      container.appendChild(app.canvas);
      camera.setScreenSize(app.screen.width, app.screen.height);
      camera.attach(app.canvas as HTMLCanvasElement);

      // Create starfield (fixed to stage, not world — parallax is separate)
      const starfield = new StarfieldLayer();
      starfield.init(42);
      app.stage.addChild(starfield.container);

      // Create world container (all game objects)
      const world = new Container();
      app.stage.addChild(world);

      // Create layers in z-order (bottom to top)
      const connectionLayer = new ConnectionLayer();
      world.addChild(connectionLayer.container);

      const regionLayer = new RegionLayer();
      world.addChild(regionLayer.container);

      const systemLayer = new SystemLayer();
      world.addChild(systemLayer.container);

      const effectLayer = new EffectLayer();
      world.addChild(effectLayer.container);

      // Setup interactions (binds to onObjectCreated callbacks for auto-binding)
      interactionCleanup = setupInteractions({
        app,
        systemLayer,
        regionLayer,
        getCallbacks: () => callbacksRef.current,
        getMapData: () => mapDataRef.current,
      });

      // Keep camera screen size in sync with Pixi's own resize
      app.renderer.on("resize", (width: number, height: number) => {
        camera.setScreenSize(width, height);
      });

      // Main render loop
      app.ticker.add((ticker) => {
        const dtMs = ticker.deltaMS;
        camera.update(dtMs);

        const t = camera.getTransform();
        world.position.set(t.x, t.y);
        world.scale.set(t.scale);

        starfield.update(camera.x, camera.y, dtMs);
        effectLayer.update(dtMs);
      });

      // Store refs and signal ready
      pixiRef.current = {
        app, camera, world, starfield,
        systemLayer, connectionLayer, regionLayer, effectLayer,
      };
      setPixiReady(true);
    })();

    return () => {
      destroyed = true;
      interactionCleanup?.();
      if (app) {
        camera.detach(app.canvas as HTMLCanvasElement);
        app.destroy(true, { children: true });
      }
      pixiRef.current = null;
      setPixiReady(false);
    };
    // Mount once only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Sync map data → Pixi display objects ────────────────────────
  useEffect(() => {
    const p = pixiRef.current;
    if (!p || !pixiReady) return;

    if (viewLevel.level === "system") {
      p.regionLayer.container.visible = false;
      p.systemLayer.container.visible = true;
      p.connectionLayer.container.visible = true;
      p.effectLayer.container.visible = true;

      p.systemLayer.sync(mapData.systems, selectedSystem?.id ?? null);
      p.connectionLayer.syncSystems(mapData.connections, mapData.systems);
      p.effectLayer.syncRoute(mapData.connections, mapData.systems);
      p.effectLayer.syncPulseRings(mapData.systems, navigationMode.phase === "default");
    } else {
      p.regionLayer.container.visible = true;
      p.systemLayer.container.visible = false;
      p.effectLayer.container.visible = false;

      p.regionLayer.sync(mapData.regions);
      // Connection layer shows inter-region edges in region view
      p.connectionLayer.container.visible = true;
      p.connectionLayer.syncRegions(mapData.connections, mapData.regions);
    }
  }, [mapData, viewLevel, selectedSystem, navigationMode, pixiReady]);

  // ── fitView trigger ─────────────────────────────────────────────
  const prevFitView = useRef(fitViewTrigger);
  useEffect(() => {
    const p = pixiRef.current;
    if (!p || !pixiReady) return;
    if (fitViewTrigger === prevFitView.current && readyFired.current) return;
    prevFitView.current = fitViewTrigger;

    const items = viewLevel.level === "system" ? mapData.systems : mapData.regions;
    if (items.length === 0) return;

    const bounds = computeBounds(items);
    p.camera.fitView(bounds, undefined, readyFired.current ? undefined : 0);

    if (!readyFired.current) {
      readyFired.current = true;
      onReady();
    }
  }, [fitViewTrigger, viewLevel, mapData.systems, mapData.regions, onReady, pixiReady]);

  // ── centerTarget (initial system center) ────────────────────────
  const centerApplied = useRef(false);
  useEffect(() => {
    const p = pixiRef.current;
    if (!p || !pixiReady || !centerTarget || centerApplied.current) return;
    centerApplied.current = true;
    p.camera.setCenter(centerTarget.x, centerTarget.y, centerTarget.zoom, 0);
    if (!readyFired.current) {
      readyFired.current = true;
      onReady();
    }
  }, [centerTarget, onReady, pixiReady]);

  return (
    <div
      ref={containerRef}
      className="absolute inset-0"
      style={{ touchAction: "none" }}
    />
  );
}

// ── Helpers ────────────────────────────────────────────────────────

function computeBounds(items: { x: number; y: number }[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const item of items) {
    if (item.x < minX) minX = item.x;
    if (item.y < minY) minY = item.y;
    if (item.x > maxX) maxX = item.x;
    if (item.y > maxY) maxY = item.y;
  }
  return { minX, minY, maxX, maxY };
}
