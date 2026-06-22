"use client";

import { createContext, useContext, useMemo, useState } from "react";

/**
 * Shared visibility state for dev-only map overlays. Lets the Dev Tools panel
 * toggle an overlay that another component (e.g. StarMap) renders, without
 * lifting that component's own state (zoom) out. Provided unconditionally — the
 * only writer is the dev-only panel, so in production `showMapDebug` stays false
 * and the overlay never mounts.
 */
interface DevOverlayState {
  showMapDebug: boolean;
  setShowMapDebug: (v: boolean) => void;
}

const DevOverlayContext = createContext<DevOverlayState | null>(null);

export function DevOverlayProvider({ children }: { children: React.ReactNode }) {
  const [showMapDebug, setShowMapDebug] = useState(false);
  const value = useMemo(() => ({ showMapDebug, setShowMapDebug }), [showMapDebug]);

  return <DevOverlayContext.Provider value={value}>{children}</DevOverlayContext.Provider>;
}

export function useDevOverlay(): DevOverlayState {
  const ctx = useContext(DevOverlayContext);
  if (!ctx) throw new Error("useDevOverlay must be used within DevOverlayProvider");
  return ctx;
}
