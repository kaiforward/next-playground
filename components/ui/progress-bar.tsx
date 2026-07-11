import { tv, type VariantProps } from "tailwind-variants";

const progressBarVariants = tv({
  slots: {
    track: "bg-surface-active overflow-hidden",
    fill: "h-full transition-all",
    labelRow: "flex justify-between mb-0.5",
  },
  variants: {
    size: {
      sm: {
        track: "h-1.5",
        labelRow: "text-[10px] text-text-secondary",
      },
      md: {
        track: "h-2.5",
        labelRow: "text-xs text-text-tertiary mb-1",
      },
    },
    color: {
      copper: { fill: "bg-accent" },
      blue: { fill: "bg-status-blue" },
      amber: { fill: "bg-status-amber" },
      red: { fill: "bg-status-red" },
      green: { fill: "bg-status-green" },
      purple: { fill: "bg-status-purple" },
      cyan: { fill: "bg-status-cyan" },
    },
  },
  defaultVariants: {
    size: "sm",
    color: "copper",
  },
});

type ProgressBarVariants = VariantProps<typeof progressBarVariants>;

interface ProgressBarProps extends ProgressBarVariants {
  label: string;
  value: number;
  max: number;
  className?: string;
  ariaLabel?: string;
  /** Formats the "value / max" label endpoints. Default: identity (numbers as-is). */
  formatValue?: (n: number) => string;
  /** Overrides the right-hand "value / max" readout with a single custom string (e.g. a percentage). The fill still tracks value/max. */
  valueText?: string;
  /** Optional "projected next step" amount (same unit as value/max) rendered as a lighter segment after the fill — e.g. next pulse's construction gain. */
  projected?: number;
}

export function ProgressBar({
  label,
  value,
  max,
  color,
  size,
  className,
  ariaLabel,
  formatValue = (n) => String(n),
  valueText,
  projected,
}: ProgressBarProps) {
  const percent = max > 0 ? (value / max) * 100 : 0;
  const styles = progressBarVariants({ size, color });
  const rightLabel = valueText ?? `${formatValue(value)} / ${formatValue(max)}`;
  const donePct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const projectedPct =
    max > 0 && projected && projected > 0 ? Math.min(100 - donePct, (projected / max) * 100) : 0;

  return (
    <div className={className}>
      <div className={styles.labelRow()}>
        <span>{label}</span>
        <span>{rightLabel}</span>
      </div>
      <div
        className={styles.track()}
        role="progressbar"
        aria-valuenow={Math.round(percent)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={ariaLabel ?? `${label}: ${rightLabel}`}
      >
        <div className="flex h-full">
          <div className={styles.fill()} style={{ width: `${donePct}%` }} />
          {projectedPct > 0 && (
            <div className={`${styles.fill()} opacity-40`} style={{ width: `${projectedPct}%` }} />
          )}
        </div>
      </div>
    </div>
  );
}
