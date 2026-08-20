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

// href builders (`mapHref`, `startHref`, `systemHref`, etc.) moved to `lib/utils/route-hrefs.ts` —
// see that module's own docstring for why: they're plain string builders with no router dependency,
// but living in this file would still pull `wouter` (imported above for `useRoute`) into anything
// that imports one, including `components/start/*`, which the still-live Next app also compiles.

// ── World-existence gate (client-runtime spec §3, §9, build plan Task 11) ───
//
// Pulled out of `client/main.tsx`'s `RouteBody` as a pure function so the ordering it encodes —
// the exact bug this task found and fixed — has a fast unit test that needs no real `Worker`:
// `worldVersion === null` (no state frame has EVER landed, i.e. still booting) must be checked only
// AFTER "is this the start route", because `GameStore.beginWorldReplacement()` uses `0`, not
// `null`, precisely so a newGame/loadGame dispatched FROM the start screen never re-triggers the
// boot-loading branch and tears the (already-mounted, already showing its own pending state) start
// screen down into a generic "Booting…" screen.

export type RouteGateDecision =
  /** No state frame has landed yet — nothing this task built (start screen, map, panels) has
   *  anything defined to read; render the boot-loading state regardless of route. */
  | "boot-loading"
  /** Render the start screen — either the route IS `/start`, or the store reports no world and the
   *  redirect effect (`client/main.tsx`) hasn't landed on `/start` yet. */
  | "start"
  /** Render the matched route's normal content (map root, a panel, the styleguide). */
  | "route";

export function resolveRouteGate(worldVersion: number | null, routeIsStart: boolean): RouteGateDecision {
  if (routeIsStart) return worldVersion === null ? "boot-loading" : "start";
  if (worldVersion === null || worldVersion === 0) return "boot-loading";
  return "route";
}
