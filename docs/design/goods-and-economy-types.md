# Goods & Economy Types — Scale Discussion

Before implementing economy balance changes, we need to decide on the right number of goods and economy types. This is foundational — every other balance lever (price clamps, equilibrium targets, events) depends on what goods exist and how economy types interact with them.

## Current State

**6 goods** across 4 categories:

| Good | Base Price | Category |
|------|-----------|----------|
| food | 20 | consumable |
| ore | 30 | raw |
| fuel | 40 | raw |
| electronics | 80 | manufactured |
| ship_parts | 100 | manufactured |
| luxuries | 150 | luxury |

**5 economy types** with this production/consumption web:

| Economy Type | Produces | Consumes |
|---|---|---|
| agricultural | food | electronics |
| mining | ore | food |
| industrial | fuel, ship_parts | ore |
| tech | electronics | ore, ship_parts |
| core | luxuries | food, ore, fuel, electronics, ship_parts |

**Problem:** Simulator data shows ship_parts and electronics account for 95-100% of profit. food, ore, and fuel are never traded by smart strategies. luxuries contribute <1%. The production/consumption web funnels all value through industrial and tech systems.

## Performance Constraints

The ceiling on goods count is the economy processor — it updates every MarketEntry (one per system per good) every tick via individual Prisma updates inside a transaction.

| Goods | Market rows (~200 systems) | Updates/tick | Assessment |
|-------|---------------------------|-------------|------------|
| 6 | 1,200 | 1,200 | Current — works fine |
| 8 | 1,600 | 1,600 | Fine |
| 10 | 2,000 | 2,000 | Fine |
| 12 | 2,400 | 2,400 | Probably fine, ~2x current |
| 15+ | 3,000+ | 3,000+ | Needs batch SQL (PostgreSQL migration) |

Economy types have zero performance overhead — they're just a classification that determines which goods a system produces/consumes.

## Research: Browser-Based Trading Games

### Space Trader (Classic) — 10 goods

The closest analog to Stellar Trader. No supply chains, events as the primary market driver.

- **Goods:** Water, Furs, Food, Ore, Games, Firearms, Medicine, Machinery, Narcotics, Robots
- **Split:** 4 natural resources (cheap in low-tech) + 6 industrial goods (cheap in high-tech)
- **What keeps goods relevant:** Tech-level gradient between systems, special events (droughts spike water, wars spike firearms, plagues boost medicine), government types affecting legality, special planetary resources
- **Takeaway:** 10 goods with strong contextual modifiers (events, system properties) create plenty of trading decisions without production chains

### Pardus — ~31 goods

Browser-based space trading MMO with tiered production chains.

- **Tiers:** Tier 0 (food, water, energy) → Tier 2 (ore, gas, chemicals) → Tier 3 (metals, fuel, medicines) → Tier 4 (electronics, weapons, robots) → Tier 5 (drugs, droid modules)
- **What keeps goods relevant:** Tiered production chains (higher goods require lower inputs), building upkeep creates constant demand for basics, illegal goods add risk/reward, regional scarcity from fixed building locations
- **Takeaway:** 30+ goods works when production chains create mandatory demand at every tier. Without chains, extra goods are just "more things with different prices"

### Prosperous Universe — ~550 materials

Deep economy sim, fully player-driven production.

- **35 categories** from agriculture to aerospace
- **What keeps goods relevant:** Every item must be produced by real players, planet-specific raw materials, local commodity exchanges with separate order books, worker upkeep consumes basics perpetually
- **Takeaway:** This scale requires production chains 5-7 levels deep and player-only production. Way beyond our scope but validates that local markets + geographic specialization work

### Sim Companies — ~145 products

Idle-style browser economy game.

- **9 industries** from agriculture to aerospace
- **What keeps goods relevant:** Deep supply chains (5-6 levels), retail demand system, quality tiers, research gates for progression
- **Takeaway:** Even at 145 products, the game organizes into clear industry chains. Without chains, players would ignore 90% of products

### SpaceTraders (API Game) — ~50-60 trade goods

API-driven game where players write bots to trade.

- **What keeps goods relevant:** Export/import/exchange classification per location (exports are cheap, imports are expensive), market discovery (must visit to see prices), ore-to-refined pipeline
- **Takeaway:** Export/import classification is similar to our produces/consumes model. Their ~50 goods work because players write bots — a manual UI would struggle at that count

### Summary Table

| Game | Goods | Supply Chains | What Makes It Work |
|------|-------|--------------|-------------------|
| Space Trader | 10 | None | Events + tech-level gradient |
| Pardus | ~31 | 4-5 tiers | Tiered production + building upkeep |
| SpaceTraders | ~50-60 | Shallow | Export/import + market discovery |
| Sim Companies | ~145 | Deep (5-6) | Retail demand + quality + research |
| Prosperous Universe | ~550 | Very deep | Player-only production + local exchanges |

**Key insight:** Without production chains, the practical ceiling for meaningful goods is ~10-15. Games with 30+ goods all rely on chains where higher-tier goods consume lower-tier inputs, creating mandatory demand at every level. Production chains are in our future backlog ([simulation-enhancements.md](./simulation-enhancements.md)) but not near-term.

## Recommendation: 10 Goods

Expand from 6 to 10. Rationale:

1. **Validated by Space Trader** — same genre (real-time trading, events, no supply chains), proved 10 goods creates engaging decisions
2. **Enough for economy type differentiation** — each type gets 2-3 signature produces/consumes instead of the current 1-2
3. **Room for more economy types** — 10 goods supports 6-8 distinct economy types without overlap
4. **Market table stays scannable** — players can read 10 rows at a glance, make quick decisions
5. **Well within performance ceiling** — 2,000 market entries/tick, no architectural changes needed
6. **Future-proof for supply chains** — when/if we add production recipes later, 10 goods provides a natural tiered structure (raw → processed → advanced)

### What the 4 new goods should do

The 4 new goods need to fill gaps in the current economy web:

- **Give cheap/raw economy types (agricultural, mining) their own high-value trades** — currently these systems are only visited to sell expensive goods, never as profitable sources
- **Create cross-cutting demand** — goods that multiple economy types want, so more systems become worthwhile destinations
- **Give luxuries competition** — another high-value good that has actual consumers, breaking the stagnation
- **Create at least one good where core systems are a *source*, not just a sink** — currently core consumes everything, making it a universal destination but never an origin

### Open questions for next session

1. **What should the 4 new goods be?** Need to fit the space trading theme and fill the gaps above. Some candidates: medicine/medical supplies, weapons/armaments, textiles/clothing, water, research data, refined metals, polymers/plastics, narcotics/contraband.

2. **Should we add economy types at the same time?** Currently 5 types. With 10 goods, 6-7 types would give better coverage. Candidates: military/defense, medical/research, refinery/processing.

3. **How should the production/consumption web look?** The core problem is that the current web funnels all value through industrial + tech. The new web needs more edges — more producer-consumer pairs so profit isn't concentrated on 2 goods.

4. **Should any goods be illegal/contraband?** Space Trader and Pardus both use this as a relevance mechanism — higher profit but with risk. We already have the danger system which could enforce this.

5. **Should we change existing goods?** e.g. split "electronics" into basic and advanced, or rename goods to better fit an expanded set.

## Notes

- This doc captures a discussion in progress. The goods list and economy web are not finalized.
- Any goods/economy type changes affect: `lib/constants/goods.ts`, `lib/constants/universe.ts`, `lib/constants/economy.ts`, `prisma/seed.ts`, `lib/engine/simulator/world.ts`, and the economy balance proposals in [economy-balance.md](./economy-balance.md).
- The simulator can validate any proposed configuration before we touch the real game. Run experiments with different goods/economy setups via YAML configs.
- Economy type changes are free from a performance perspective — it's purely a classification change.
