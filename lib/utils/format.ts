/** Format a credit value with locale separators and CR suffix. */
export function formatCredits(value: number): string {
  return `${value.toLocaleString()} CR`;
}
