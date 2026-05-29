/**
 * Shared slot definitions for form input components.
 * Import and spread into each tv() definition to keep label/error/hint styles consistent.
 */

export const formSlots = {
  label: "block font-medium mb-1",
  error: "mt-1 text-red-400",
  hint: "mt-1 text-text-secondary",
} as const;

export const formSizeVariants = {
  sm: {
    label: "text-xs text-text-tertiary uppercase tracking-wider",
    error: "text-xs",
    hint: "text-xs",
  },
  md: {
    label: "text-sm text-text-secondary mb-1.5",
    error: "text-xs",
    hint: "text-xs",
  },
} as const;

/**
 * Shared row styling for single-choice controls (RadioGroup, CheckboxInput).
 * A full-width row with a copper left-accent stripe on the active choice and a
 * focus ring driven by the sr-only input inside (`has-[:focus-visible]`). The
 * indicator (round dot / square swatch) is pinned right by the consumer.
 * Spread `base`/`active`/`size` into each component's own tv() so radios and
 * checkboxes read as one family.
 */
export const choiceRow = {
  base: [
    "relative flex items-center gap-2 w-full cursor-pointer",
    "font-medium uppercase tracking-wider",
    "border-l-2 transition-colors duration-150",
    "focus:outline-none",
    "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-background",
  ],
  active: {
    true: "border-l-accent bg-accent/10 text-text-accent hover:bg-accent/20",
    false:
      "border-l-transparent bg-transparent text-text-secondary hover:bg-surface-hover hover:text-text-primary",
  },
  size: {
    sm: "px-3 py-1.5 text-xs",
    md: "px-3 py-2 text-sm",
  },
};
