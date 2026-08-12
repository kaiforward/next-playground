"use client";

import { Button } from "@/components/ui/button";
import { StarIcon } from "@/components/ui/icons";
import { QueryBoundary } from "@/components/ui/query-boundary";
import { useAtlas } from "@/lib/hooks/use-atlas";
import { useTracker } from "@/lib/hooks/use-tracker";
import { useSetSystemPin } from "@/lib/hooks/use-player-pins";

/**
 * Star toggle for the system panel header (docs/active/gameplay/tracker.md → "Pinning") — pins or
 * unpins the current system on the player's Tracker list. This is the keyboard route for both
 * directions; the unpin control inside a Tracker row's card (tracker-panel.tsx's `PinnedCard`) is a
 * mouse convenience, never the only way.
 *
 * A star, not the map-pin glyph "Show on Map" already uses in this same header — two pin glyphs
 * side by side would read as "find it" and "watch it" ambiguously (spec: "Pinning").
 *
 * Wrapped in its own `QueryBoundary` rather than reading `useTracker`/`useAtlas` inline in the
 * header: both are `useSuspenseQuery`s that refetch on every system change, and suspending here
 * must never blank the header's OTHER actions (the cadence countdown, "Show on Map") — only this
 * control's own slot goes quiet while its data loads. `loadingFallback={null}` keeps that slot
 * empty rather than substituting a spinner into a compact header row.
 */
export function PinToggle({ systemId }: { systemId: string }) {
  return (
    <QueryBoundary loadingFallback={null}>
      <PinToggleContent systemId={systemId} />
    </QueryBoundary>
  );
}

function PinToggleContent({ systemId }: { systemId: string }) {
  const { atlas } = useAtlas();
  const data = useTracker();
  const setPin = useSetSystemPin();

  // No player seat (e.g. the calibration harness has none): there is no Tracker list to join, and
  // `setSystemPin` rejects the write past the service boundary. Absent rather than rendered and
  // erroring on activation. `atlas.player` is the established client-side signal for this (already
  // read the same way in app/(game)/page.tsx) — `useTracker()`'s own empty sections read identically
  // whether the player has no seat or simply has nothing pinned yet, so it can't answer this alone.
  if (!atlas.player) return null;

  const pinned = data.pinned.some((row) => row.systemId === systemId);

  return (
    <Button
      variant="ghost"
      size="iconXs"
      aria-pressed={pinned}
      aria-label={pinned ? "Unpin system from Tracker" : "Pin system to Tracker"}
      disabled={setPin.isPending}
      onClick={() => setPin.mutate({ systemId, pinned: !pinned })}
    >
      <StarIcon aria-hidden className={pinned ? "fill-current" : undefined} />
    </Button>
  );
}
