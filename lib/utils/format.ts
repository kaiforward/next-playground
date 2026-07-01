/** Format a credit value with locale separators and CR suffix. */
export function formatCredits(value: number): string {
  return `${value.toLocaleString()} CR`;
}

/** Format a timestamp as a relative time string (e.g. "2m ago", "just now"). */
export function formatRelativeTime(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);

  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds}s ago`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/** Format a plain number with locale thousands separators, rounded (no suffix). */
export function formatNumber(value: number): string {
  return Math.round(value).toLocaleString();
}

/**
 * Format a continuous substrate magnitude — building counts, space-partition
 * units, worked slots. These are Floats (a partial settlement / sliver of land is
 * a real, sub-1 magnitude), so a present value must never collapse to "0": large
 * magnitudes read as whole numbers, small ones keep a decimal, and anything
 * positive-but-tiny shows "<0.1" rather than rounding away.
 */
export function formatMagnitude(value: number): string {
  if (value <= 0) return "0";
  if (value >= 10) return String(Math.round(value));
  if (value >= 0.1) return value.toFixed(1);
  return "<0.1";
}

/** People represented by one abstract population unit. */
export const PEOPLE_PER_UNIT = 1_000_000;

/**
 * Full grouped headcount from the abstract population Float. 1 abstract unit =
 * 1,000,000 people, so 141.763123 -> "141,763,123"; the Float's fractional part
 * supplies the live-ticking low digits.
 *
 * Display-only: the scaled value exceeds int32 and must never be written to Prisma.
 */
export function formatHeadcount(pop: number): string {
  return Math.round(pop * PEOPLE_PER_UNIT).toLocaleString();
}

/**
 * Compact headcount for tight labels (e.g. the utilisation bar). Rounds to a
 * whole abstract unit first so 141.8 -> "142M" (not "141.8M"), then formats with
 * Intl compact notation: "142M", "3.4B".
 */
export function formatHeadcountShort(pop: number): string {
  const people = Math.round(pop) * PEOPLE_PER_UNIT;
  return new Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(people);
}

/**
 * Compact people count from an abstract population Float WITHOUT the whole-unit
 * pre-round formatHeadcountShort does — so sub-million quantities keep K precision:
 * 198 -> "198M", 3.8 -> "3.8M", 0.98 -> "980K", 0.011 -> "11K". Use where small
 * magnitudes matter (e.g. the Labour card's skill pools, which are often < 1 unit).
 */
export function formatPeople(pop: number): string {
  if (pop <= 0) return "0";
  return new Intl.NumberFormat("en", {
    notation: "compact",
    maximumSignificantDigits: 3,
  }).format(pop * PEOPLE_PER_UNIT);
}
