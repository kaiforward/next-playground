/**
 * The route table over wouter (client-runtime spec §3, build plan Task 6) — five routes: the map
 * root, `/start`, a system panel, a faction panel, and `/styleguide`. `useRoute()` is the one seam
 * every route-aware component reads: a discriminated union, never a raw pathname string, so a
 * consumer switches on `route.name` instead of re-parsing the URL. An unrecognised path (including
 * `/`, which no pattern below matches explicitly) falls through every `useWouterRoute` check and
 * lands on `{ name: "map" }` — the map root is the fallback BY FALLING THROUGH, not by a separate
 * "/" pattern, so there is exactly one code path for "nothing more specific matched".
 *
 * **The tab segment is optional, matching today's live URL shapes exactly**: the Overview tab has
 * no path segment at all — `/system/<id>` and `/factions/<id>` bare, not `/system/<id>/overview`
 * (`app/(game)/@panel/system/[systemId]/page.tsx` routes the bare base path;
 * `lib/constants/system-tabs.ts:5`/`faction-tabs.ts:8` both give Overview `segment: ""`). The
 * `:tab?` pattern (regexparam optional-param syntax, which wouter's matcher is built on) matches
 * both forms; a missing `tab` capture comes back `undefined` at the regex level, normalised to `""`
 * here so `Route["tab"]` is always a plain `string` — the same "empty string = Overview" convention
 * `SystemTabSegment`/`FactionTabSegment` already use, which is what Task 9's tab-strip consumers
 * (`resolvePanelTabs`, `components/ui/tabs-helpers.ts`) are written against.
 */
import { useRoute as useWouterRoute } from "wouter";

export type Route =
  | { name: "map" }
  | { name: "start" }
  | { name: "system"; systemId: string; tab: string }
  | { name: "faction"; factionId: string; tab: string }
  | { name: "styleguide" };

const PATTERNS = {
  system: "/system/:id/:tab?",
  faction: "/factions/:id/:tab?",
  start: "/start",
  styleguide: "/styleguide",
} as const;

export function useRoute(): Route {
  const [matchSystem, systemParams] = useWouterRoute(PATTERNS.system);
  const [matchFaction, factionParams] = useWouterRoute(PATTERNS.faction);
  const [matchStart] = useWouterRoute(PATTERNS.start);
  const [matchStyleguide] = useWouterRoute(PATTERNS.styleguide);

  if (matchSystem && systemParams) {
    return { name: "system", systemId: systemParams.id, tab: systemParams.tab ?? "" };
  }
  if (matchFaction && factionParams) {
    return { name: "faction", factionId: factionParams.id, tab: factionParams.tab ?? "" };
  }
  if (matchStart) return { name: "start" };
  if (matchStyleguide) return { name: "styleguide" };
  return { name: "map" };
}

// ── href builders ────────────────────────────────────────────────────────
//
// The inverse of `useRoute` — every place that needs to construct a URL (a `Button`/`TabLink`
// `href`, or a test asserting where a click landed) builds it from here rather than hand-formatting
// a template string, so the route table has exactly one producer of each shape as well as one
// consumer. `tab: ""` builds the bare base path, never a trailing-slash `/system/<id>/` — matching
// the same "empty string = Overview, no segment" convention `useRoute` reads back.

export const mapHref = (): string => "/";
export const startHref = (): string => "/start";
export const styleguideHref = (): string => "/styleguide";
export const systemHref = (systemId: string, tab: string): string =>
  tab === "" ? `/system/${systemId}` : `/system/${systemId}/${tab}`;
export const factionHref = (factionId: string, tab: string): string =>
  tab === "" ? `/factions/${factionId}` : `/factions/${factionId}/${tab}`;
