/**
 * Survival-stock cycles-to-empty — the countdown a falling SURVIVAL_GOODS stock reads against.
 * Shared by the alert bar's Survival stock falling category (`lib/services/alerts.ts`) and the
 * calibration harness's `survivalStockFalling` lane metric (`lib/tick-harness/lane-analysis.ts`),
 * so both read the identical rule instead of two hand-rolled copies of "stock / -stockChange".
 */

/**
 * Cycles until `stock` reaches zero at the current per-cycle `stockChange`, or null when the stock
 * is not falling at all — `stockChange` undefined, zero, or positive. A rising or flat stock has no
 * cycles-to-empty to report; reporting one for it would misread ordinary oscillation as a countdown.
 */
export function survivalCyclesToEmpty(stock: number, stockChange: number | undefined): number | null {
  if (stockChange === undefined || stockChange >= 0) return null;
  return stock / -stockChange;
}
