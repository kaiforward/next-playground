/**
 * Trade simulation constants — drive the edge-flow processor.
 *
 * See `docs/design/active/trade-simulation.md`. Values are placeholders pending
 * sim-sweep calibration; tune via the simulator before promoting changes.
 */

export const TRADE_SIMULATION = {
  /**
   * Distance attenuation coefficient. Per-edge flow is scaled by
   * 1/(1 + DISTANCE_DECAY · fuelCost), so costlier jumps move less. 0 = no
   * attenuation. Calibrated to 0.1: the median local hop (fuelCost ~8.6) still
   * moves ~54% of budget while high-fuel intra-faction gateways (fuelCost up to
   * ~47) throttle toward ~18%, concentrating price dispersion on long-haul
   * high-value goods (notably luxuries) without starving distant systems or
   * pinning stock to a bound.
   */
  DISTANCE_DECAY: 0.1,
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
   * Per-system target trade volume that normalizes player-displacement pressure
   * (`edgeVolume / PLAYER_VOLUME_TARGET`). A throttle constant for NPC flow — was
   * `PROSPERITY_TARGET_VOLUME`, kept after prosperity's retirement (unrelated to it).
   */
  PLAYER_VOLUME_TARGET: 50,
  /**
   * Player activity fully displaces edge flow at this multiple of
   * PLAYER_VOLUME_TARGET.
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
