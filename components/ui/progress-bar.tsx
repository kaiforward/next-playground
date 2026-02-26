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
        labelRow: "text-[10px] text-text-muted",
      },
      md: {
        track: "h-2.5",
        labelRow: "text-xs text-text-tertiary mb-1",
      },
    },
    color: {
      copper: { fill: "bg-accent" },
      blue: { fill: "bg-blue-500" },
      amber: { fill: "bg-amber-500" },
      red: { fill: "bg-red-500" },
      green: { fill: "bg-green-500" },
      purple: { fill: "bg-purple-500" },
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
}

export function ProgressBar({
  label,
  value,
  max,
  color,
  size,
  className,
  ariaLabel,
}: ProgressBarProps) {
  const percent = max > 0 ? (value / max) * 100 : 0;
  const styles = progressBarVariants({ size, color });

  return (
    <div className={className}>
      <div className={styles.labelRow()}>
        <span>{label}</span>
        <span>{value} / {max}</span>
      </div>
      <div
        className={styles.track()}
        role="progressbar"
        aria-valuenow={Math.round(percent)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={ariaLabel ?? `${label}: ${value} / ${max}`}
      >
        <div
          className={styles.fill()}
          style={{ width: `${Math.min(percent, 100)}%` }}
        />
      </div>
    </div>
  );
}
