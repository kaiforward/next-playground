/**
 * The tick's working row types — mutable per-tick copies the processors' shared
 * in-memory adapters (`lib/tick/adapters/memory/*`) read and write.
 *
 * These are **not** persisted. `runWorldTick` (`lib/world/tick.ts`) builds them
 * from `World` via the `toTick*` joins — inlining catalog/derived data `World`
 * omits — then merges the mutated rows back into the next `World`. They live
 * apart from `World` (`lib/world/types.ts`), which is the persisted,
 * JSON-serializable contract, because a row here saves nothing by itself.
 */

import type { EventTypeId } from "@/lib/constants/events";
import type { EconomyType, GovernmentType, ResourceVector } from "@/lib/types/game";
import type { SystemControl } from "@/lib/world/types";

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
  buildingIdleMonths: Record<string, number>;
  /** Per-resource yield multiplier (deposit quality) — feeds tier-0 production. */
  yields: ResourceVector;
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

export interface TickMarket {
  systemId: string;
  goodId: string;
  basePrice: number;
  stock: number;
  /** Stored pricing-anchor multiplier (1 = none); written by the economy processor. */
  anchorMult: number;
  /** Stored local demand rate (civilian demand — per-capita baseline + skilled baskets — floored at seed). */
  demandRate: number;
  priceFloor: number;
  priceCeiling: number;
  /** Built infrastructure storage capacity for this good — the infrastructure term of maxStock. */
  storageCapacity: number;
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
