# Foundry Theme — Design Reference

Visual language for Stellar Trader. Industrial, utilitarian, warm copper/amber accents on a dark steel background. Think spacecraft instrument panels and factory control rooms — functional, sharp, no unnecessary decoration.

Defined in `app/globals.css` via `@theme inline {}`. All components use tailwind-variants (`tv()`).

---

## Color Palette

### Surfaces

| Token | Hex | Usage |
|-------|-----|-------|
| `background` | `#0e1117` | Page background (near-black steel) |
| `surface` | `#161b22` | Cards, panels, containers |
| `surface-hover` | `#1c2129` | Hover/highlight state for surfaces |
| `surface-active` | `#242a33` | Active/pressed state, progress bar tracks |

### Text Hierarchy

Three tiers — all pass WCAG AA 4.5:1 contrast against `surface`. Plus an accent tier for highlighted labels.

| Token | Hex | Ratio | Usage |
|-------|-----|-------|-------|
| `text-primary` | `#c9d1d9` | ~10:1 | Headings, values, key information |
| `text-secondary` | `#8b949e` | ~5.9:1 | Supporting text, descriptions, de-emphasized metadata |
| `text-tertiary` | `#7d868e` | ~4.6:1 | Labels, stat names, hints |
| `text-accent` | = `accent` | ~4.8:1 | Highlighted labels, active states (copper) |

### Accent Colors

| Token | Hex | Usage |
|-------|-----|-------|
| `accent` | `#d06a42` | Primary accent — copper. Card left stripes, primary buttons, active filter highlights, tab underlines |
| `accent-muted` | `#a04428` | Hover/pressed state for accent elements |
| `secondary` | `#d4a04a` | Gold — secondary accent for special highlights |

### Status Colors

Shared palette for Badge, ProgressBar, Button, InlineAlert, and Tabs. Defined as CSS variables in `globals.css` so all components reference a single source of truth. Each color has a base (for backgrounds/borders) and a light variant (for text).

| Token | Base (bg/border) | Light (text) | Meaning |
|-------|-----------------|--------------|---------|
| `status-green` | `#22c55e` | `#86efac` | Success, victory, health, positive values |
| `status-red` | `#ef4444` | `#fca5a5` | Danger, defeat, damage, negative values |
| `status-amber` | `#f59e0b` | `#fcd34d` | Warning, in-progress, caution |
| `status-blue` | `#3b82f6` | `#93c5fd` | Navigation links, info, player strength |
| `status-purple` | `#a855f7` | `#d8b4fe` | Mission types, battle status |
| `status-cyan` | `#06b6d4` | `#67e8f9` | Map pins, location highlights |
| `status-slate` | `#64748b` | `#cbd5e1` | Neutral/default |

**Usage patterns by component:**
- **Badge**: `bg-status-{color}/20 text-status-{color}-light` (subtle tinted indicator)
- **ProgressBar**: `bg-status-{color}` (solid fill)
- **Button** (action/pill): `bg-status-{color}/15 text-status-{color}-light border-status-{color}/30` (instrument panel)
- **InlineAlert**: `bg-status-{color}/10 border-status-{color}/20 text-status-{color}-light`
- **Tabs** (pill active): `bg-status-{color}/20 text-status-{color}-light`

**Not on status palette:** EconomyBadge and TraitList use specialized color patterns (darker shades, `-900/80` backgrounds) that don't map to status semantics. Those stay on Tailwind defaults.

### Borders

| Token | Value | Usage |
|-------|-------|-------|
| `border` | `rgba(139, 148, 158, 0.15)` | Default border — subtle, barely visible |
| `border-strong` | `rgba(139, 148, 158, 0.30)` | Emphasized borders |

---

## Typography

Three font families, each with a specific role:

| Token | Font | Role |
|-------|------|------|
| `font-sans` | **Geist** | Body text — all regular content, labels, descriptions |
| `font-mono` | **Geist Mono** | Numeric values, credit amounts, coordinates, code |
| `font-display` | **Chakra Petch** | Headings, card titles, section headers — industrial/techy feel |

### Usage Rules

- Card titles (`CardHeader`): `font-display font-semibold`
- Section headers (`SectionHeader`): `font-display font-semibold uppercase tracking-wider`
- Detail panel titles: `font-display font-bold`
- Body text: inherits `font-sans` from body
- Credit values / tick counts: `font-mono`

---

## Shape Language

**Sharp edges everywhere.** No rounded corners on cards, containers, buttons, badges, or progress bars. The only exceptions are:

- **DetailPanel** modal wrapper: `rounded-lg` — the floating panel itself is the one element that gets subtle rounding to feel like a window/viewport
- **FilterBar chips**: `rounded-full` — intentional pill shape for toggle chips
- **Loading spinner**: `rounded-full` — circular spinner element

Everything else: **square corners**. This is the defining visual characteristic of Foundry.

---

## Background Effects

Two subtle background overlays reinforce the industrial feel (applied on `body::before` and `body::after`):

1. **Diagonal grid** — 45° crosshatch lines at `0.03` opacity, `40px` spacing. Evokes graph paper / technical blueprints.
2. **Copper vignette** — Radial gradient from top center, accent color at `0.04` opacity. Warm glow suggesting furnace heat.

Both are `position: fixed`, `pointer-events: none`, `z-index: -1`.

---

## Component Patterns

### Card (`components/ui/card.tsx`)

The primary container. Always has the copper left stripe.

| Variant | Classes | When to use |
|---------|---------|-------------|
| `default` | `bg-surface border-l-2 border-l-accent` | Standalone content blocks |
| `bordered` | `bg-surface border border-border border-l-2 border-l-accent` | Cards with rich internal content (ship cards, forms, detail sections) |

Padding: `sm` (p-3), `md` (p-5), `lg` (p-7).

**Sub-components:**
- `CardHeader` — title (`font-display`), optional subtitle, optional action slot
- `CardContent` — plain wrapper div

**For inline list items** (events, missions, battles in a list): use the accent stripe directly on the `<li>` — `bg-surface-hover/40 border-l-2 border-l-accent` — rather than wrapping in a full `Card`.

### Button (`components/ui/button.tsx`)

No rounded corners. Renders `<button>` or `<Link>` depending on `href` prop.

**Focus ring:** All variants share a consistent copper focus ring — `focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background`. Applied in the `tv()` base class.

| Variant | Style | Usage |
|---------|-------|-------|
| `primary` | `bg-accent/90` solid copper with accent border | Primary CTA actions |
| `action` | Tinted background + matching border (instrument panel style) | Contextual actions (Trade, Navigate, Abandon) |
| `outline` | Transparent bg, copper border, copper text | Secondary themed actions — dark bg with accent border |
| `ghost` | Transparent, text only, border on hover | Secondary actions (Details →), overflow items |
| `pill` | Tinted background + matching border (compact) | Icon buttons (map pin), compact actions |
| `dismiss` | Red text, red border on hover | Destructive dismiss actions |

**Action/Pill tinted pattern:** `bg-{color}-500/15 text-{color}-300 border-{color}-500/30` — matches the Badge approach but with borders. Hover intensifies to `bg-{color}-500/25 border-{color}-500/50`.

**Color variants** (used with `action` and `pill`): `green`, `red`, `accent`, `cyan`. No `blue` compound variants currently defined.

Sizes: `xs` (py-1 px-2.5), `sm` (py-1.5 px-3), `md` (py-2 px-4), `lg` (py-2.5 px-4).

### Badge (`components/ui/badge.tsx`)

Tinted background + matching text. No rounded corners. 7 color variants: green, amber, blue, purple, slate, red, cyan.

Pattern: `bg-{color}-500/20 text-{color}-300`.

### ProgressBar (`components/ui/progress-bar.tsx`)

Flat bar with no rounding. Track uses `bg-surface-active`.

| Size | Track height | Label style |
|------|-------------|-------------|
| `sm` | `h-1.5` | `text-[10px] text-text-muted` |
| `md` | `h-2.5` | `text-xs text-text-tertiary` |

Default color: `copper` (accent). Other colors: blue, amber, red, green, purple.

### DetailPanel (`components/ui/detail-panel.tsx`)

Modal overlay panel — the **one element** with `rounded-lg`. Centers over the viewport with a backdrop. Has `border border-border` and `shadow-2xl`.

Sizes: `md` (720px), `lg` (960px), `xl` (1200px). All at 90% viewport height.

Header: title (`font-display font-bold`) + optional subtitle + optional action + close button (X).

### Tabs (`components/ui/tabs.tsx`)

Two variants:
- `underline` — bottom border with accent-colored active indicator. Default.
- `pill` — segmented control style, no rounding.

### SectionHeader (`components/ui/section-header.tsx`)

`font-display font-semibold uppercase tracking-wider` — industrial label style.

### StatRow (`components/ui/stat-row.tsx`)

Key-value display with a dotted border leader between label and value. Wrap in `StatList` for semantic `<dl>` markup. Uses `<dt>`/`<dd>` elements.

### FilterBar (`components/ui/filter-bar.tsx`)

Filter chips use `rounded-full` (pill shape) with accent tint when active. This is the intentional exception to the no-rounding rule.

---

## Icon Sizing

Lucide icons default to 24x24. Size them explicitly for context:

| Context | Size class | Pixels |
|---------|-----------|--------|
| Compact buttons (`xs`/`sm`) | `w-3.5 h-3.5` | 14px |
| Standard buttons (`md`) | `w-4 h-4` | 16px |
| Section icons | `w-4.5 h-4.5` | 18px |
| Panel close button | `w-5 h-5` | 20px |

---

## Anti-Patterns (Don't Do These)

- **No `rounded-lg`/`rounded-md`/`rounded-xl` on cards or containers** — use sharp edges
- **No raw `<div>` styled as cards** — use the `Card` component or the accent stripe classes
- **No `bg-surface` with `rounded-*`** — this combination breaks the Foundry look
- **No raw `<input>` or `<select>`** — use form components from `components/form/`
- **No inline progress bars** — use `ProgressBar` component with appropriate color/size
- **No unsized lucide icons in buttons** — always set explicit `w-*` / `h-*` classes
