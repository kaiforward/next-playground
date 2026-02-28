"use client";

import { useEffect, useRef, useState } from "react";
import { Application, Container } from "pixi.js";
import { Camera } from "./camera";
import { Frustum } from "./frustum";
import { computeLOD } from "./lod";
import { StarfieldLayer } from "./layers/starfield-layer";
import { SystemLayer } from "./layers/system-layer";
import { ConnectionLayer } from "./layers/connection-layer";
import { RegionBoundaryLayer } from "./layers/region-boundary-layer";
import { EffectLayer } from "./layers/effect-layer";
import { setupInteractions } from "./interactions";
import { BG_COLOR } from "./theme";
import type { MapData } from "@/lib/hooks/use-map-data";
import type { StarSystemInfo } from "@/lib/types/game";
import type { NavigationMode } from "@/lib/hooks/use-navigation-state";

export interface PixiMapCanvasProps {
  mapData: MapData;
  selectedSystem: StarSystemInfo | null;
  navigationMode: NavigationMode;
  onSystemClick: (system: StarSystemInfo) => void;
  onEmptyClick: () => void;
  centerTarget?: { x: number; y: number; zoom: number };
  onReady: () => void;
  regionInfos: { id: string; name: string }[];
}

/** Holds all mutable Pixi references. Created once during mount. */
interface PixiRefs {
  app: Application;
  camera: Camera;
  frustum: Frustum;
  world: Container;
  starfield: StarfieldLayer;
  systemLayer: SystemLayer;
  connectionLayer: ConnectionLayer;
  regionBoundaryLayer: RegionBoundaryLayer;
  effectLayer: EffectLayer;
}

export function PixiMapCanvas({
  mapData,
  selectedSystem,
  navigationMode,
  onSystemClick,
  onEmptyClick,
  centerTarget,
  onReady,
  regionInfos,
}: PixiMapCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const pixiRef = useRef<PixiRefs | null>(null);
  const readyFired = useRef(false);

  // Store callbacks in refs so Pixi event handlers always see latest
  const callbacksRef = useRef({ onSystemClick, onEmptyClick });
  callbacksRef.current = { onSystemClick, onEmptyClick };

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
    const frustum = new Frustum();
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

      const regionBoundaryLayer = new RegionBoundaryLayer();
      world.addChild(regionBoundaryLayer.container);

      const systemLayer = new SystemLayer();
      world.addChild(systemLayer.container);

      const effectLayer = new EffectLayer();
      world.addChild(effectLayer.container);

      // Setup interactions
      interactionCleanup = setupInteractions({
        app,
        systemLayer,
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

        // Update frustum + LOD
        frustum.update(camera.x, camera.y, camera.zoom, app!.screen.width, app!.screen.height);
        const lod = computeLOD(camera.zoom);

        // Apply per-frame visibility
        systemLayer.updateVisibility(frustum, lod);
        connectionLayer.updateVisibility(frustum, lod);
        regionBoundaryLayer.updateVisibility(lod);

        // Effect layer visibility based on LOD
        effectLayer.container.visible = lod.showEffects;

        starfield.update(camera.x, camera.y, dtMs);
        effectLayer.update(dtMs);
      });

      // Store refs and signal ready
      pixiRef.current = {
        app, camera, frustum, world, starfield,
        systemLayer, connectionLayer, regionBoundaryLayer, effectLayer,
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

    // Sync all systems and connections (no view level switching)
    p.systemLayer.sync(mapData.systems, selectedSystem?.id ?? null);
    p.connectionLayer.sync(mapData.connections, mapData.systems);
    const routePath = navigationMode.phase === "route_preview" ? navigationMode.route.path : undefined;
    p.effectLayer.syncRoute(mapData.connections, mapData.systems, routePath);
    p.effectLayer.syncPulseRings(mapData.systems, navigationMode.phase === "default");
    p.regionBoundaryLayer.sync(mapData.systems, regionInfos);
  }, [mapData, selectedSystem, navigationMode, pixiReady, regionInfos]);

  // ── Initial fitView ───────────────────────────────────────────
  useEffect(() => {
    const p = pixiRef.current;
    if (!p || !pixiReady || readyFired.current) return;

    if (mapData.systems.length === 0) return;

    // If we have a specific center target, use that
    // Otherwise fit view to all systems
    if (!centerTarget) {
      const bounds = computeBounds(mapData.systems);
      p.camera.fitView(bounds, undefined, 0);
    }

    readyFired.current = true;
    onReady();
  }, [mapData.systems, onReady, pixiReady, centerTarget]);

  // ── centerTarget (pan camera to system) ─────────────────────────
  const lastCenterRef = useRef<typeof centerTarget>(undefined);
  useEffect(() => {
    const p = pixiRef.current;
    if (!p || !pixiReady || !centerTarget) return;
    if (centerTarget === lastCenterRef.current) return;
    lastCenterRef.current = centerTarget;
    const isInitial = !readyFired.current;
    p.camera.setCenter(centerTarget.x, centerTarget.y, centerTarget.zoom, isInitial ? 0 : 400);
    if (isInitial) {
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
