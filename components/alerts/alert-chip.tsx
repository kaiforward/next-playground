"use client";

import { tv } from "tailwind-variants";
import { ALERT_CATEGORIES } from "@/lib/constants/alerts";
import type { AlertTier } from "@/lib/types/alerts";
import type { AlertCategory } from "@/lib/types/api";

/** Tier → the shared status-colour pair it borrows (`globals.css`'s `--color-status-*` tokens) —
 *  critical reads as danger, important as caution, info as a neutral opportunity. */
const TIER_COLOR: Record<AlertTier, { base: string; light: string }> = {
  critical: { base: "var(--color-status-red)", light: "var(--color-status-red-light)" },
  important: { base: "var(--color-status-amber)", light: "var(--color-status-amber-light)" },
  info: { base: "var(--color-status-blue)", light: "var(--color-status-blue-light)" },
};

const chip = tv({
  base: [
    "relative inline-flex h-[26px] flex-none items-center gap-1.5 whitespace-nowrap border px-[9px]",
    "font-sans text-[13px]",
    "transition-[filter] duration-150 hover:brightness-125 focus-visible:brightness-125",
    "focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background",
  ],
});

/** The words after the count, per the `AlertCategory` union's `unit` discriminant — the branch
 *  that stops a system-scoped count reading as a bare, unscaled severity and stops an event or
 *  faction-level count borrowing a denominator that isn't its own. `null` for `faction`:
 *  Maintenance unfunded's count is always 0 or 1 by construction, not a share of anything. */
function unitSuffix(category: AlertCategory): string | null {
  switch (category.unit) {
    case "developed_systems":
      return `of ${category.denominator} developed systems`;
    case "controlled_systems":
      return `of ${category.denominator} controlled systems`;
    case "events":
      return "events";
    case "faction":
      return null;
  }
}

interface AlertChipProps {
  /** The category's standing read — count, denominator (where its unit has one) and instances.
   *  Tier, icon, label and whether the category is faulted come off `ALERT_CATEGORIES[category.id]`
   *  rather than being taken as separate props, so a caller cannot contradict the authored table. */
  category: AlertCategory;
  /** Whether this chip's flyout is open — drives the disclosure's pressed/expanded state. */
  open: boolean;
  onOpen: () => void;
}

/**
 * One alert category on the run — a 20px icon plus count, no visible label, an opaque tier-tinted
 * fill (mixed into the surface colour, never into transparency, so chips can overlap and still sit
 * opaque over the map), and a cased fault slash for the categories the registry marks faulted.
 *
 * The accessible name is assembled from rendered DOM content — a hidden label span, the visible
 * count, a hidden unit/denominator span — rather than a static `aria-label`. That ties the name to
 * the same elements a player sees: if the count stops rendering, "3" drops out of the name with it.
 */
export function AlertChip({ category, open, onOpen }: AlertChipProps) {
  const def = ALERT_CATEGORIES[category.id];
  const Icon = def.icon;
  const tier = TIER_COLOR[def.tier];
  const suffix = unitSuffix(category);

  // Opaque fill: the tier colour mixed into the surface, never into transparency — required once
  // chips overlap (Task 12) and sit over a live map. 15% at rest, 32% open, matching the approved
  // prototype's `.chip` / `.chip[aria-expanded="true"]` mix percentages.
  const backgroundColor = `color-mix(in srgb, ${tier.base} ${open ? 32 : 15}%, var(--color-surface))`;
  const borderColor = open
    ? tier.base
    : `color-mix(in srgb, ${tier.base} 30%, var(--color-surface))`;

  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={onOpen}
      className={chip()}
      style={{ backgroundColor, borderColor, color: tier.light }}
    >
      <Icon aria-hidden="true" className="h-5 w-5 flex-none">
        {def.faulted && (
          <>
            {/* The casing line: drawn first (so it paints under the slash), in the chip's own
                background colour, offset up and right — it carves a gap out of the glyph so the
                slash reads as a negation rather than one more stroke on a busy icon. */}
            <path d="m3.6 0.4 20 20" stroke={backgroundColor} strokeWidth={3.2} />
            {/* The slash itself — lucide's own `-off` convention, borrowed for the two glyphs
                (`Factory`, `BedDouble`) the library has no negated variant for. */}
            <path d="m2 2 20 20" />
          </>
        )}
      </Icon>
      {/* The bare spaces between these spans are load-bearing, not formatting. An accessible name
          joins its children's text without a separator where they are laid out inline, so three
          adjacent spans would read "Famine,3of 253 developed systems". A literal text node puts a
          real space in the DOM, which browsers and jsdom read alike — a whitespace-only run between
          flex items generates no flex item, so it costs no visible gap. A space typed across two
          JSX lines would be stripped, hence `{" "}`. */}
      <span className="sr-only">{`${def.label},`}</span>{" "}
      <span className="font-mono font-medium">{category.count}</span>
      {suffix != null && <> <span className="sr-only">{suffix}</span></>}
    </button>
  );
}
