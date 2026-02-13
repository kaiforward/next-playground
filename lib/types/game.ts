// Shared game types — no Prisma dependency, importable everywhere

export type EconomyType =
  | "agricultural"
  | "mining"
  | "industrial"
  | "tech"
  | "core";

export type RegionIdentity =
  | "resource_rich"
  | "agricultural"
  | "industrial"
  | "tech"
  | "trade_hub";

export interface RegionInfo {
  id: string;
  name: string;
  identity: RegionIdentity;
  x: number;
  y: number;
}

export type GoodCategory =
  | "raw"
  | "manufactured"
  | "consumable"
  | "luxury";

export type TradeType = "buy" | "sell";

export type ShipStatus = "docked" | "in_transit";

export interface ShipState {
  id: string;
  name: string;
  fuel: number;
  maxFuel: number;
  cargoMax: number;
  cargo: CargoItemState[];
  status: ShipStatus;
  systemId: string;
  system: StarSystemInfo;
  destinationSystemId: string | null;
  destinationSystem: StarSystemInfo | null;
  departureTick: number | null;
  arrivalTick: number | null;
}

export interface FleetState {
  id: string;
  userId: string;
  credits: number;
  ships: ShipState[];
}

export interface GameWorldState {
  currentTick: number;
  tickRate: number;
  startingSystemId: string | null;
}

export interface CargoItemState {
  goodId: string;
  goodName: string;
  quantity: number;
}

export interface StarSystemInfo {
  id: string;
  name: string;
  economyType: EconomyType;
  x: number;
  y: number;
  description: string;
  regionId: string;
  isGateway: boolean;
}

export interface SystemConnectionInfo {
  id: string;
  fromSystemId: string;
  toSystemId: string;
  fuelCost: number;
}

export interface StationInfo {
  id: string;
  name: string;
  systemId: string;
}

export interface GoodInfo {
  id: string;
  name: string;
  basePrice: number;
  category: GoodCategory;
}

export interface MarketEntry {
  goodId: string;
  goodName: string;
  basePrice: number;
  currentPrice: number;
  supply: number;
  demand: number;
}

export interface TradeHistoryEntry {
  id: string;
  stationId: string;
  goodId: string;
  goodName: string;
  price: number;
  quantity: number;
  type: TradeType;
  createdAt: string;
}

export interface UniverseData {
  regions: RegionInfo[];
  systems: StarSystemInfo[];
  connections: SystemConnectionInfo[];
}

export interface ActiveEvent {
  id: string;
  type: string;
  name: string;
  phase: string;
  phaseDisplayName: string;
  systemId: string | null;
  systemName: string | null;
  regionId: string | null;
  startTick: number;
  phaseStartTick: number;
  phaseDuration: number;
  ticksRemaining: number;
  severity: number;
}

// ── Price history types ─────────────────────────────────────────

export interface PriceSnapshotPoint {
  tick: number;
  price: number;
}

export interface SystemPriceHistory {
  goodId: string;
  goodName: string;
  points: PriceSnapshotPoint[];
}

// ── Notification types ──────────────────────────────────────────

export interface EntityRef {
  id: string;
  label: string;
}

export interface GameNotification {
  /** Client-side sequence number, used as React key. */
  id: number;
  message: string;
  type: string;
  refs: Partial<Record<string, EntityRef>>;
  /** Date.now() when received client-side. */
  receivedAt: number;
}
