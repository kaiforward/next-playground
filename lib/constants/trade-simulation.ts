/**
 * Trade flow-event constants — retention window + overlay/route inference floors
 * for the `world.flowEvents` log written by directed-logistics.
 */

export const TRADE_SIMULATION = {
  /** Window (in ticks) for flow history retention and route inference. */
  FLOW_HISTORY_TICKS: 200,
  /**
   * Minimum in-flight quantity on one (lane, direction) for that edge to render on the Logistics
   * overlay — an instantaneous reading off the freight ledger (the sum of every haul physically
   * crossing that lane in that direction right now, `buildLaneFlowEdges`), not a flow summed over
   * a retention window. Directed logistics is sparse (one transfer per faction-shard sweep) and
   * small in the pre-scale economy, so the floor is low: it exists to keep a single trickling haul
   * off the map, never to hide a real corridor. Lifts naturally once ECONOMY_SCALE lands.
   */
  LOGISTICS_ROUTE_FLOOR: 1,
} as const;
