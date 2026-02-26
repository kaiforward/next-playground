"use client";

import { tv, type VariantProps } from "tailwind-variants";
import type { QualityTier, TraitCategory } from "@/lib/types/game";
import type { EnrichedTrait } from "@/lib/utils/traits";

// ── Quality stars ────────────────────────────────────────────────

function QualityStars({ quality }: { quality: QualityTier }) {
  return (
    <span className="text-xs tracking-tight" aria-label={`Quality ${quality} of 3`}>
      <span className="text-amber-400">{"★".repeat(quality)}</span>
      <span className="text-text-faint">{"☆".repeat(3 - quality)}</span>
    </span>
  );
}

// ── Category label ───────────────────────────────────────────────

const CATEGORY_LABEL: Record<TraitCategory, string> = {
  planetary: "Planetary",
  orbital: "Orbital",
  resource: "Resource",
  phenomena: "Phenomena",
  legacy: "Legacy",
};

const categoryBadge = tv({
  base: "inline-block px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider",
  variants: {
    category: {
      planetary: "bg-green-500/15 text-green-400",
      orbital: "bg-blue-500/15 text-blue-400",
      resource: "bg-amber-500/15 text-amber-400",
      phenomena: "bg-purple-500/15 text-purple-400",
      legacy: "bg-cyan-500/15 text-cyan-400",
    },
  },
});

// ── Trait list variants ──────────────────────────────────────────

const traitListVariants = tv({
  base: "space-y-2",
  variants: {
    variant: {
      full: "",
      compact: "",
    },
  },
  defaultVariants: {
    variant: "full",
  },
});

type TraitListVariants = VariantProps<typeof traitListVariants>;

interface TraitListProps extends TraitListVariants {
  traits: EnrichedTrait[];
  className?: string;
}

/**
 * Displays system traits with quality stars, names, and descriptions.
 *
 * Accepts pre-enriched trait data (use `enrichTraits()` from `lib/utils/traits`).
 *
 * - `full` variant: shows category badge, quality label, and full description
 * - `compact` variant: one-line per trait — stars + name only
 */
export function TraitList({ traits, variant = "full", className }: TraitListProps) {
  if (traits.length === 0) return null;

  // Sort by quality descending, then alphabetical
  const sorted = [...traits].sort(
    (a, b) => b.quality - a.quality || a.traitId.localeCompare(b.traitId),
  );

  if (variant === "compact") {
    return (
      <ul className={`space-y-1 ${className ?? ""}`}>
        {sorted.map((t) => (
          <li key={t.traitId} className="flex items-center gap-2">
            <QualityStars quality={t.quality} />
            <span className="text-sm text-text-primary">{t.name}</span>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <ul className={traitListVariants({ variant, className })}>
      {sorted.map((t) => (
        <li key={t.traitId} className="bg-surface px-3 py-2.5">
          <div className="flex items-center gap-2 mb-1">
            <QualityStars quality={t.quality} />
            <span className="text-sm font-medium text-text-primary">{t.name}</span>
            <span className={categoryBadge({ category: t.category })}>
              {CATEGORY_LABEL[t.category]}
            </span>
          </div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] font-medium uppercase tracking-wider text-text-faint">
              {t.qualityLabel}
            </span>
            {t.negative && (
              <span className="text-[10px] font-medium uppercase tracking-wider text-red-400/60">
                Hazardous
              </span>
            )}
          </div>
          <p className="text-xs text-text-tertiary leading-relaxed">
            {t.description}
          </p>
        </li>
      ))}
    </ul>
  );
}
