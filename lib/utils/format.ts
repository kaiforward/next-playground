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

/**
 * A signed delta (a per-cycle net) with an explicit sign either way: "+" or a
 * true minus ("−", not a hyphen), then the magnitude via `formatMagnitude`.
 */
export function formatSignedMagnitude(value: number): string {
  return `${value < 0 ? "−" : "+"}${formatMagnitude(Math.abs(value))}`;
}

/**
 * Compact whole-unit magnitude for tight numeric columns: a whole number below
 * 1000, then k / M abbreviated above (999 → "999", 1240 → "1.2k", 12400 → "12k",
 * 3_400_000 → "3.4M"). One decimal only below ×10 of each suffix, whole above.
 * For unit/good counts where a bare four-digit number would crowd the column.
 */
export function formatUnitsShort(value: number): string {
  if (value <= 0) return "0";
  if (value < 1000) return String(Math.round(value));
  if (value < 1_000_000) {
    const k = value / 1000;
    return `${k >= 10 ? Math.round(k) : Math.round(k * 10) / 10}k`;
  }
  const m = value / 1_000_000;
  return `${m >= 10 ? Math.round(m) : Math.round(m * 10) / 10}M`;
}

/** A 0-1 fraction as a rounded whole percentage. */
export function fractionPct(fraction: number): number {
  return Math.round(fraction * 100);
}

/** People represented by one abstract population unit. */
export const PEOPLE_PER_UNIT = 1_000_000;

/**
 * Full grouped headcount from the abstract population Float. 1 abstract unit =
 * 1,000,000 people, so 141.763123 -> "141,763,123"; the Float's fractional part
 * supplies the live-ticking low digits.
 *
 * Display-only: the scaled value exceeds int32 and must never be written back to world state.
 */
export function formatHeadcount(pop: number): string {
  return Math.round(pop * PEOPLE_PER_UNIT).toLocaleString();
}

/**
 * Compact people count from an abstract population Float, with no whole-unit pre-round, so
 * sub-million quantities keep K precision:
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

/**
 * Splits an Intl compact-notation string (e.g. "2.42M", "980K", "0") into its numeric value and
 * unit suffix, so a VitalTile can render the unit small. Built for the shape `formatPeople`'s
 * output always takes — NOT for `formatMagnitude`, which produces a different string family
 * ("<0.1", "3.4", "42") and only survives this by falling through the no-match branch.
 */
export function splitCompactNumber(formatted: string): { value: string; unit?: string } {
  const match = formatted.match(/^([\d.,]+)([A-Za-z]*)$/);
  if (!match) return { value: formatted };
  const [, value, unit] = match;
  return { value, unit: unit || undefined };
}

/**
 * Splits an authored "name (bracketed descriptor)" string — the sun-class names in
 * `SUN_CLASSES` ("Yellow (Sol-like)", "Blue–white (hot)") — into the headline name and the
 * bracket, so a caller can uppercase the name while leaving the bracket as authored. A name with
 * no bracket returns just `primary` (the whole string), which a caller uppercases in full. Any
 * text from the first `(` onward — including a closing `)` and whatever follows it — rides in
 * `suffix` untouched; only whitespace directly before the bracket is trimmed away.
 */
export function splitBracketedName(name: string): { primary: string; suffix?: string } {
  const idx = name.indexOf("(");
  if (idx === -1) return { primary: name };
  return { primary: name.slice(0, idx).trimEnd(), suffix: name.slice(idx) };
}
