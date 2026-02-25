/**
 * Shared slot definitions for form input components.
 * Import and spread into each tv() definition to keep label/error/hint styles consistent.
 */

export const formSlots = {
  label: "block font-medium mb-1",
  error: "mt-1 text-red-400",
  hint: "mt-1 text-text-muted",
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
