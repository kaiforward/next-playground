import Link from "next/link";
import { tv, type VariantProps } from "tailwind-variants";
import { Badge } from "@/components/ui/badge";
import { FactionStatusBadge } from "./faction-status-badge";
import type { FactionSummary } from "@/lib/services/factions";

const cardVariants = tv({
  base: [
    "block bg-surface border-l-4 transition-colors",
    "hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
  ],
  variants: {
    size: {
      sm: "p-3",
      md: "p-5",
    },
    interactive: {
      true: "cursor-pointer",
      false: "",
    },
  },
  defaultVariants: { size: "sm", interactive: false },
});

type CardVariants = VariantProps<typeof cardVariants>;

interface FactionCardProps extends CardVariants {
  faction: FactionSummary;
  /** When set, the card renders as a Next.js Link to this href. */
  href?: string;
  /** Override description display. By default, `md` shows it and `sm` hides it. */
  showDescription?: boolean;
  className?: string;
}

export function FactionCard({
  faction,
  href,
  size,
  showDescription,
  className,
}: FactionCardProps) {
  const interactive = !!href;
  const renderDescription =
    showDescription ?? (size === "md");

  const body = (
    <>
      <div className="flex items-start gap-3">
        <span
          className="mt-1 h-4 w-4 shrink-0 border border-border"
          style={{ backgroundColor: faction.color }}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h3
              className={
                size === "md"
                  ? "font-display text-lg text-text-primary"
                  : "font-display text-base text-text-primary truncate"
              }
            >
              {faction.name}
            </h3>
            <FactionStatusBadge status={faction.status} />
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <Badge color="blue">{faction.governmentName}</Badge>
            <Badge color="purple">{faction.doctrineName}</Badge>
            <span className="text-xs text-text-tertiary font-mono">
              {faction.territorySize} systems
            </span>
          </div>
          {renderDescription && faction.description && (
            <p className="mt-3 text-sm text-text-secondary leading-relaxed">
              {faction.description}
            </p>
          )}
        </div>
      </div>
    </>
  );

  const className_ = cardVariants({ size, interactive, className });
  const style = { borderLeftColor: faction.color };

  if (href) {
    return (
      <Link href={href} className={className_} style={style}>
        {body}
      </Link>
    );
  }
  return (
    <div className={className_} style={style}>
      {body}
    </div>
  );
}
