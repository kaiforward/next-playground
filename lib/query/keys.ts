/** Centralized query key factory — one place for all cache keys. */
export const queryKeys = {
  fleet: ["fleet"] as const,
  world: ["world"] as const,
  universe: ["universe"] as const,
  market: (systemId: string) => ["market", systemId] as const,
  tradeHistory: (systemId: string) => ["tradeHistory", systemId] as const,
};
