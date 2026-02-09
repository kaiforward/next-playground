import type { MarketEntry, TradeHistoryEntry, FleetState } from "@/lib/types/game";

export const MOCK_MARKET: MarketEntry[] = [
  { goodId: "food", goodName: "Food", basePrice: 20, currentPrice: 18, supply: 120, demand: 30 },
  { goodId: "ore", goodName: "Ore", basePrice: 30, currentPrice: 35, supply: 45, demand: 80 },
  { goodId: "fuel", goodName: "Fuel", basePrice: 40, currentPrice: 42, supply: 50, demand: 55 },
  { goodId: "electronics", goodName: "Electronics", basePrice: 80, currentPrice: 95, supply: 30, demand: 70 },
  { goodId: "ship_parts", goodName: "Ship Parts", basePrice: 100, currentPrice: 88, supply: 65, demand: 40 },
  { goodId: "luxuries", goodName: "Luxuries", basePrice: 150, currentPrice: 200, supply: 15, demand: 90 },
];

export const MOCK_PRICE_HISTORY: { time: string; price: number }[] = [
  { time: "T-9", price: 25 },
  { time: "T-8", price: 22 },
  { time: "T-7", price: 28 },
  { time: "T-6", price: 24 },
  { time: "T-5", price: 30 },
  { time: "T-4", price: 27 },
  { time: "T-3", price: 32 },
  { time: "T-2", price: 29 },
  { time: "T-1", price: 35 },
  { time: "Now", price: 33 },
];

export const MOCK_TRADE_HISTORY: TradeHistoryEntry[] = [
  {
    id: "trade-1",
    stationId: "station-sol",
    goodId: "food",
    goodName: "Food",
    price: 20,
    quantity: 10,
    type: "buy",
    createdAt: "2025-01-15T10:30:00Z",
  },
  {
    id: "trade-2",
    stationId: "station-sol",
    goodId: "ore",
    goodName: "Ore",
    price: 32,
    quantity: 5,
    type: "buy",
    createdAt: "2025-01-15T11:00:00Z",
  },
];

const SOL_SYSTEM = {
  id: "sol",
  name: "Sol",
  economyType: "core" as const,
  x: 400,
  y: 300,
  description: "Humanity's birthplace.",
};

export const MOCK_FLEET: FleetState = {
  id: "player-1",
  userId: "user-1",
  credits: 1000,
  ships: [
    {
      id: "ship-1",
      name: "Starter Ship",
      fuel: 85,
      maxFuel: 100,
      cargoMax: 50,
      status: "docked",
      systemId: "sol",
      system: SOL_SYSTEM,
      destinationSystemId: null,
      destinationSystem: null,
      departureTick: null,
      arrivalTick: null,
      cargo: [
        { goodId: "food", goodName: "Food", quantity: 10 },
        { goodId: "ore", goodName: "Ore", quantity: 5 },
      ],
    },
  ],
};
