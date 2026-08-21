"use client";

import { useMemo } from "react";
import { useNavigate } from "@/components/ui/link-provider";
import { useAtlas } from "@/lib/hooks/use-atlas";
import type { SystemTabSegment } from "@/lib/constants/system-tabs";

/**
 * The `loc` cache-buster's counter, module-level rather than one per hook instance. There is exactly
 * ONE consumer of the value — the `focus|loc` key `star-map.tsx` recentres off — but many hook
 * instances writing it: the Tracker's, plus one per visible alert chip. Per-instance counters all
 * start at 0, so two of them locating the same system emit a byte-identical `?focus=x,y&loc=1`, the
 * key never changes, and the second locate opens the panel without ever flying the camera. A counter
 * shared by every call site is what makes "differs from the last value written" true of the URL
 * itself rather than of one caller's private history. Nothing renders off it, so it is deliberately
 * not React state.
 */
let locSeq = 0;

/**
 * Fly-to-system-and-open-tab navigation — extracted from `TrackerPanel`'s own `activate`
 * (`components/tracker/tracker-panel.tsx`) the moment a second consumer needed it
 * (`components/alerts/alert-flyout.tsx`'s row activation), per AGENTS.md's extract-on-second-
 * occurrence rule. Builds `/system/<id>[/<segment>]?focus=<x>,<y>&loc=<n>` from the atlas's own
 * coordinates plus a monotonic `loc` cache-buster: `loc` has to differ from the value the URL last
 * carried so the map's focus effect (keyed on `focus|loc`, see `star-map.tsx`) re-fires even when
 * locating the same system twice in a row.
 *
 * `segment` is typed on the full `SystemTabSegment` union (all six system-panel tabs), wider than
 * the `"" | "industry"` either caller alone ever needed — the Tracker only ever passes `""` or
 * `"industry"`, the alert flyout adds `"population"`/`"logistics"`, and typing this on the real tab
 * union rather than a hand-listed subset is what stops a future caller's tab going stale here.
 *
 * Every caller shares one counter — see `locSeq` above. The nonce lands in a single URL read by a
 * single consumer, so it is that URL's history the value has to differ from, not any one caller's.
 *
 * A stale or unknown system id (shouldn't happen — every reader filters to live systems) is a
 * silent no-op rather than a broken push to a coordinate-less route.
 */
export function useSystemFocus() {
  const { atlas } = useAtlas();
  const navigate = useNavigate();

  const coordsById = useMemo(
    () => new Map(atlas.systems.map((s) => [s.id, { x: s.x, y: s.y }] as const)),
    [atlas.systems],
  );

  return function focusSystem(systemId: string, segment: SystemTabSegment) {
    const coords = coordsById.get(systemId);
    if (!coords) return; // stale id (shouldn't happen — the service filters abandoned pins/instances)
    locSeq += 1;
    const path = segment ? `/system/${systemId}/${segment}` : `/system/${systemId}`;
    navigate(`${path}?focus=${coords.x},${coords.y}&loc=${locSeq}`);
  };
}
