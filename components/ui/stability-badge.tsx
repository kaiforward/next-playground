import { stabilityLabel, stabilityRampColor } from "@/lib/utils/stability";

interface StabilityBadgeProps {
  unrest: number;
}

/**
 * Label-only badge (e.g. "Stable", "Strike") accented with the cool→hot
 * stability ramp, matching the map's stability mode so the two surfaces align.
 * High unrest → hot/red; low unrest → cool/green.
 */
export function StabilityBadge({ unrest }: StabilityBadgeProps) {
  const label = stabilityLabel(unrest);
  const color = stabilityRampColor(unrest);
  return (
    <span
      className="inline-block border px-2 py-0.5 text-xs font-semibold uppercase tracking-wider"
      style={{ color, borderColor: `${color}66`, backgroundColor: `${color}1a` }}
    >
      {label}
    </span>
  );
}
