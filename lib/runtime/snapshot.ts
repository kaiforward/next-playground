/**
 * The snapshot store's payload — the UI-facing slices of world state (spec §2), assembled worker-side
 * from the same read services the old per-route API handlers used to wrap. Slices are keyed like
 * those routes' old query keys and carry exactly the services' existing return types — no parallel DTOs.
 *
 * Node-portable: no `fs`, no static `process.env` read. NOT pure: `buildStateFrame` reads through
 * the `getWorld()` singleton (the read services it reuses all read the singleton internally), so it
 * REQUIRES its `world` argument to already be the singleton's held value — `ensureWorldCommitted`
 * below throws rather than silently adopting a mismatched world. This used to adopt (call
 * `setWorld(world)` on a mismatch) until the game worker (client-runtime build plan, Task 5) became
 * the mechanism's first real caller and settled the call pattern: every caller fetches `getWorld()`
 * immediately before passing it here, so a mismatch can only mean a caller is holding a stale or
 * foreign reference — exactly the bug a silent adopt would hide (a stale closure's world quietly
 * becoming live state, with only an unexplained version-counter jump as a trace). Callers MUST call
 * `setWorld(world)` themselves first if `world` is not already the singleton's value.
 *
 * **Full frame only, for now.** `buildStateFrame`'s `since` parameter is accepted for interface
 * stability (later tasks' callers pass the last-acked world version) but is not yet consulted — every
 * call returns every slice. Worker-side dirty-sets that would let `since` narrow the frame are an
 * optimisation explicitly gated on the roadmap's *Markets need a real dirty/ownership model* row
 * (spec §2), not this task's mechanism: the tick adapters hand back fresh rows whether or not anything
 * changed, so there is no cheaper "what changed" signal to consult yet. Every returned frame is
 * therefore already self-contained latest state, which is what makes the drop-harmless guarantee hold
 * trivially rather than needing a merge rule.
 */
import { getWorld, getWorldVersion, hasWorld } from "@/lib/world/store";
import type { World } from "@/lib/world/types";
import { DEFAULT_ALERT_CATEGORIES, DEFAULT_TRACKER_SECTIONS } from "@/lib/constants/attention";
import type { AlertCategorySettings } from "@/lib/types/alerts";
import type { TrackerSections } from "@/lib/types/tracker";
import type { ColonyStallReason } from "@/lib/types/colonisation";

import { getUniverse } from "@/lib/services/universe";
import { getAtlas } from "@/lib/services/atlas";
import { getActiveEvents } from "@/lib/services/events";
import { getAlertData } from "@/lib/services/alerts";
import { getTrackerData } from "@/lib/services/tracker";
import { getOwnershipBySystem } from "@/lib/services/ownership-map";
import { getStabilityBySystem } from "@/lib/services/stability";
import { getPopulationBySystem } from "@/lib/services/population-map";
import { getDevelopmentBySystem } from "@/lib/services/development-map";
import { getMigrationBySystem } from "@/lib/services/migration-map";
import { getProvisionBySystem } from "@/lib/services/provision-map";
import {
  listFactions, getRelationsMatrix, getFactionDetail,
  type FactionSummary, type RelationsMatrixData, type FactionDetail,
} from "@/lib/services/factions";
import { getSystemVitals } from "@/lib/services/system-vitals";
import { getSystemPopulation } from "@/lib/services/system-population";
import { getSystemIndustry, getSystemSubstrate } from "@/lib/services/universe";
import { getSystemLogistics, getTradeFlowEdges } from "@/lib/services/trade-flow";
import { getSystemConstruction, getFactionConstruction, readoutForFaction } from "@/lib/services/construction";
import { getSystemBuildOptions } from "@/lib/services/build-options";
import { colonyEligibility } from "@/lib/services/colony-eligibility";
import { getFactionVitals } from "@/lib/services/faction-vitals";
import { getFactionTreasury } from "@/lib/services/treasury";
import { getMarket } from "@/lib/services/market";
import { getMarketComparison } from "@/lib/services/market-comparison";
import { GOODS } from "@/lib/constants/goods";

import type {
  AtlasData, UniverseData, ActiveEvent, StabilityEntry, PopulationEntry, DevelopmentEntry,
  MigrationEntry, ProvisionEntry, OwnershipEntry,
} from "@/lib/types/game";
import type {
  AlertData, TrackerData, SystemVitalsData, SystemPopulationData, SystemIndustryData,
  SystemLogisticsData, SystemConstructionData, SystemBuildOptionsData, FactionVitalsData,
  FactionConstructionData, FactionTreasuryData, SystemSubstrateData, TradeFlowEdges,
} from "@/lib/types/api";

/** The two worker-priced pricing results — reused verbatim rather than re-declared, per the
 *  "reuse the existing service/API types" rule; neither service exports a name for its own return
 *  union, so this pins it once from the function signature. */
export type ColonyEligibilityResult = ReturnType<typeof colonyEligibility>;

/** `getMarket`'s return shape, reused verbatim — same rule as `ColonyEligibilityResult` above. */
export type MarketSlice = ReturnType<typeof getMarket>;

/** `getMarketComparison`'s return shape, reused verbatim — same rule as `ColonyEligibilityResult`
 *  above. Keyed by good id (the goods catalog, `lib/constants/goods.ts`) rather than by system:
 *  `use-market-comparison.ts` opens on one good across every system, not one system. */
export type MarketComparisonSlice = ReturnType<typeof getMarketComparison>;

/** The player's two attention-layer settings records, read back together — see `getAlertData`'s
 *  `categorySettings` and `getTrackerData`'s `sections`, which already carry these; this slice exists
 *  so a settings surface can read them without opening the whole alerts/tracker payload for it. A
 *  world with no player seat reads the same defaults `getAlertData`/`getTrackerData` fall back to. */
export interface PlayerSettingsSlice {
  alertCategories: AlertCategorySettings;
  trackerSections: TrackerSections;
}

/**
 * The UI-facing slices of world state — one property per today's query key (or key family). Every
 * per-id slice is a `Record` keyed by system or faction id, carrying an entry for every id that
 * exists in the world (not just ids some panel currently has open), so a frame is complete regardless
 * of which panels are mounted when it lands. `marketComparison` is the one per-id slice keyed by
 * *good* id (the goods catalog) rather than system/faction id — see `MarketComparisonSlice`.
 *
 * `colonyEligibility` and `constructionStalls` are the two WORKER-PRICED slices (spec §2): both read
 * `ECONOMY_SCALE` internally (`lib/services/colony-eligibility.ts`, `lib/services/construction.ts`),
 * so they are computed here and ride the snapshot already resolved — `ECONOMY_SCALE` itself never
 * crosses the channel. `colonyEligibility` covers every CONTROLLED system (the only ones the verb
 * applies to); `constructionStalls` covers every open colony-establish project's stall reason, keyed
 * by project id, across every faction (the faction screen is a god-view — not player-gated).
 *
 * Two query keys that Task 7 rewires read no slice here at all, deliberately:
 *   - `systemCadence` is `{ resolutionGroup: 0 }` for every existing system unconditionally — the
 *     whole galaxy resolves on one shared cycle boundary (`lib/services/system-cadence.ts`). The
 *     store-backed hook returns the literal, no read required.
 *   - `staticTile` (system name + economy type within a map tile) is a pure client-side filter of
 *     the `universe` slice: `getUniverse().systems` already carries `id`/`name`/`economyType`/`x`/`y`
 *     for every system (`lib/services/universe.ts` `getUniverse`), the same three display fields
 *     `getStaticTile` selects after filtering by `tileBounds` (`lib/services/static-tiles.ts`). The
 *     store-backed hook filters `universe.systems` by tile bounds instead of opening a new slice.
 */
export interface SnapshotSlices {
  atlas: AtlasData;
  universe: UniverseData;
  visibility: { systemIds: string[] };
  events: ActiveEvent[];
  alerts: AlertData;
  tracker: TrackerData;
  playerSettings: PlayerSettingsSlice;
  ownership: OwnershipEntry[];
  stability: StabilityEntry[];
  population: PopulationEntry[];
  development: DevelopmentEntry[];
  migration: MigrationEntry[];
  provision: ProvisionEntry[];
  factions: FactionSummary[];
  factionDetail: Record<string, FactionDetail>;
  relations: RelationsMatrixData;
  systemVitals: Record<string, SystemVitalsData>;
  systemPopulation: Record<string, SystemPopulationData>;
  systemIndustry: Record<string, SystemIndustryData>;
  systemLogistics: Record<string, SystemLogisticsData>;
  systemConstruction: Record<string, SystemConstructionData>;
  systemBuildOptions: Record<string, SystemBuildOptionsData>;
  systemSubstrate: Record<string, SystemSubstrateData>;
  market: Record<string, MarketSlice>;
  marketComparison: Record<string, MarketComparisonSlice>;
  tradeFlow: TradeFlowEdges;
  factionVitals: Record<string, FactionVitalsData>;
  factionConstruction: Record<string, FactionConstructionData>;
  factionTreasury: Record<string, FactionTreasuryData>;
  colonyEligibility: Record<string, ColonyEligibilityResult>;
  constructionStalls: Record<string, ColonyStallReason | null>;
}

/** One state frame — the committed world version it was built from, and the slices it carries. Every
 *  slice named in `SnapshotSlices` is present on a full frame (`since: null`); see the module
 *  docstring for why a non-null `since` carries the same full set today. */
export interface StateFrame {
  worldVersion: number;
  slices: Partial<SnapshotSlices>;
}

/**
 * Every read service below reads the store singleton (`getWorld()`), not the `world` parameter
 * directly — the same singleton the worker's own tick loop commits to via `setWorld`. `world` must
 * therefore already BE the singleton's held value when this runs; a mismatch throws rather than
 * silently committing `world` on the caller's behalf (module docstring above states why, and names
 * the resolution).
 */
function ensureWorldCommitted(world: World): void {
  if (!hasWorld() || getWorld() !== world) {
    throw new Error(
      "buildStateFrame called with a world that is not the store's current value — " +
        "call setWorld(world) first, or pass the exact reference getWorld() just returned.",
    );
  }
}

function buildPlayerSettings(world: World): PlayerSettingsSlice {
  const player = world.player;
  return player
    ? { alertCategories: player.alertCategories, trackerSections: player.trackerSections }
    : { alertCategories: DEFAULT_ALERT_CATEGORIES, trackerSections: DEFAULT_TRACKER_SECTIONS };
}

/** Every controlled system's colony-verb pricing, faction-scoped to whichever faction controls it. */
function buildColonyEligibility(world: World): Record<string, ColonyEligibilityResult> {
  const out: Record<string, ColonyEligibilityResult> = {};
  for (const system of world.systems) {
    if (system.control !== "controlled" || !system.factionId) continue;
    out[system.id] = colonyEligibility(world, system.factionId, system);
  }
  return out;
}

/** Every open colony-establish project's priced stall reason, across every faction's construction
 *  readout — the same rows `readoutForFaction` already computes for `factionConstruction`/
 *  `systemConstruction`, walked again here only to pull out the one already-priced field. */
function buildConstructionStalls(world: World): Record<string, ColonyStallReason | null> {
  const out: Record<string, ColonyStallReason | null> = {};
  for (const faction of world.factions) {
    const readout = readoutForFaction(faction.id);
    for (const row of readout.all) {
      if (row.kind === "colony_establish") out[row.id] = row.stalledReason;
    }
  }
  return out;
}

/**
 * Assembles the full state frame for `world` — every UI-facing slice, keyed per system/faction id
 * where the slice is per-id. `since` is accepted but not yet consulted (see module docstring).
 */
export function buildStateFrame(world: World, since: number | null): StateFrame {
  void since;
  ensureWorldCommitted(world);

  const systemVitals: Record<string, SystemVitalsData> = {};
  const systemPopulation: Record<string, SystemPopulationData> = {};
  const systemIndustry: Record<string, SystemIndustryData> = {};
  const systemLogistics: Record<string, SystemLogisticsData> = {};
  const systemConstruction: Record<string, SystemConstructionData> = {};
  const systemBuildOptions: Record<string, SystemBuildOptionsData> = {};
  for (const system of world.systems) {
    systemVitals[system.id] = getSystemVitals(system.id);
    systemPopulation[system.id] = getSystemPopulation(system.id);
    systemIndustry[system.id] = getSystemIndustry(system.id);
    systemLogistics[system.id] = getSystemLogistics(system.id);
    systemConstruction[system.id] = getSystemConstruction(system.id);
    systemBuildOptions[system.id] = getSystemBuildOptions(system.id);
  }

  const systemSubstrate: Record<string, SystemSubstrateData> = {};
  const market: Record<string, MarketSlice> = {};
  for (const system of world.systems) {
    systemSubstrate[system.id] = getSystemSubstrate(system.id);
    market[system.id] = getMarket(system.id);
  }

  const marketComparison: Record<string, MarketComparisonSlice> = {};
  for (const goodId of Object.keys(GOODS)) {
    marketComparison[goodId] = getMarketComparison(goodId);
  }

  const factionVitals: Record<string, FactionVitalsData> = {};
  const factionConstruction: Record<string, FactionConstructionData> = {};
  const factionTreasury: Record<string, FactionTreasuryData> = {};
  const factionDetail: Record<string, FactionDetail> = {};
  for (const faction of world.factions) {
    factionVitals[faction.id] = getFactionVitals(faction.id);
    factionConstruction[faction.id] = getFactionConstruction(faction.id);
    factionDetail[faction.id] = getFactionDetail(faction.id);
    if (world.treasuries.some((t) => t.factionId === faction.id)) {
      factionTreasury[faction.id] = getFactionTreasury(faction.id);
    }
  }

  const slices: SnapshotSlices = {
    atlas: getAtlas(),
    universe: getUniverse(),
    visibility: { systemIds: world.systems.map((s) => s.id) },
    events: getActiveEvents(),
    alerts: getAlertData(),
    tracker: getTrackerData(),
    playerSettings: buildPlayerSettings(world),
    ownership: getOwnershipBySystem(),
    stability: getStabilityBySystem(),
    population: getPopulationBySystem(),
    development: getDevelopmentBySystem(),
    migration: getMigrationBySystem(),
    provision: getProvisionBySystem(),
    factions: listFactions(),
    factionDetail,
    relations: getRelationsMatrix(),
    systemVitals,
    systemPopulation,
    systemIndustry,
    systemLogistics,
    systemConstruction,
    systemBuildOptions,
    systemSubstrate,
    market,
    marketComparison,
    tradeFlow: getTradeFlowEdges(),
    factionVitals,
    factionConstruction,
    factionTreasury,
    colonyEligibility: buildColonyEligibility(world),
    constructionStalls: buildConstructionStalls(world),
  };

  return { worldVersion: getWorldVersion(), slices };
}
