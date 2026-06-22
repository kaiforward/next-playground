"use client";

import { Button } from "@/components/ui/button";
import { useDevOverlay } from "./dev-overlay-context";

/**
 * Toggles the on-map zoom/LOD readout (`MapZoomDebug`). Off by default — flip it
 * on while tuning the thresholds in `pixi/lod.ts`, then off to declutter the map.
 */
export function MapDebugSection() {
  const { showMapDebug, setShowMapDebug } = useDevOverlay();

  return (
    <div className="space-y-2">
      <p className="text-xs text-text-secondary">
        On-map readout of the live camera zoom and the LOD state derived from it — every
        layer&apos;s visibility gate and fade alpha. For tuning <code>pixi/lod.ts</code>.
      </p>
      <Button
        variant="ghost"
        size="xs"
        onClick={() => setShowMapDebug(!showMapDebug)}
      >
        {showMapDebug ? "Hide zoom/LOD overlay" : "Show zoom/LOD overlay"}
      </Button>
    </div>
  );
}
