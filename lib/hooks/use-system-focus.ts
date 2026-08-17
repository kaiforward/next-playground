"use client";

import { useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAtlas } from "@/lib/hooks/use-atlas";
import type { SystemTabSegment } from "@/lib/constants/system-tabs";

/**
 * Fly-to-system-and-open-tab navigation — extracted from `TrackerPanel`'s own `activate`
 * (`components/tracker/tracker-panel.tsx`) the moment a second consumer needed it
 * (`components/alerts/alert-flyout.tsx`'s row activation), per AGENTS.md's extract-on-second-
 * occurrence rule. Builds `/system/<id>[/<segment>]?focus=<x>,<y>&loc=<n>` from the atlas's own
 * coordinates plus a monotonic `loc` cache-buster: `loc` only has to differ from its OWN previous
 * value so the map's focus effect (keyed on `focus|loc`, see `star-map.tsx`) re-fires even when
 * locating the same system twice in a row.
 *
 * `segment` is typed on the full `SystemTabSegment` union (all six system-panel tabs), wider than
 * the `"" | "industry"` either caller alone ever needed — the Tracker only ever passes `""` or
 * `"industry"`, the alert flyout adds `"population"`/`"logistics"`, and typing this on the real tab
 * union rather than a hand-listed subset is what stops a future caller's tab going stale here.
 *
 * Each caller gets its OWN `locRef` counter — a per-caller cache-buster, not shared state, so the
 * Tracker and the alert flyout advancing their own `loc` independently is correct, not a bug: two
 * different hook call sites never need to agree on a shared nonce.
 *
 * A stale or unknown system id (shouldn't happen — every reader filters to live systems) is a
 * silent no-op rather than a broken push to a coordinate-less route.
 */
export function useSystemFocus() {
  const { atlas } = useAtlas();
  const router = useRouter();
  const locRef = useRef(0);

  const coordsById = useMemo(
    () => new Map(atlas.systems.map((s) => [s.id, { x: s.x, y: s.y }] as const)),
    [atlas.systems],
  );

  return function focusSystem(systemId: string, segment: SystemTabSegment) {
    const coords = coordsById.get(systemId);
    if (!coords) return; // stale id (shouldn't happen — the service filters abandoned pins/instances)
    locRef.current += 1;
    const path = segment ? `/system/${systemId}/${segment}` : `/system/${systemId}`;
    router.push(`${path}?focus=${coords.x},${coords.y}&loc=${locRef.current}`);
  };
}
