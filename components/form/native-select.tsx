import { tv, type VariantProps } from "tailwind-variants";

const nativeSelect = tv({
  base: "bg-surface border border-border text-text-primary focus:outline-none focus:border-accent transition-colors",
  variants: {
    size: {
      sm: "px-2 py-1 text-xs",
      md: "px-3 py-1.5 text-sm",
    },
  },
  defaultVariants: { size: "sm" },
});

type NativeSelectVariants = VariantProps<typeof nativeSelect>;

interface NativeSelectOption {
  id: string;
  label: string;
}

interface NativeSelectProps extends NativeSelectVariants {
  options: NativeSelectOption[];
  value?: string;
  onChange: (value: string) => void;
  className?: string;
  "aria-label"?: string;
}

export function NativeSelect({ options, value, onChange, size, className, "aria-label": ariaLabel }: NativeSelectProps) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={nativeSelect({ size, className })}
      aria-label={ariaLabel}
    >
      {options.map((opt) => (
        <option key={opt.id} value={opt.id}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}
