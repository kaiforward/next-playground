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
// that imports one, including `components/start/*`.

// ── World-existence gate (client-runtime spec §3, §9, build plan Task 11) ───
//
// Pulled out of `client/main.tsx`'s `RouteBody` as pure functions so the ordering they encode —
// bugs this task found and fixed, both from real browser smoke — has a fast unit test that needs no
// real `Worker`:
//
// 1. `worldVersion === null` (no state frame has EVER landed, i.e. still booting) must be checked
//    only AFTER "is this the start route", because `GameStore.beginWorldReplacement()` uses `0`, not
//    `null`, precisely so a newGame/loadGame dispatched FROM the start screen never re-triggers the
//    boot-loading branch and tears the (already-mounted, already showing its own pending state)
//    start screen down into a generic "Booting…" screen.
// 2. `worldVersion === 0` does NOT always mean "no world exists". `GameStore.beginWorldReplacement()`
//    resets `worldVersion` to `0` for the whole swap window, but the mutation hook navigates to the
//    map route as soon as the command RESULT resolves — a separate, EARLIER postMessage than the new
//    world's own state frame (`client/worker/game-worker.ts`'s `handleCommand`: the `commandResult`
//    posts before `pushStateFrame`, and even that gap is dwarfed by however long the new world takes
//    to generate/load before its frame is even built). Gating purely on `worldVersion === 0` would
//    redirect straight back to `/start` for that whole window — a real Gate C smoke finding (New
//    Game "kicks the user straight back to the start screen"). The store already latches
//    `replacementFloor !== null` for exactly this window (`lib/store/game-store.ts`,
//    `selectIsReplacing`); both functions below take it as `isReplacing` so a replacement in flight
//    reads as boot-loading — never a redirect — while a genuine no-world boot (fresh load,
//    `replacementFloor === null`) still redirects to `/start` exactly as before.

export type RouteGateDecision =
  /** No state frame has landed yet, OR a world replacement is in flight — neither has anything
   *  defined to read yet; render the boot-loading state regardless of route. */
  | "boot-loading"
  /** Render the start screen — either the route IS `/start`, or the store reports no world (and no
   *  replacement is in flight) and the redirect effect (`client/main.tsx`) hasn't landed on
   *  `/start` yet. */
  | "start"
  /** Render the matched route's normal content (map root, a panel, the styleguide). */
  | "route";

export function resolveRouteGate(
  worldVersion: number | null,
  routeIsStart: boolean,
  isReplacing: boolean,
  routeIsWorldFree: boolean = false,
): RouteGateDecision {
  if (routeIsStart) return worldVersion === null ? "boot-loading" : "start";
  // A world-free route (the styleguide) reads nothing from the world, so "no world exists"
  // (worldVersion 0) must not gate it — only the boot window itself (null: no frame yet) does.
  if (routeIsWorldFree) return worldVersion === null ? "boot-loading" : "route";
  if (isReplacing) return "boot-loading";
  if (worldVersion === null || worldVersion === 0) return "boot-loading";
  return "route";
}

/**
 * Whether `RouteBody`'s no-world redirect effect should navigate to `/start` — split out from
 * `resolveRouteGate` because the two questions are genuinely different: `resolveRouteGate` answers
 * "what does THIS render" (boot-loading either way while replacing), this answers "should the URL
 * itself change" (never, while replacing — the map route the mutation just navigated to must stick,
 * even though its content is boot-loading until the new frame lands).
 */
export function shouldRedirectToStart(
  worldVersion: number | null,
  routeIsStart: boolean,
  isReplacing: boolean,
  routeIsWorldFree: boolean = false,
): boolean {
  return worldVersion === 0 && !isReplacing && !routeIsStart && !routeIsWorldFree;
}
