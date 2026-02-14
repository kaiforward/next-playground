/**
 * Runtime type guards for Prisma boundary values.
 *
 * Prisma stores union-typed fields as plain strings. These guards validate
 * at the DB boundary so downstream code can use the proper union types
 * without unsafe `as` casts.
 */

import type {
  EconomyType,
  GovernmentType,
  RegionIdentity,
  ShipStatus,
  TradeType,
} from "./game";
import type { ShipTypeId } from "@/lib/constants/ships";

// ── Lookup sets (built once) ────────────────────────────────────

const ECONOMY_TYPES: ReadonlySet<string> = new Set<EconomyType>([
  "agricultural", "extraction", "refinery", "industrial", "tech", "core",
]);

const GOVERNMENT_TYPES: ReadonlySet<string> = new Set<GovernmentType>([
  "federation", "corporate", "authoritarian", "frontier",
]);

const REGION_IDENTITIES: ReadonlySet<string> = new Set<RegionIdentity>([
  "resource_rich", "agricultural", "industrial", "tech", "trade_hub",
]);

const SHIP_STATUSES: ReadonlySet<string> = new Set<ShipStatus>([
  "docked", "in_transit",
]);

const TRADE_TYPES: ReadonlySet<string> = new Set<TradeType>([
  "buy", "sell",
]);

const SHIP_TYPE_IDS: ReadonlySet<string> = new Set<ShipTypeId>([
  "shuttle", "freighter",
]);

// ── Validated converters ────────────────────────────────────────

export function toEconomyType(value: string): EconomyType {
  if (!ECONOMY_TYPES.has(value)) {
    throw new Error(`Invalid economy type: "${value}"`);
  }
  return value as EconomyType;
}

export function toGovernmentType(value: string): GovernmentType {
  if (!GOVERNMENT_TYPES.has(value)) {
    throw new Error(`Invalid government type: "${value}"`);
  }
  return value as GovernmentType;
}

export function toRegionIdentity(value: string): RegionIdentity {
  if (!REGION_IDENTITIES.has(value)) {
    throw new Error(`Invalid region identity: "${value}"`);
  }
  return value as RegionIdentity;
}

export function toShipStatus(value: string): ShipStatus {
  if (!SHIP_STATUSES.has(value)) {
    throw new Error(`Invalid ship status: "${value}"`);
  }
  return value as ShipStatus;
}

export function toTradeType(value: string): TradeType {
  if (!TRADE_TYPES.has(value)) {
    throw new Error(`Invalid trade type: "${value}"`);
  }
  return value as TradeType;
}

export function isShipTypeId(value: string): value is ShipTypeId {
  return SHIP_TYPE_IDS.has(value);
}

// ── Constant arrays (avoids Object.keys() + as casts) ───────────

export const ALL_GOVERNMENT_TYPES: readonly GovernmentType[] = [
  "federation", "corporate", "authoritarian", "frontier",
];
