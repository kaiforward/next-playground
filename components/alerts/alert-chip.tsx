"use client";

import { forwardRef, type ComponentPropsWithoutRef, type CSSProperties } from "react";
import { tv } from "tailwind-variants";
import { ALERT_CATEGORIES } from "@/lib/constants/alerts";
import type { AlertTier } from "@/lib/types/alerts";
import type { AlertCategory } from "@/lib/types/api";

/** Tier → the shared status-colour pair it borrows (`globals.css`'s `--color-status-*` tokens) —
 *  critical reads as danger, important as caution, info as a neutral opportunity. Exported so
 *  `alert-flyout.tsx`'s own border/icon accent reuses this rather than keeping a byte-for-byte copy
 *  (AGENTS.md's extract-on-second-occurrence rule). */
const TIER_COLOR: Record<AlertTier, { base: string; light: string }> = {
  critical: { base: "var(--color-status-red)", light: "var(--color-status-red-light)" },
  important: { base: "var(--color-status-amber)", light: "var(--color-status-amber-light)" },
  info: { base: "var(--color-status-blue)", light: "var(--color-status-blue-light)" },
};

/**
 * Exported so `CollapsedTail` (`components/alerts/alert-run.tsx`) — the "+N" tail chip — and the
 * run's settings control consume the same shell instead of hand-duplicating its classes, per
 * AGENTS.md's extract-on-second-occurrence rule.
 *
 * Every item in the run is absolutely positioned at the left offset `layoutRun`
 * (`lib/utils/alert-packing.ts`) placed it at, so the shell carries the positioning and the vertical
 * centring — `top-1/2 -translate-y-1/2` inside a container of `RUN_HEIGHT`, the one rule that
 * replaces the flex row's `items-center` for chips, control and tail alike. `z-[var(--z,1)]` reads
 * the resting stack order the placed chip carries, set per chip via the `--z` custom property — the
 * leftmost, most severe chip sits on top by default; `aria-expanded:z-[95]` raises an open chip's
 * own trigger clear of the whole stack regardless of position. Both are inert (fall back to `1`,
 * never trigger) for a chip rendered outside the placed run, e.g. this component's own tests.
 */
const chip = tv({
  base: [
    "absolute top-1/2 -translate-y-1/2 z-[var(--z,1)] aria-expanded:z-[95] pointer-events-auto inline-flex h-[26px] items-center gap-1.5 whitespace-nowrap border px-[9px]",
    // The two colour-mix knobs `AlertChip`'s own fill and border read, set only once Radix's
    // `PopoverTrigger` writes `data-state="open"` onto this exact button (composed via `asChild`,
    // not a wrapping element) — a custom property toggled by a `data-state` selector is the one
    // channel that still reaches an inline `color-mix` value, since an inline style always outranks
    // a class in the cascade and so can never itself be overridden by one. Inert for a consumer
    // that never reads `--chip-mix`/`--chip-border-mix` in its own inline style (`CollapsedTail`,
    // the settings trigger in `alert-run.tsx`) — the custom properties these two classes set simply
    // go unread.
    "data-[state=open]:[--chip-mix:32%] data-[state=open]:[--chip-border-mix:100%]",
    "font-sans text-[13px]",
    "transition-[filter] duration-150 hover:brightness-125 focus-visible:brightness-125",
    "focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background",
  ],
  variants: {
    /** Only meaningful once the run has packed chips at a negative gap: a spaced run has no stack to
     *  raise a chip clear of and nothing for it to cast a shadow over. Both values are verbatim from
     *  the approved prototype — `.bar-chips.overlap .chip`'s shadow and `.chip:hover`'s `z-index: 90`. */
    overlapping: {
      true: "shadow-[3px_0_7px_-1px_rgba(0,0,0,0.7)] hover:z-[90]",
      false: "",
    },
  },
  defaultVariants: { overlapping: false },
});

export { chip, TIER_COLOR };

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

interface AlertChipOwnProps {
  /** The category's standing read — count, denominator (where its unit has one) and instances.
   *  Tier, icon, label and whether the category is faulted come off `ALERT_CATEGORIES[category.id]`
   *  rather than being taken as separate props, so a caller cannot contradict the authored table. */
  category: AlertCategory;
  /** Resting stack order, off the placed chip `layoutRun` returned — the leftmost, most severe chip
   *  sits on top. Read by the shell's `z-[var(--z,1)]` base class. */
  zIndex?: number;
  /** Whether the run laid out at a negative gap (`RunLayout`'s `overlapping`), which turns on the
   *  shadow and the hover raise. */
  overlapping?: boolean;
  /** This chip's own left offset in the run, in CSS pixels, off the placed chip `layoutRun`
   *  returned. Applied directly to this button rather than to a wrapping positioned `<div>`:
   *  `Popover` renders no DOM node of its own (`PopperPrimitive.Root` is a bare context provider),
   *  so the trigger this component renders is already the element the run is placing — and it has to
   *  be, since a wrapper carrying the offset would also carry the z-index and scope the open chip's
   *  `aria-expanded:z-[95]` raise inside its own stacking context. */
  left?: number;
}

// The three packing/category props are deliberately narrow rather than an open `className`/`style`
// pair — omitted below from the DOM props this component otherwise forwards. The chip owns its own
// appearance — tier fill, icon, slash and the opaque-surface mix that lets chips overlap without
// showing each other or the map through — and a caller that could pass arbitrary styles could defeat
// that fill, which is the same reason tier, icon, label and `faulted` are read off the registry
// rather than taken as props. `aria-label`/`aria-labelledby` are omitted for the same reason and by
// the same mechanism: `{...triggerProps}` spreads LAST, so either one would replace the accessible
// name this component assembles out of rendered DOM (see its docstring) with a static string that
// cannot go stale with the elements it names.
type AlertChipProps = AlertChipOwnProps &
  Omit<
    ComponentPropsWithoutRef<"button">,
    keyof AlertChipOwnProps | "className" | "style" | "children" | "aria-label" | "aria-labelledby"
  >;

/**
 * One alert category on the run — a 20px icon plus count, no visible label, an opaque tier-tinted
 * fill (mixed into the surface colour, never into transparency, so chips can overlap and still sit
 * opaque over the map), and a cased fault slash for the categories the registry marks faulted.
 *
 * The accessible name is assembled from rendered DOM content — a hidden label span, the visible
 * count, a hidden unit/denominator span — rather than a static `aria-label`. That ties the name to
 * the same elements a player sees: if the count stops rendering, "3" drops out of the name with it.
 *
 * Rendered as a `PopoverTrigger`'s child (`components/alerts/alert-run.tsx`), never with its own
 * open/close state: Radix's Slot mechanism clones `onClick`, `aria-expanded`, `aria-haspopup`,
 * `aria-controls`, `data-state`, `type` and a `ref` onto whatever single element `PopoverTrigger`
 * wraps — which means a component in that position, not a plain `<button>` tag, has to accept and
 * forward them itself, or they are silently dropped and the trigger never opens (`forwardRef` plus
 * `{...triggerProps}` below is what makes that happen; `TrackerRow`'s own trigger button skips this
 * because it inlines the `<button>` directly rather than wrapping a separate component). This
 * component neither takes nor computes an `open` prop of its own — the fill's rest/open swap reads
 * `data-state` in CSS instead, via the two custom properties `chip`'s own base sets from it (see
 * their own docstring).
 */
export const AlertChip = forwardRef<HTMLButtonElement, AlertChipProps>(function AlertChip(
  { category, zIndex, overlapping, left, ...triggerProps },
  ref,
) {
  const def = ALERT_CATEGORIES[category.id];
  const Icon = def.icon;
  const tier = TIER_COLOR[def.tier];
  const suffix = unitSuffix(category);

  // Opaque fill: the tier colour mixed into the surface, never into transparency — required because
  // packed chips overlap and sit over a live map. 15% at rest, 32% open, matching the approved
  // prototype's `.chip` / `.chip[aria-expanded="true"]` mix percentages — expressed as a CSS
  // `color-mix` reading `--chip-mix`/`--chip-border-mix`, which fall back to the rest values below
  // until `chip`'s own `data-[state=open]:[--chip-mix:32%]` base class sets them, matching whether
  // Radix has actually written `data-state="open"` onto this button.
  const backgroundColor = `color-mix(in srgb, ${tier.base} var(--chip-mix, 15%), var(--color-surface))`;
  const borderColor = `color-mix(in srgb, ${tier.base} var(--chip-border-mix, 30%), var(--color-surface))`;

  // `--z` is a custom property, which `CSSProperties` alone does not admit; the intersection names
  // the ones this component sets rather than opening the object to arbitrary keys.
  const style: CSSProperties & { "--z"?: number } = {
    backgroundColor,
    borderColor,
    color: tier.light,
    left,
    "--z": zIndex,
  };

  return (
    <button ref={ref} type="button" className={chip({ overlapping })} style={style} {...triggerProps}>
      <Icon aria-hidden="true" className="h-5 w-5 flex-none">
        {def.faulted && (
          <>
            {/* The casing line: drawn first (so it paints under the slash), in the chip's own
                background colour, offset up and right — it carves a gap out of the glyph so the
                slash reads as a negation rather than one more stroke on a busy icon. Reads the same
                `color-mix` as the button's own fill, so it stays in step with the rest/open swap
                without its own `data-state` plumbing: a custom property inherits from this button to
                every descendant, this `<path>` included. */}
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
});
