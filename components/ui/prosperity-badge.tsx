import { getProsperityLabel } from "@/lib/engine/tick";
import { prosperityRampColor, prosperityEffectLabel } from "@/lib/utils/prosperity";

interface ProsperityBadgeProps {
  prosperity: number;
}

/**
 * Label-only badge (e.g. "Booming") accented with the cold→warm prosperity
 * ramp, plus a muted descriptor of the mechanical effect next to it. Uses the
 * same ramp colour as the map's prosperity mode so the two surfaces match.
 */
export function ProsperityBadge({ prosperity }: ProsperityBadgeProps) {
  const label = getProsperityLabel(prosperity);
  const color = prosperityRampColor(prosperity);
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="inline-block border px-2 py-0.5 text-xs font-semibold uppercase tracking-wider"
        style={{ color, borderColor: `${color}66`, backgroundColor: `${color}1a` }}
      >
        {label}
      </span>
      <span className="text-[11px] text-text-tertiary">
        {prosperityEffectLabel(prosperity)}
      </span>
    </span>
  );
}
