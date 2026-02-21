// Suit → visual mapping utilities for Void's Gambit UI.
// Single source of truth for suit visuals across all cantina components.
// Components pass a Suit and get back typed class accessors — no inline lookups.

import { tv } from "tailwind-variants";

// ── Suit theme (tv slots) ───────────────────────────────────────
// Usage:
//   const theme = suitTheme({ suit: card.suit });
//   <div className={theme.card()}>        ← bg + border
//   <span className={theme.text()}>       ← text color

export const suitTheme = tv({
  slots: {
    card: "",
    text: "",
  },
  variants: {
    suit: {
      raw_materials: { card: "bg-amber-500/15 border-amber-500/30",  text: "text-amber-300" },
      refined_goods: { card: "bg-blue-500/15 border-blue-500/30",    text: "text-blue-300" },
      tech:          { card: "bg-green-500/15 border-green-500/30",  text: "text-green-300" },
      luxuries:      { card: "bg-purple-500/15 border-purple-500/30", text: "text-purple-300" },
    },
  },
});
