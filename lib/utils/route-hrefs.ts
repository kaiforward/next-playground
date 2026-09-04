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
