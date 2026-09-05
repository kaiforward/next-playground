/**
 * The route table over wouter (client-runtime spec §3, build plan Task 6) — five routes: the map
 * root, `/start`, a system panel, a faction panel, and `/styleguide`. `useRoute()` is the router seam
 * every route-aware component reads: a discriminated union, never a raw pathname string, so a
 * consumer switches on `route.name` instead of re-parsing the URL. The parsing itself is the pure
 * `parseRoute` in `lib/utils/route-hrefs.ts`, so router-agnostic components can parse the pathname
 * `useRouteInfo()` already gives them without importing wouter through this file. An unrecognised
 * path (including `/`) is the map root — the fallback BY FALLING THROUGH, not a separate "/" pattern.
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
import { useLocation } from "wouter";
import { parseRoute, type Route } from "@/lib/utils/route-hrefs";

export type { Route } from "@/lib/utils/route-hrefs";

/** The current route, read from wouter's location and parsed by the one shared parser
 *  (`parseRoute`, `lib/utils/route-hrefs.ts`) — this file is the only place wouter is consulted. */
export function useRoute(): Route {
  const [location] = useLocation();
  return parseRoute(location);
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

/** What a route needs from the world before it can render — the gate's one route-shaped input. */
export type RouteWorldNeed =
  /** `/start` — renders its own screen; only the boot window gates it. */
  | "start"
  /** Reads nothing from the world (the styleguide) — "no world exists" must not gate or
   *  redirect it; only the boot window (no frame yet) does. */
  | "world-free"
  /** Everything else — needs a live world to have anything defined to read. */
  | "world";

export function routeWorldNeed(name: Route["name"]): RouteWorldNeed {
  if (name === "start") return "start";
  if (name === "styleguide") return "world-free";
  return "world";
}

export function resolveRouteGate(
  worldVersion: number | null,
  need: RouteWorldNeed,
  isReplacing: boolean,
): RouteGateDecision {
  if (worldVersion === null) return "boot-loading";
  if (need === "start") return "start";
  if (need === "world-free") return "route";
  if (isReplacing || worldVersion === 0) return "boot-loading";
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
  need: RouteWorldNeed,
  isReplacing: boolean,
): boolean {
  return worldVersion === 0 && !isReplacing && need === "world";
}
