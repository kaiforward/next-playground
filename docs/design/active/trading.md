# Trading & Missions

Player-driven buying and selling of goods at station markets, plus auto-generated delivery contracts that create structured trade objectives.

---

## Market Trading

### Buying
- Player selects a good, quantity, and which docked ship to load
- Constraints: sufficient credits, ship has cargo space, station has supply
- On purchase: credits deducted, cargo added to ship, market supply decreases, market demand increases slightly (10% of quantity traded)
- Price is calculated at transaction time from current supply/demand ratio

### Selling
- Player selects a good from ship cargo and quantity to sell
- Constraints: ship has the good in sufficient quantity, ship is docked
- On sale: credits added, cargo removed from ship, market supply increases, market demand decreases slightly (10% of quantity)

### Price Impact
Every trade nudges the market: buying reduces supply and raises demand (prices go up slightly), selling increases supply and reduces demand (prices go down slightly). The 10% demand adjustment means large trades have a noticeable but not overwhelming impact.

### Market Data
Players can view at each system:
- Current price, supply, and demand for all 12 goods
- Recent trade history (last 50 trades — good, price, quantity, buy/sell, player)
- Price history charts from periodic snapshots (up to 1000 ticks of trend data)

---

## Trade Missions

Auto-generated delivery contracts posted at stations. They give players structured objectives with guaranteed rewards on top of the goods' sale value.

### Mission Types

**Import missions** ("We need X, bring it here"):
- Generated when a good's price exceeds 2x its base price at a system
- Source and destination are the same system (player must acquire goods elsewhere and deliver)
- 8% chance per eligible market per generation cycle

**Export missions** ("We have surplus X, deliver to Y"):
- Generated when a good's price drops below 0.5x its base price
- Source is the cheap system, destination is a random system 1-3 hops away
- 8% chance per eligible market per generation cycle

**Event-linked missions**:
- Generated from active events with thematic goods (war → weapons/fuel, plague → medicine/food, etc.)
- Always import missions at the event system
- 1-3 missions per active event
- 1.5x reward bonus
- Cascade-deleted when the triggering event expires

### Reward Formula
```
reward = 3 CR/unit x quantity x 1.25^hops x tierMult x eventMult
```
- Tier multipliers: Tier 0 = 1x, Tier 1 = 4x, Tier 2 = 12x
- Event multiplier: 1.5x if event-linked, 1.0x otherwise
- Minimum reward: 50 CR
- On delivery, player also receives the goods' sale value at current destination prices

### Mission Lifecycle
1. **Generated** every 5 ticks by tick processor
2. **Available** at station mission board (max ~8 per station)
3. **Accepted** by player (max 10 active per player)
4. **Delivered** — player docks at destination with required goods, clicks deliver. Goods sold at destination price + mission reward paid
5. **Expired** — missions past their 300-tick deadline are deleted (player notified if they had accepted it)
6. **Abandoned** — player can return an accepted mission to the available pool

### Delivery Mechanics
- Ship must be docked at the destination system
- Ship must have the required good and quantity in cargo
- On delivery: cargo removed, market supply increases at destination, player receives goods value + reward
- Prices are calculated at delivery time (not accept time) — destination market conditions matter

---

## Gameplay Loops

**Speculative trading**: Monitor prices across systems, buy low, travel, sell high. Pure player-driven arbitrage using market knowledge.

**Mission trading**: Accept missions, acquire goods at source, deliver to destination before deadline. Structured objectives with guaranteed rewards. Less risk, more predictable income.

**Event arbitrage**: Watch for events, pre-position cargo before prices spike, deliver when event missions spawn. Highest skill ceiling — requires understanding event phases and market reactions.

---

## System Interactions

- **Economy**: Trade prices emerge from supply/demand simulation. Player trades nudge markets. Price extremes trigger mission generation (see [economy.md](./economy.md))
- **Events**: Event-linked missions spawn thematic delivery contracts with bonus rewards. Events disrupt markets creating trading opportunities (see [events.md](./events.md))
- **Navigation**: Travel time and fuel costs determine which missions are profitable. Cargo loss on arrival affects delivered quantities (see [navigation.md](./navigation.md))
- **Faction system** (planned): Faction reputation will unlock exclusive missions, affect prices, and enable war contribution missions (see [faction-system.md](../planned/faction-system.md))
