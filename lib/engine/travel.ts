/** Travel duration in ticks for a single hop given its fuel cost. */
export function hopDuration(fuelCost: number): number {
  return Math.max(1, Math.ceil(fuelCost / 2));
}
