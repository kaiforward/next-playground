/**
 * Stable, module-level fallback values for the store-backed hooks in `lib/hooks/` — used via `??`
 * when a global slice hasn't landed yet (pre-boot: `worldVersion === null`) or, for the map-tile
 * filter, when the universe slice is absent. A fallback allocated fresh on every render would look
 * like a changed value to `useGameSlice`'s `Object.is` selector-equality check (`lib/store/use-game-
 * store.ts`) and force a re-render on every store notification even though nothing this hook reads
 * changed — reusing one module-level reference is what keeps the pre-boot state as inert as any
 * other unchanged slice.
 *
 * Judgment call (client-runtime build plan Task 7): today's hooks suspend until the first frame
 * arrives, so a pre-boot read was never observable. With suspense gone, a pre-boot read of a global
 * slice must return SOMETHING synchronously — these are that something: the same empty shape the
 * real slice would carry for a freshly-generated, player-less world, never `undefined`.
 */
import type { AtlasData, UniverseData, ActiveEvent } from "@/lib/types/game";
import type { FactionSummary, RelationsMatrixData } from "@/lib/services/factions";
import type { AlertData, TrackerData, TradeFlowEdges } from "@/lib/types/api";
import { DEFAULT_ALERT_CATEGORIES, DEFAULT_TRACKER_SECTIONS } from "@/lib/constants/attention";

export const EMPTY_EVENTS: ActiveEvent[] = [];
export const EMPTY_FACTIONS: FactionSummary[] = [];
export const EMPTY_RELATIONS: RelationsMatrixData = { factions: [], pairs: [] };
export const EMPTY_UNIVERSE: UniverseData = { regions: [], systems: [], connections: [], factions: [] };
export const EMPTY_ATLAS: AtlasData = {
  meta: { mapSize: 0, systemCount: 0, seed: 0 },
  regions: [],
  systems: [],
  connections: [],
  factions: [],
  player: null,
};
export const EMPTY_VISIBLE_IDS: string[] = [];

/** Task 8 additions — the same "a freshly-generated, player-less world's real empty shape" rule as
 *  the Task 7 defaults above, mirroring `getTrackerData`'s/`getAlertData`'s own no-player-seat
 *  fallbacks (`lib/services/tracker.ts`, `lib/services/alerts.ts`) so a pre-boot read renders
 *  identically to a real seat-less world rather than a bespoke empty shape. */
export const EMPTY_TRACKER: TrackerData = {
  pinnedSystemIds: [],
  pinned: [],
  building: [],
  waitingCount: 0,
  colonising: [],
  sections: DEFAULT_TRACKER_SECTIONS,
};
export const EMPTY_ALERTS: AlertData = {
  categories: [],
  categorySettings: DEFAULT_ALERT_CATEGORIES,
};
export const EMPTY_TRADE_FLOW: TradeFlowEdges = { logisticsEdges: [] };
