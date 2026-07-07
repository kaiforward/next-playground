/** Centralized query key factory — one place for all cache keys. */
export const queryKeys = {
  universe: ["universe"] as const,
  marketAll: ["market"] as const,
  market: (systemId: string) => ["market", systemId] as const,
  marketByGood: (goodId: string) => ["market", "by-good", goodId] as const,
  goods: ["goods"] as const,
  events: ["events"] as const,
  devEconomy: ["devEconomy"] as const,
  // Atlas + progressive loading
  atlas: ["atlas"] as const,
  staticTile: (col: number, row: number, scale: string) => ["staticTile", col, row, scale] as const,
  // Visibility + dynamic data (separated concerns)
  visibility: ["visibility"] as const,
  dynamicVisible: ["dynamicVisible"] as const,
  // All-systems stability (tick-scoped — badge + map choropleth)
  stability: ["stability"] as const,
  // All-systems population (tick-scoped — map choropleth)
  populationMap: ["populationMap"] as const,
  // Trade flow overlay (tick-scoped, gated by overlay toggle)
  tradeFlow: ["tradeFlow"] as const,
  // Per-system physical substrate (Astrography panel) — static, not tick-scoped.
  systemSubstrate: (systemId: string) => ["systemSubstrate", systemId] as const,
  // Per-system cadence shard groups (header countdowns) — static, not tick-scoped.
  systemCadence: (systemId: string) => ["systemCadence", systemId] as const,
  // Per-system dynamic population/unrest/demand — tick-invalidated.
  systemPopulationAll: ["systemPopulation"] as const,
  systemPopulation: (systemId: string) => ["systemPopulation", systemId] as const,
  // Per-system industrial base + supply-chain state — tick-invalidated.
  systemIndustryAll: ["systemIndustry"] as const,
  systemIndustry: (systemId: string) => ["systemIndustry", systemId] as const,
  // Per-system logistics (imports/exports + prod/con dashboard) — tick-invalidated.
  systemLogisticsAll: ["systemLogistics"] as const,
  systemLogistics: (systemId: string) => ["systemLogistics", systemId] as const,
  // Factions
  factions: ["factions"] as const,
  faction: (factionId: string) => ["factions", factionId] as const,
  factionRelations: ["factions", "relations"] as const,
};
