/**
 * Experiment system — YAML config parsing, validation, and result serialisation.
 *
 * The calibration harness is a thin wrapper over `generateWorld` +
 * `runWorldTick`: the cycle cadence is the one per-run override channel —
 * otherwise `runWorldTick` reads the same code constants the live game does — so
 * an experiment config names the world to generate, how long to run it, and
 * (optionally) the cadence to run it at.
 */

import { z } from "zod";
import { DEFAULT_SYSTEM_COUNT } from "@/lib/constants/universe-gen";
import { MARKET_ROLES } from "./types";
import type { HarnessConfig, HarnessResults, MarketRole } from "./types";
import { DRAW_BRAKE_CEILINGS } from "@/lib/tick/processors/good-market-state";
import type { TreasurySnapshot, TreasurySummary } from "./treasury-analysis";

// ── Zod schema ───────────────────────────────────────────────────

const CadenceSchema = z.object({
  cycle: z.number().int().min(1),
  construction: z.number().int().min(1),
  logistics: z.number().int().min(1),
});

export const ExperimentConfigSchema = z.object({
  label: z.string().optional(),
  seed: z.number().int().default(42),
  ticks: z.number().int().min(1).default(500),
  systemCount: z.number().int().min(1).default(DEFAULT_SYSTEM_COUNT),
  cadence: CadenceSchema.optional(),
  /** Third-arm pin: "anchor" pins the DRAW FIGURE's brake ceiling to the retired anchor
   *  geometry while the tick's own brake stays live. Omit for the game's real behaviour. */
  drawBrakeCeiling: z.enum(DRAW_BRAKE_CEILINGS).optional(),
});

export type ExperimentConfig = z.infer<typeof ExperimentConfigSchema>;

// ── Conversion ───────────────────────────────────────────────────

/** Convert a validated experiment config to HarnessConfig. */
export function experimentToHarnessConfig(exp: ExperimentConfig): {
  config: HarnessConfig;
  label?: string;
} {
  return {
    config: {
      systemCount: exp.systemCount,
      seed: exp.seed,
      tickCount: exp.ticks,
      cadence: exp.cadence,
      drawBrakeCeiling: exp.drawBrakeCeiling,
    },
    label: exp.label,
  };
}

// ── Result serialisation ─────────────────────────────────────────

export interface ExperimentResult {
  label?: string;
  timestamp: string;
  config: HarnessConfig;
  /** The scale the run resolved at — a saved result is unreadable without knowing it. */
  economyScale: number;
  marketHealth: HarnessResults["marketHealth"];
  /** Per-good cover and price split by market role — the cohort decomposition of `marketHealth`,
   *  without which a saved run's galaxy-wide medians cannot be compared against another's. */
  roleCoverLevels: HarnessResults["roleCoverLevels"];
  /** Per good, which knee term set each producing market's geometry — BRAKE_OUTPUT_COVER's tuning evidence. */
  kneeBinding: HarnessResults["kneeBinding"];
  /** The role partition this run classified — what a later arm pins to, so two arms' cover reads
   *  are taken over the same cohort membership rather than over whatever each classified. */
  marketRoles: HarnessResults["marketRoles"];
  /** The hunting detector's two readings — a stage-gate primary read. `haulChurnRatio` is the
   *  A/B-comparable half; `flipRate` is an absolute read on arms that persist the use figure. */
  demandHunting: HarnessResults["demandHunting"];
  /** Founding-cost readings — manifest tonnage and founder cover — a stage-gate primary read. */
  foundingStock: HarnessResults["foundingStock"];
  /** How long foundings took, how many ran at once and what gated them — the reading that separates
   *  a founding the money gate refused from one the construction pool never reached. */
  foundingLifecycle: HarnessResults["foundingLifecycle"];
  /** The systems that staged a draw, read against every other developed one — the founder's cost side. */
  founderCohort: HarnessResults["founderCohort"];
  /** Per-cohort supply and unrest — the same separation on the population axis. */
  worldCohorts: HarnessResults["worldCohorts"];
  eventImpacts: HarnessResults["eventImpacts"];
  treasurySummary: TreasurySummary;
  /** The founding-era money bars over settled faction-cycles — the share of era income founding
   *  cost, and the shortfall split that says whether a charter caused one. */
  foundingEra: HarnessResults["foundingEra"];
  treasurySnapshots: TreasurySnapshot[];
  /** Whole-run logistics activity incl. the budget/flow instruments (`budgetSpentFrac`,
   *  funding-bound events/set-rate, `flowRowsPerCycle`) — stage-gate primary reads. */
  logisticsActivity: HarnessResults["logisticsActivity"];
  /** Directed-build burst pacing — proves the construction rate cap bounds per-cycle proposal velocity. */
  buildBurstSummary: HarnessResults["buildBurstSummary"];
  /** Whole-run migration throughput — conserved people-moved totals, colonist delivery vs edge diffusion. */
  migrationThroughput: HarnessResults["migrationThroughput"];
  /** The four pass/fail conservation identities. Saved rather than left in the console the run threw
   *  away: an arm's identities are part of what makes its calibration reads admissible at all. */
  conservation: HarnessResults["conservation"];
  elapsedMs: number;
}

/**
 * Wrap HarnessResults into a self-documenting experiment result for saving.
 */
export function buildExperimentResult(results: HarnessResults): ExperimentResult {
  return {
    label: results.label,
    timestamp: new Date().toISOString(),
    config: results.config,
    economyScale: results.economyScale,
    marketHealth: results.marketHealth,
    roleCoverLevels: results.roleCoverLevels,
    kneeBinding: results.kneeBinding,
    marketRoles: results.marketRoles,
    demandHunting: results.demandHunting,
    foundingStock: results.foundingStock,
    foundingLifecycle: results.foundingLifecycle,
    founderCohort: results.founderCohort,
    worldCohorts: results.worldCohorts,
    eventImpacts: results.eventImpacts,
    treasurySummary: results.treasurySummary,
    foundingEra: results.foundingEra,
    treasurySnapshots: results.treasurySnapshots,
    logisticsActivity: results.logisticsActivity,
    buildBurstSummary: results.buildBurstSummary,
    migrationThroughput: results.migrationThroughput,
    conservation: results.conservation,
    elapsedMs: results.elapsedMs,
  };
}

// ── Pinned role partitions ───────────────────────────────────────

/**
 * A baseline arm's role partitions, read out of a saved results document. `single` is the
 * partition of a one-result document (`--config`'s saved `ExperimentResult`, or its bare
 * `HarnessResults` JSON); `byHorizon` holds one per horizon when the document is the quick run's
 * `{ startup, equilibrium }` report. Both shapes exist because both are things `npm run simulate`
 * writes, and pinning an equilibrium arm to a startup partition would cohort two arms against a
 * membership neither of them has.
 */
export interface PinnedRolesDocument {
  byHorizon: Record<string, Record<string, MarketRole>>;
  single: Record<string, MarketRole> | null;
}

export type ParsePinnedRolesResult =
  | { ok: true; document: PinnedRolesDocument }
  | { ok: false; error: string };

function isMarketRole(value: string): value is MarketRole {
  // Widened deliberately: `.includes` on the union array would not narrow a plain string.
  return MARKET_ROLES.some((role) => role === value);
}

/**
 * Narrow one `marketRoles` object off a parsed document. Returns null when the field is absent
 * (the caller decides whether that is an error at this position) and an error string when it is
 * present but malformed — a stale or typo'd role must not silently create a fifth cohort that
 * counts nothing.
 */
function readPartition(
  container: object,
  where: string,
): { partition: Record<string, MarketRole> | null } | { error: string } {
  if (!("marketRoles" in container)) return { partition: null };
  const raw = container.marketRoles;
  if (typeof raw !== "object" || raw === null) {
    return { error: `${where}.marketRoles is not an object` };
  }
  const partition: Record<string, MarketRole> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value !== "string" || !isMarketRole(value)) {
      return { error: `${where}.marketRoles["${key}"] is not a market role: ${String(value)}` };
    }
    partition[key] = value;
  }
  return { partition };
}

/**
 * Read a baseline arm's role partition(s) out of a saved harness-results JSON document. A true
 * JSON boundary: the parse result is narrowed here with `typeof`/`in` spot-checks rather than
 * threaded onward, and nothing beyond `marketRoles` is inspected — the rest of the document
 * belongs to whatever wrote it.
 */
export function parsePinnedRoles(json: string): ParsePinnedRolesResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, error: "Pin file is not valid JSON" };
  }
  if (typeof parsed !== "object" || parsed === null) {
    return { ok: false, error: "Pin file is not a JSON object" };
  }

  const top = readPartition(parsed, "result");
  if ("error" in top) return { ok: false, error: top.error };

  const byHorizon: Record<string, Record<string, MarketRole>> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value !== "object" || value === null) continue;
    const nested = readPartition(value, key);
    if ("error" in nested) return { ok: false, error: nested.error };
    if (nested.partition !== null) byHorizon[key] = nested.partition;
  }

  if (top.partition === null && Object.keys(byHorizon).length === 0) {
    return {
      ok: false,
      error:
        "Pin file carries no `marketRoles`. Expected a saved experiment result, a bare " +
        "HarnessResults (`--config --json`), or a quick-run report keyed by horizon (`--json`).",
    };
  }

  return { ok: true, document: { byHorizon, single: top.partition } };
}

/**
 * The partition to pin a run to. A horizon-keyed document is matched by label so each arm is
 * cohorted against its own horizon; a one-result document applies to whatever is being run.
 * Undefined means this document says nothing about this horizon — the run classifies live.
 */
export function pinnedRolesFor(
  document: PinnedRolesDocument,
  horizon?: string,
): Record<string, MarketRole> | undefined {
  if (horizon !== undefined && document.byHorizon[horizon] !== undefined) {
    return document.byHorizon[horizon];
  }
  return document.single ?? undefined;
}
