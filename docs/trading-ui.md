# Stream 5: Trading UI, Forms & Charts

## Base UI Components

Reusable components in `components/ui/`, all using `tailwind-variants` for styling variants.

| Component | File | Description |
|---|---|---|
| Card | `card.tsx` | Container with `variant` (default/bordered), `padding` (sm/md/lg). Exports `Card`, `CardHeader`, `CardContent` |
| Badge | `badge.tsx` | Inline pill with `color` variants (green, amber, blue, purple, slate, red) |
| StatDisplay | `stat-display.tsx` | Label + large value with optional trend arrow |
| DataTable | `data-table.tsx` | Generic sortable table with typed columns, optional render functions, row click handlers |

## Trading Components

### Market Table (`components/trade/market-table.tsx`)

Sortable table showing all goods at the current station:
- Columns: Good Name, Base Price, Current Price, Supply, Demand, Trend
- Trend shows green/red percentage change vs base price
- Selected row is highlighted
- Prices formatted with commas + "CR" suffix

### Trade Form (`components/trade/trade-form.tsx`)

Buy/sell form using React Hook Form + Zod:
- Buy/Sell tab toggle
- Quantity input with contextual max display
- Real-time total cost/revenue preview
- Validation: credits, cargo space, supply (buy) or owned quantity (sell)
- Coloured submit button (green for buy, red for sell)

### Price Chart (`components/trade/price-chart.tsx`)

Recharts `LineChart` showing snapshot-based price history for the selected good. Displayed at full width below the trade area (same level as Supply/Demand chart). Shows player cargo quantity in the subtitle ("You own X units" / "You own none"). Data comes from `usePriceHistory` hook (periodic snapshots every 20 ticks), not from trade history — so charts populate even with zero player trades. Dark theme, blue trend line, CR-formatted tooltip. Auto-refreshes via SSE `priceSnapshot` event invalidation.

### Supply/Demand Chart (`components/trade/supply-demand-chart.tsx`)

Recharts grouped `BarChart` comparing supply (blue) vs demand (amber) across all goods. Shown at the bottom of the trade page.

## Dashboard Components

### Player Summary (`components/dashboard/player-summary.tsx`)

Card showing credits (via StatDisplay), current system name, and economy type badge.

### Ship Status (`components/dashboard/ship-status.tsx`)

Card with fuel and cargo capacity progress bars. Bars change colour at threshold levels (fuel turns red below 20%, cargo turns red above 80%).

### Cargo List (`components/dashboard/cargo-list.tsx`)

Card listing cargo items with quantities and a progress bar for total cargo used vs max. Shows an empty state when the hold is empty.

## Pages

### Dashboard (`app/(game)/dashboard/page.tsx`)

Fetches fleet data via `useFleet()` hook and universe data via `useUniverse()`. Responsive grid: 1 column mobile, 2 tablet, 3 desktop.

### Market Tab (`app/(game)/system/[systemId]/market/page.tsx`)

Market trading is a tab within the system hub (not a standalone page). Fetches live market data from `/api/game/market/[systemId]`, fleet state, and price history via TanStack Query hooks. Ship selector supports browse-only mode when no ships are docked. On trade:
1. POSTs to `/api/game/ship/[shipId]/trade` (ship-scoped)
2. Invalidates fleet and market queries on success
3. TanStack Query refetches automatically

Price chart and supply/demand chart are full-width below the market table + trade form grid.
