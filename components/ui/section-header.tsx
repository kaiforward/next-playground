import { tv, type VariantProps } from "tailwind-variants";

const sectionHeaderVariants = tv({
  base: "text-xs font-semibold uppercase tracking-wider",
  variants: {
    color: {
      default: "text-gray-400",
      green: "text-green-400/70",
      red: "text-red-400/70",
    },
  },
  defaultVariants: {
    color: "default",
  },
});

type SectionHeaderVariants = VariantProps<typeof sectionHeaderVariants>;

interface SectionHeaderProps extends SectionHeaderVariants {
  children: React.ReactNode;
  as?: "h3" | "h4";
  className?: string;
}

export function SectionHeader({
  children,
  as: Tag = "h3",
  color,
  className,
}: SectionHeaderProps) {
  return (
    <Tag className={sectionHeaderVariants({ color, className })}>
      {children}
    </Tag>
  );
}
