/** Centralized query key factory — one place for all cache keys. */
export const queryKeys = {
  universe: ["universe"] as const,
  marketAll: ["market"] as const,
  market: (systemId: string) => ["market", systemId] as const,
  marketByGood: (goodId: string) => ["market", "by-good", goodId] as const,
  events: ["events"] as const,
  devEconomy: ["devEconomy"] as const,
  // Atlas + progressive loading
  atlas: ["atlas"] as const,
  staticTile: (col: number, row: number, mapSize: number) =>
    ["staticTile", col, row, mapSize] as const,
  visibility: ["visibility"] as const,
  // All-systems stability (tick-scoped — badge + map choropleth)
  stability: ["stability"] as const,
  // All-systems population (tick-scoped — map choropleth)
  populationMap: ["populationMap"] as const,
  // All-systems development 0..1 (tick-scoped — map choropleth)
  developmentMap: ["developmentMap"] as const,
  // All-systems migration attractiveness, developed systems only (tick-scoped — map choropleth)
  migrationMap: ["migrationMap"] as const,
  // All-systems ownership (faction + developed tier — tick-scoped; political territory + markers)
  ownership: ["ownership"] as const,
  // Trade flow overlay (tick-scoped, gated by overlay toggle)
  tradeFlow: ["tradeFlow"] as const,
  // Per-system physical substrate (Astrography panel) — static, not tick-scoped.
  systemSubstrate: (systemId: string) => ["systemSubstrate", systemId] as const,
  // Per-system cadence shard groups (header countdowns) — static, not tick-scoped.
  systemCadence: (systemId: string) => ["systemCadence", systemId] as const,
  // Per-system dynamic population/unrest/demand — tick-invalidated.
  systemPopulationAll: ["systemPopulation"] as const,
  systemPopulation: (systemId: string) => ["systemPopulation", systemId] as const,
  // Per-system overview vitals (stability/development/population) — tick-invalidated.
  systemVitalsAll: ["systemVitals"] as const,
  systemVitals: (systemId: string) => ["systemVitals", systemId] as const,
  // Per-system industrial base + supply-chain state — tick-invalidated.
  systemIndustryAll: ["systemIndustry"] as const,
  systemIndustry: (systemId: string) => ["systemIndustry", systemId] as const,
  // Per-system logistics (imports/exports + prod/con dashboard) — tick-invalidated.
  systemLogisticsAll: ["systemLogistics"] as const,
  systemLogistics: (systemId: string) => ["systemLogistics", systemId] as const,
  // Per-system construction section — tick-invalidated (progress advances each funded pulse).
  systemConstructionAll: ["systemConstruction"] as const,
  systemConstruction: (systemId: string) => ["systemConstruction", systemId] as const,
  // Per-system player build options (feasibility + verbs) — tick-invalidated.
  systemBuildOptionsAll: ["systemBuildOptions"] as const,
  systemBuildOptions: (systemId: string) => ["systemBuildOptions", systemId] as const,
  // Per-faction construction roll-up — tick-invalidated.
  factionConstructionAll: ["factionConstruction"] as const,
  factionConstruction: (factionId: string) => ["factionConstruction", factionId] as const,
  // Factions
  factions: ["factions"] as const,
  faction: (factionId: string) => ["factions", factionId] as const,
  factionRelations: ["factions", "relations"] as const,
  // Per-faction overview vitals roll-up (territory/pop/stability/development) — tick-invalidated.
  factionVitalsAll: ["factionVitals"] as const,
  factionVitals: (factionId: string) => ["factionVitals", factionId] as const,
};
