# Trading

Player-driven buying and selling of goods at station markets.

> **⚠ Pivot Phase 1 teardown in progress.** Trade missions were removed in Sweep 1; personal
> trading itself (buy/sell, this doc) is removed in Sweep 2, leaving the market screen as a
> read-only inspection view. See `docs/build-plans/pivot-phase1-teardown.md`.

---

## Market Trading

### Buying
- Player selects a good, quantity, and which docked ship to load
- Constraints: sufficient credits, ship has cargo space, station has stock above its floor (max buyable = `floor(stock − MIN)`)
- On purchase: credits deducted, cargo added to ship, market stock decreases by the quantity bought
- Price is calculated at transaction time from the good's stock, with intra-trade slippage (each unit priced along the curve it moves) and a bid-ask spread

### Selling
- Player selects a good from ship cargo and quantity to sell
- Constraints: ship has the good in sufficient quantity, ship is docked, station has headroom below its ceiling (max sellable = `floor(MAX − stock)`)
- On sale: credits added, cargo removed from ship, market stock increases by the quantity sold

### Price Impact
Every trade moves the single stock value: buying lowers stock (price rises), selling raises stock (price falls). Because each unit is priced at the midpoint of the stock step it causes (slippage), large trades pay progressively worse prices — and a buy followed by an immediate sell-back walks the same curve back and loses the bid-ask spread, so same-station round-trips never profit.

### Market Data
Players can view at each system:
- Current price and in-stock level for all 26 goods (with buy/sell quotes)
- Recent trade history (last 50 trades — good, price, quantity, buy/sell, player)
- Price history charts from periodic snapshots (up to 1000 ticks of trend data)

---

## Trade UX

Quality-of-life surfaces that support the buy / sell / compare loop:

- **Integer quantities** — stock and the derived trade limits (max buyable = `floor(stock − MIN)`, max sellable = `floor(MAX − stock)`) are floored for both display and trade validation, so the number shown is exactly the maximum you can act on (flooring never overstates what's available; the underlying economy math stays fractional).
- **System detail panel** — selecting a system on the map opens a hub: status (economy / gateway / danger / region / faction), one-click shortcuts to that system's Market / Ships tabs, an active-event banner, and cards for docked ships and convoys with inline **Navigate** (enters map nav-mode for that unit) and **Trade** actions.
- **Cross-system price comparison** — answers "where is good X cheapest / most expensive" across the systems you can see, via two surfaces fed by one by-good lookup:
  - **Price heatmap overlay** tints visible systems by `currentPrice / basePrice` along a green → amber → red ramp (deep bargain to buy → neutral → premium to sell).
  - **Comparison panel** is a sortable table of price, in-stock level, and jump distance from the system you're viewing, with Buy / Sell / All filters and a jump-to action.

---

## Gameplay Loops

**Speculative trading**: Monitor prices across systems, buy low, travel, sell high. Pure player-driven arbitrage using market knowledge.

**Event arbitrage**: Watch for events, pre-position cargo before prices spike, sell into the shortage. Requires understanding event phases and market reactions.

---

## System Interactions

- **Economy**: Trade prices emerge from the single-stock market simulation. Player trades nudge markets (see [economy.md](./economy.md))
- **Events**: Events disrupt markets creating trading opportunities (see [events.md](./events.md))
- **Navigation**: Travel time and fuel costs determine which routes are profitable (see [navigation.md](./navigation.md))
