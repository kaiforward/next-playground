/** Centralized query key factory — one place for all cache keys. */
export const queryKeys = {
  fleet: ["fleet"] as const,
  universe: ["universe"] as const,
  marketAll: ["market"] as const,
  market: (systemId: string) => ["market", systemId] as const,
  tradeHistory: (systemId: string) => ["tradeHistory", systemId] as const,
  events: ["events"] as const,
  priceHistory: (systemId: string) => ["priceHistory", systemId] as const,
  devEconomy: ["devEconomy"] as const,
  missionsAll: ["missions"] as const,
  systemMissions: (systemId: string) => ["missions", systemId] as const,
  playerMissions: ["missions", "player"] as const,
  convoys: ["convoys"] as const,
  // Operational missions & battles
  opMissionsAll: ["opMissions"] as const,
  systemAllMissions: (systemId: string) => ["opMissions", systemId] as const,
  playerOpMissions: ["opMissions", "player"] as const,
  battles: ["battles"] as const,
  battleDetail: (battleId: string) => ["battles", battleId] as const,
  // Notifications
  notifications: ["notifications"] as const,
  unreadCount: ["unreadCount"] as const,
};
