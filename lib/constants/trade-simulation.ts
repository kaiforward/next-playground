/**
 * Trade simulation constants — drive the edge-flow processor.
 *
 * See `docs/design/active/trade-simulation.md`. Values are placeholders pending
 * sim-sweep calibration; tune via the simulator before promoting changes.
 */

export const TRADE_SIMULATION = {
  /** Process flow every N ticks (round-robin per region). */
  PROCESS_EVERY_N_TICKS: 4,
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
  /** Minimum cumulative flow on an edge to count toward route inference. */
  ROUTE_INFERENCE_FLOOR: 5,
} as const;
