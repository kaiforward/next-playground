/**
 * Route href builders (client-runtime spec §3, build plan Task 6/11) — the inverse of
 * `client/routes.ts`'s `useRoute()`: every place that needs to construct a URL (a `Button`/`TabLink`
 * `href`, or a test asserting where a click landed) builds it from here rather than hand-formatting
 * a template string, so the route table has exactly one producer of each shape as well as one
 * consumer. `tab: ""` builds the bare base path, never a trailing-slash `/system/<id>/` — matching
 * the same "empty string = Overview, no segment" convention `useRoute` reads back.
 *
 * Deliberately its own module, not colocated with `useRoute` in `client/routes.ts`: these are plain
 * string builders with no router dependency, but `client/routes.ts` imports `wouter` at module scope
 * for `useRoute` itself. A component importing ONLY an href builder from `client/routes.ts` would
 * still pull that `wouter` import along with it — the same leak `components/ui/link-provider.tsx`
 * is written to avoid (its own docstring: wouter stays out of `components/ui`). `components/start/
 * start-screen.tsx` and `create-faction-form.tsx` import these builders, so they live here rather
 * than beside `useRoute`.
 */

/** The route table's discriminated union — what every route-aware consumer switches on instead of a
 *  raw pathname. `tab: ""` is the Overview tab (no path segment), matching the href builders below. */
export type Route =
  | { name: "map" }
  | { name: "start" }
  | { name: "system"; systemId: string; tab: string }
  | { name: "faction"; factionId: string; tab: string }
  | { name: "lane"; laneKey: string }
  | { name: "styleguide" };

const SYSTEM_ROUTE = /^\/system\/([^/]+)(?:\/([^/]+))?\/?$/;
const FACTION_ROUTE = /^\/factions\/([^/]+)(?:\/([^/]+))?\/?$/;
const LANE_ROUTE = /^\/lane\/([^/]+)\/?$/;

/**
 * Parse a pathname into the route table's union — the inverse of the href builders below, and the
 * one parser both the router seam (`client/routes.ts`'s `useRoute`) and router-agnostic components
 * (the map reads `useRouteInfo().pathname`) share, so no component re-derives an id with its own
 * regex. Pure: no router dependency. Params are percent-decoded here exactly once (a lane key's
 * `|` travels as `%7C`, see `laneHref`). An unrecognised path is the map root.
 */
export function parseRoute(pathname: string): Route {
  const system = SYSTEM_ROUTE.exec(pathname);
  if (system) return { name: "system", systemId: decodeURIComponent(system[1]), tab: system[2] ? decodeURIComponent(system[2]) : "" };
  const faction = FACTION_ROUTE.exec(pathname);
  if (faction) return { name: "faction", factionId: decodeURIComponent(faction[1]), tab: faction[2] ? decodeURIComponent(faction[2]) : "" };
  const lane = LANE_ROUTE.exec(pathname);
  if (lane) return { name: "lane", laneKey: decodeURIComponent(lane[1]) };
  if (pathname === "/start" || pathname === "/start/") return { name: "start" };
  if (pathname === "/styleguide" || pathname === "/styleguide/") return { name: "styleguide" };
  return { name: "map" };
}

export const mapHref = (): string => "/";
export const startHref = (): string => "/start";
export const styleguideHref = (): string => "/styleguide";
export const systemHref = (systemId: string, tab: string): string =>
  tab === "" ? `/system/${systemId}` : `/system/${systemId}/${tab}`;
export const factionHref = (factionId: string, tab: string): string =>
  tab === "" ? `/factions/${factionId}` : `/factions/${factionId}/${tab}`;
/** `laneKey` is a sorted `"a|b"` pair (`lib/engine/lanes.ts`) — URL-encoded so the literal `|`
 *  survives the route table's `:key` capture untouched. */
export const laneHref = (laneKey: string): string => `/lane/${encodeURIComponent(laneKey)}`;
