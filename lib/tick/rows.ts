/**
 * The tick's working row types — mutable per-tick copies the processors' shared
 * in-memory adapters (`lib/tick/adapters/memory/*`) read and write.
 *
 * These are **not** persisted. `runWorldTick` (`lib/world/tick.ts`) builds them
 * from `World` via the `toTick*` joins — inlining catalog/derived data `World`
 * omits — then merges the mutated rows back into the next `World`. They live
 * apart from `World` (`lib/world/types.ts`), which is the persisted,
 * JSON-serialisable contract, because a row here saves nothing by itself.
 *
 * A row type earns its place here only by differing from its `World` row. There
 * is no tick market row: markets carry no per-tick join, so the adapters read
 * and write `WorldMarket` directly and a good's catalog constants
 * (basePrice/priceFloor/priceCeiling) are read from `GOODS[goodId]` at the point
 * of use.
 */

import type { EventTypeId } from "@/lib/constants/events";
import type { EconomyType, GovernmentType, ResourceVector } from "@/lib/types/game";
import type { SystemControl } from "@/lib/world/types";
import type { SupplyRegime } from "@/lib/engine/population";
import type { BuildDropReason } from "@/lib/engine/directed-build";

export interface TickSystem {
  id: string;
  name: string;
  economyType: EconomyType;
  regionId: string;
  /** Owning faction's stable id, or null for independent systems. Drives the faction-bounded flow topology. */
  factionId: string | null;
  /** Three-state ownership — gates development builds and the claim/develop expansion steps. */
  control: SystemControl;
  /** Owning faction's government — sourced per-system. */
  governmentType: GovernmentType;
  /** Abstract population magnitude — drives labour + per-capita consumption. */
  population: number;
  /** Maximum sustainable population (logistic growth cap). */
  popCap: number;
  /** Unrest accumulator (0…1) — integral of demand-weighted dissatisfaction. */
  unrest: number;
  /** Seeded industrial base — buildingType → whole-integer level count. */
  buildings: Record<string, number>;
  /** Per-buildingType sustained-idle countdown (parallel to `buildings`); the decay buffer's state. */
  buildingIdleCycles: Record<string, number>;
  /** The system's fractional unrest-collapse accumulator; the catastrophic decay channel's state. */
  collapseDebt: number;
  /** Stored Provision memory (adaptive expectation), optional — the `toTickSystems` join passes
   *  `WorldSystem.provisionExpectation` through UNCOERCED (contrast `collapseDebt` above, which
   *  defaults absence to 0): absence here is the lazy-seed marker `readExpectation` relies on, and
   *  coercing it to 0 would make every never-seeded system read as "remembers the floor" instead of
   *  "never measured". */
  provisionExpectation?: number;
  /** This cycle's Provisioned, optional — the `toTickSystems` join passes `WorldSystem.provision`
   *  through UNCOERCED, same absence convention as `provisionExpectation` above (see
   *  `lib/world/types.ts` for the full rationale). A fresh per-cycle reading, not a memory. */
  provision?: number;
  /** This cycle's supply band, optional — passed through uncoerced alongside `provision`
   *  (`lib/world/types.ts`). */
  supplyBand?: SupplyRegime;
  /** This cycle's critical-good override weight, optional — passed through uncoerced alongside
   *  `provision`/`supplyBand`, un-clamped (see `lib/world/types.ts` for why). */
  criticalWeight?: number;
  /** The realised per-cycle population change, optional — the `toTickSystems` join passes
   *  `WorldSystem.populationChange` through UNCOERCED, same absence convention as `provision`/
   *  `supplyBand`/`criticalWeight` above. No processor writes this field via the row-mutation path:
   *  the tick body (`lib/world/tick.ts`) computes and writes it directly, after the migration stage,
   *  from this row's own `population` before and after — the field lives on the row purely so it
   *  round-trips through the join/merge and survives untouched for a system this economy cycle did
   *  not visit. */
  populationChange?: number;
  /** This run's best-ranked dropped production opportunity, optional — the `toTickSystems` join
   *  passes `WorldSystem.buildBlocked` through UNCOERCED, same absence convention as `provision`/
   *  `supplyBand`/`criticalWeight`/`populationChange` above. No processor writes this field via the
   *  row-mutation path: the directed-build processor's world adapter writes it directly through its
   *  own `applyBuildBlockedUpdates` (`lib/tick/world/directed-build-world.ts`), applied in
   *  `lib/world/tick.ts` alongside its other writes — the field lives on the row purely so it
   *  round-trips through the join/merge and survives untouched for a system this run did not visit. */
  buildBlocked?: { reason: BuildDropReason; droppedRoi: number };
  /** This run's best-ranked SCORED production opportunity, optional — same pass-through-uncoerced
   *  treatment as `buildBlocked` above, written directly by the directed-build processor's own
   *  `applyBuildOpportunityUpdates` (`lib/tick/world/directed-build-world.ts`). */
  buildOpportunity?: { score: number; goodId: string };
  /** This run's best-ranked colony-establish terms, optional — same pass-through-uncoerced treatment
   *  as `buildBlocked` above, written directly by the directed-build processor's own
   *  `applyColonyOpportunityUpdates` (`lib/tick/world/directed-build-world.ts`). */
  colonyOpportunity?: { value: number; work: number };
  /** Per-resource yield multiplier (deposit quality) — feeds tier-0 production. */
  yields: ResourceVector;
  /** Per-resource extraction-work efficiency — deposit-count-weighted mean of the contributing
   *  bodies' extractionModifier; feeds tier-0 production alongside `yields` (never folded into it). */
  extractionEff: ResourceVector;
  /** Body-derived deposit-slot capacity per resource — caps tier-0 extractor builds. */
  slotCap: ResourceVector;
  /** Body-derived fungible build space — tier-1+ factories + housing draw here. */
  generalSpace: number;
  /** Habitable subset of build space — additionally caps housing. */
  habitableSpace: number;
}

export interface TickConnection {
  fromSystemId: string;
  toSystemId: string;
  fuelCost: number;
}

/**
 * Deliberately omits `WorldEvent.metadata`, which only relations-spawned events
 * carry and only the relations processor reads. The events stage would drop it,
 * so `runWorldTick` preserves it out-of-band in a by-id side map and re-attaches
 * it when mapping this row back to `WorldEvent`.
 */
export interface TickEvent {
  id: string;
  type: EventTypeId;
  phase: string;
  /** Target system, or null for region/pair-level events (e.g. relations-owned events). */
  systemId: string | null;
  /** Target region, or null. */
  regionId: string | null;
  startTick: number;
  phaseStartTick: number;
  phaseDuration: number;
  severity: number;
  sourceEventId: string | null;
}
