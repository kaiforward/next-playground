/**
 * Trade flow-event constants — retention window + overlay/route inference floors
 * for the `world.flowEvents` log written by directed-logistics.
 */

export const TRADE_SIMULATION = {
  /** Window (in ticks) for flow history retention and route inference. */
  FLOW_HISTORY_TICKS: 200,
  /** Minimum cumulative flow on an edge to count toward route inference. */
  ROUTE_INFERENCE_FLOOR: 5,
  /**
   * Minimum cumulative LOGISTICS flow on an edge to render. Lower than the
   * market `ROUTE_INFERENCE_FLOOR` — directed logistics is sparse (one transfer
   * per faction-shard sweep) and small in the pre-scale economy, so the market
   * floor would hide most logistics arcs. Lifts naturally once ECONOMY_SCALE lands.
   */
  LOGISTICS_ROUTE_FLOOR: 1,
} as const;
