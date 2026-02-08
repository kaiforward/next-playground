// Shared game types — no Prisma dependency, importable everywhere

export type EconomyType =
  | "agricultural"
  | "mining"
  | "industrial"
  | "tech"
  | "core";

export type GoodCategory =
  | "raw"
  | "manufactured"
  | "consumable"
  | "luxury";

export type TradeType = "buy" | "sell";

export interface PlayerState {
  id: string;
  userId: string;
  credits: number;
  systemId: string;
  system: StarSystemInfo;
  ship: ShipState;
}

export interface ShipState {
  id: string;
  name: string;
  fuel: number;
  maxFuel: number;
  cargoMax: number;
  cargo: CargoItemState[];
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
  systems: StarSystemInfo[];
  connections: SystemConnectionInfo[];
}
