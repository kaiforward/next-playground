/**
 * Trade simulation constants — drive the edge-flow processor.
 *
 * See `docs/design/active/trade-simulation.md`. Values are placeholders pending
 * sim-sweep calibration; tune via the simulator before promoting changes.
 */

export const TRADE_SIMULATION = {
  /**
   * Work-budget slice: edges processed per tick. The processor advances a cursor
   * over the stable open-edge order, so a full sweep takes ceil(totalOpenEdges /
   * EDGES_PER_TICK) ticks. Bounds per-tick DB work independently of faction size.
   *
   * MUST satisfy ceil(totalOpenEdges / EDGES_PER_TICK) < FLOW_HISTORY_TICKS,
   * else flow events prune before the sweep returns (overlay gaps); the 10K-scale
   * universe (largest open-edge count) is the binding case.
   */
  EDGES_PER_TICK: 256,
  /**
   * Distance attenuation coefficient. Per-edge flow is scaled by
   * 1/(1 + DISTANCE_DECAY · fuelCost), so costlier jumps move less and
   * gateways (low fuelCost) move more. 0 = no attenuation.
   */
  DISTANCE_DECAY: 0,
  /** Max units of one good moved per edge per processor run. */
  FLOW_BUDGET: 8,
  /**
   * Price gradient threshold below which no flow occurs. Expressed as a
   * fraction of basePrice so all goods use the same trigger.
   */
  GRADIENT_THRESHOLD: 0.05,
  /**
   * Linear response of flow fraction to gradient. At sensitivity 1.0 a
   * gradient equal to basePrice (1.0) saturates the budget.
   */
  GRADIENT_SENSITIVITY: 1.0,
  /** Window (in ticks) for flow history retention and route inference. */
  FLOW_HISTORY_TICKS: 200,
  /**
   * Player activity fully displaces edge flow at this multiple of
   * PROSPERITY_TARGET_VOLUME.
   */
  PLAYER_DISPLACEMENT_FACTOR: 2.0,
  /**
   * Wall-clock window (ms) for "recent" player trade volume used to throttle
   * flow. Sliding window over `TradeHistory.createdAt`.
   */
  PLAYER_VOLUME_WINDOW_MS: 60_000,
  /** Minimum cumulative flow on an edge to count toward route inference. */
  ROUTE_INFERENCE_FLOOR: 5,
} as const;
