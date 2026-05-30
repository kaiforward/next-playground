# Faction System Design

Core political and territorial layer for multiplayer gameplay. Factions are named entities that control territory, wage wars, and give players a reason to trade beyond profit.

**Inspiration**: Mount & Blade (territory control, multi-front wars, faction politics), Elite Dangerous (named factions, reputation), Planetside 2 (endless conflict cycle).

**Design principle**: Factions create the *demand* for player activity. Players don't just trade to get rich — they trade to fund wars, shift borders, and reshape the political map.

**Scalability**: The system is designed to support many more factions and systems than the initial launch roster. The faction model, war mechanics, and territory systems must all scale cleanly. The initial 8 major factions and current system count are a starting point — the architecture should support 15+ major factions and 10K+ systems without redesign (the 10K-scale preset is already wired into world-gen and the relations processor; status thresholds are share-based so they scale automatically).

---

## Implementation Status

Foundation (Layer 2, Sub-Project 1) is implemented and merged. Below is the per-section status at a glance; details inline in each section. The full plan that shipped is in [layer-2-faction-foundation.md](../../archive/layer-2-faction-foundation.md).

| Section | Status | Notes |
|---|---|---|
| §1 Faction Model — core, doctrines, governments | **Implemented** | Status thresholds reconciled to share-based (see §1). Military output planned (War). |
| §2 Inter-Faction Relations — score, drift, tiers | **Implemented (subset of drivers)** | Border friction, doctrine, government, common enemy, alliance, trade, baseline all live. Resource/territory envy, historical grievance, player-action drivers, trade competition planned. |
| §2.1 Alliance Mechanics — formation/dissolution | **Partially implemented** | Event-gated formation + dissolution shipped. Alliance capacity (slots), mutual defense, shared trade bonuses planned (War). |
| §3 Player-Faction Reputation | **Implemented (trade only)** | Per-player score, 5 tiers, buy/sell multipliers, hostile denial all live. Faction missions, war contributions, contraband effects planned. |
| §4 War and Conflict | **Border conflicts only** | `border_conflict` events fire from the relations processor. Full war mechanics planned (War sub-project). |
| §5 Homeworlds | **Partially implemented** | Homeworlds exist, selected by trait quality, used as flood-fill seeds. Defense bonuses, unique facilities, conquest planned (War / Facilities). |
| §6 Initial Faction Roster | **Implemented** | 8 majors per the table below. Relations seeded at 0 and drifted by the processor (not pre-seeded with doctrine/government nudges). |
| §7 Minor Factions | **Implemented (soft constraints)** | 12 minors at default scale, 18 at 10k. Archetype placement biases shipped. Hard constraint enforcement (no-borders-more-than-2-majors etc.) is best-effort, not guaranteed. Faction spawning events planned. |
| §8 System Scale + Map Structure | **Implemented (different scales)** | 600 systems (default) / 10K (10k). LOD-based zoom + map-mode toggle, no separate region page. |

---

## 1. Faction Model

Factions are hand-crafted named entities with distinct identity and behavior.

**Status: Implemented** — model lives in `prisma/schema.prisma` (`Faction`), summary derivation in `lib/services/factions.ts`.

### Core Properties

| Property | Type | Description |
|---|---|---|
| name | string | Unique faction name (e.g. "Terran Sovereignty") |
| description | text | Lore, personality, background |
| government | GovernmentType | Economic identity — drives market behavior, internal modifiers |
| doctrine | Doctrine | Political identity — drives foreign policy and war behavior |
| homeworld | system_id | Capital system. Very hard to capture (see [war-system.md](../../planned/war-system.md) §5) |
| territory | [system_ids] | Derived from systems that have `factionId` |
| color | string | Map/UI color for territory visualization |

Implementation note: there is also a `createdAtTick` field on the `Faction` row, populated at seed time (0) and used by any future faction-spawning event to record when a new faction came into being.

### Faction Status (Derived, Not Stored)

Status is a function of a faction's *share* of total factioned systems, with hysteresis to prevent flickering at boundaries. Implementation: `deriveFactionStatus()` in `lib/types/guards.ts`.

| Status | Gain threshold | Lose threshold | At default 600-system scale | At 10K scale |
|---|---|---|---|---|
| Dominant | ≥ 13.3% | < 10% | 80 systems / 60 | 1,330 / 1,000 |
| Major | ≥ 6.6% | < 4.1% | 40 / 25 | 660 / 410 |
| Regional | ≥ 2.5% | < 1.6% | 15 / 10 | 250 / 160 |
| Minor | > 0 systems | 0 (destroyed/exiled) | any positive | any positive |

Share-based thresholds are scale-independent — a 90-system faction is "regional" at default scale (15% share, hits Dominant) but "minor" at 10K (0.9% share, below Regional). At default scale these reproduce the original absolute targets (80/40/15) within rounding.

Status determines:
- Economic bonuses (larger factions have stronger economies but more to defend)
- Defensive bonuses (minor factions are harder to conquer per-system)
- War capacity (how many fronts a faction can sustain)
- Player mission availability and rewards

> **Planned (War / Facilities):** the *effects* of status (economic bonuses, defense, war capacity, mission availability) are not yet wired up. Today the derived status is exposed in the UI (faction list, detail page, relations matrix) and is read for alliance-slot logic in §2.1 once that ships.

### Military Output (Derived)

> **Planned (War sub-project):** military output is not implemented. The relations processor and economy processor don't compute or consume it. Below is the design intent.

Military output is the faction's per-tick capacity for projecting military force. It's the resource that the [War System](../../planned/war-system.md) consumes for fleet battles, sieges, and multi-front wars. Not stored directly — derived each tick from faction state:

- **Territory size**: More systems = more production capacity. The primary driver.
- **Economic output**: Systems with higher population (see [Production §2](../../planned/production.md)) and better production traits contribute more. An industrial hub with tier-3 lagrange stations contributes more military output than a marginal frontier system.
- **Government modifier**: Militarist governments have higher military output per system. Corporate governments have lower (they invest in trade, not fleets).
- **War disruption**: Systems in active war zones have reduced economic output, which reduces their military contribution. Prolonged wars degrade a faction's total military output.
- **Player contributions**: Player-produced tier 3 military assets (see [Production Roster §5](../../planned/production-roster.md)) add to faction military output. This is how player production meaningfully affects wars.

The exact formula is an implementation detail, but the principle is: military output scales with territory quality, not just territory size. A faction with 30 well-developed systems can match one with 50 marginal frontier systems.

### Doctrine Types

Doctrine defines how a faction behaves toward other factions. Each faction has one primary doctrine.

**Status: Implemented (narrow behavioral surface).** `DOCTRINES` definitions in `lib/constants/doctrines.ts`; doctrine-pair compatibility in `lib/constants/relations.ts` (`DOCTRINE_COMPATIBILITY`); doctrine-rank tiebreak in `lib/engine/faction-gen.ts` (drives contested-system flood-fill).

**Key design rule**: All factions are warlike. The aggression spread between doctrines is narrow — the difference is what *triggers* conflict and how they fight, not whether they fight. Even the most defensive doctrine will wage war under the right conditions. War exhaustion and attacker cost asymmetry (see [war-system.md](../../planned/war-system.md) §3) keep aggressive doctrines from steamrolling reactive ones.

| Doctrine | War trigger | Strengths | Deterrent |
|---|---|---|---|
| Expansionist | "Give us any reason." Most likely to declare war (by a small margin). Looks for justifications to push borders | Fast system capture, strong offense | "Hit us and we'll hit you twice as hard" |
| Protectionist | Rarely starts wars, but responds with overwhelming force. Aggressive reclamation of lost territory | Very strong defense, reclamation bonuses | "Take our systems and you'll never stop fighting to hold them" |
| Mercantile | Fights when trade is threatened. Uses economic warfare as primary tool, military as backup | Trade embargoes, funds allied wars, strong economy | "Attack us and we'll bankrupt you and fund your enemies" |
| Hegemonic | Pressures weaker neighbors into submission. Avoids wars with equal powers, bullies smaller ones | Strong vs minor factions, vassal mechanics | "Submit or be conquered. Challenge us at your peril" |
| Opportunistic | Strikes when others are distracted or weakened. Targets factions already at war | Bonuses when attacking war-weakened factions | "Show weakness and we'll be there" |

What's wired up today:
- Doctrine pair compatibility (small per-tick drift on every relation pair). Roughly: protectionist–protectionist mutual respect (+0.03), expansionist–protectionist textbook clash (-0.06), hegemonic clashes with most things, mercantile is broadly neutral-positive. See `DOCTRINE_COMPATIBILITY`.
- Doctrine rank tiebreak for contested systems at world-gen time — expansionist > opportunistic > hegemonic > mercantile > protectionist when two factions reach the same system in equal hops.
- `declarationModifier` field on each `DoctrineDefinition` — Foundation reads it to bias the alliance-negotiation outcome (higher = harder to ally).
- `exhaustionMultiplier` field on each `DoctrineDefinition` — stub for War.

> **Planned (War sub-project):** doctrine-specific war trigger logic ("fights when trade is threatened", "strikes when others are weakened"), reclamation bonuses, trade-embargo behavior, vassal mechanics. These need the war/exhaustion model to land first.

### Government Types

Government type is strictly an **economic/internal** axis. It defines how a faction runs its own territory — market behavior, production modifiers, trade regulations, internal stability. It says nothing about foreign policy (that's doctrine's job).

Two factions can share a government type and still be bitter enemies. A federation and another federation may both be democratic internally but have completely opposing doctrines and interests.

**Status: Implemented.** All 8 government types live in `GOVERNMENT_TYPES` (`lib/constants/government.ts`) with concrete starting values. The economy processor reads `governmentType` per-market (sourced from `system.faction.governmentType`).

**Design rule**: Every government type has trade-offs — buffs balanced by debuffs. No type is strictly better or worse, just different. Players should want to trade at different government types depending on their cargo, risk tolerance, and strategy.

8 government types (expanded from the original 4 in [economy.md](./economy.md)):

| Government | Economic identity | Player trade-off | Restrictions |
|---|---|---|---|
| Federation | Balanced, regulated, stable | Reliable profits, no surprises. The safe middle ground | Moderate — some contraband enforced |
| Corporate | Pro-trade, low regulation, profit-maximizing | Best margins but volatile. Boom or bust cycles | Very few — almost anything profitable goes |
| Authoritarian | State-controlled, price-fixed, rigid | Safest space, predictable demand. But most restricted — government controls what flows in and out | Heavy — strategic goods controlled, narrow allowed list |
| Frontier | Lawless, unregulated, dangerous | Highest potential profit, highest risk. Wild price swings, smuggler's paradise | None — no one's enforcing anything |
| Cooperative | Worker-owned, egalitarian, community-focused | Rock-solid consistency, never go broke. But low margins, luxury goods undervalued | Moderate — luxury goods taxed/restricted |
| Technocratic | Innovation-driven, high-tier specialization | Premium prices on advanced goods. Bad market for raw materials | Low — open to most trade, basics undervalued |
| Militarist | War economy, resource-hungry, mobilized | Starving for raw materials and weapons. Great during wartime, mediocre during peace | Moderate — strategic goods controlled |
| Theocratic | Ideological, community-driven, insular | Pays premium for basic/cheap goods. But heavy restrictions on "immoral" goods — limited selection | Heavy — narcotics, weapons, luxury goods banned |

Concrete economic modifiers per government type. These are the live shipped values from `GOVERNMENT_TYPES`.

| Government | Volatility | Eq. Spread | Danger | Contraband | Tax / Inspection | Consumption boost |
|---|---|---|---|---|---|---|
| Federation | 0.8× | -10% | 0.00 | weapons | 12% / 1.2× | medicine |
| Corporate | 0.9× | -5% | 0.02 | — | 10% / 0.8× | luxuries |
| Authoritarian | 0.7× | -15% | 0.00 | weapons, chemicals | 15% / 1.5× | weapons, fuel |
| Frontier | 1.5× | +20% | 0.10 | — | 0% / 0.0× | — |
| Cooperative | 0.7× | -10% | 0.00 | luxuries | 10% / 1.0× | food, medicine |
| Technocratic | 1.0× | +5% | 0.01 | — | 8% / 0.6× | electronics |
| Militarist | 1.3× | +10% | 0.05 | — | 10% / 1.3× | weapons, fuel, machinery |
| Theocratic | 0.8× | -5% | 0.03 | weapons, chemicals, luxuries | 10% / 1.4× | food, medicine, textiles |

> **Planned (tuning pass):** the original design called for per-tier nuance in equilibrium spread — e.g. Technocratic should be wide for tier-2 goods but narrow for tier-0 basics; Theocratic narrow for basics and wide for restricted. Today every government applies a single flat `equilibriumSpreadPct` to all goods. The `goodCategoryModifiers?` field is declared on `GovernmentDefinition` for the follow-up tuning pass, but unused.

---

## 2. Inter-Faction Relations

Numeric score between each pair of factions. Relations are the engine that drives the political simulation — they determine when wars start, when alliances form, and how factions behave toward each other.

**Status: Implemented.** Per-pair score lives in `FactionRelation` (canonical `factionAId < factionBId`); drift logic in `lib/engine/relations.ts`; processor in `lib/tick/processors/relations.ts`, registered with `dependsOn: ["events"]` and `frequency: 3` (runs every third game tick).

**Core design rule**: Relations tend to drift negative over time. Conflict is the default state; peace requires active maintenance. This ensures the game always has wars happening somewhere, creating demand for player involvement. Implemented as a constant `baselineBias: -0.05` per drift tick (every 3 game ticks).

### Relations Score

- **Range**: -100 (hostile) to +100 (allied), clamped on every drift application.
- Stored per faction pair (one row per unordered pair; adapter enforces ordering).
- Drifts per relations tick (every 3 game ticks) based on accumulated positive and negative drivers.
- Each pair also keeps a short ring buffer of the last 10 drift entries (`historyJson`) for debugging and UI surfacing.

### Negative Relation Drivers

These push factions toward conflict. Most are persistent and cumulative — they stack and compound. A single driver drifts relations slowly; multiple drivers together accelerate toward war.

| Driver | Status | Magnitude (per drift tick) | Mechanic |
|---|---|---|---|
| Baseline bias | **Implemented** | -0.05 | "Conflict is the default; peace needs maintenance." Applied to every pair, every drift tick |
| Border friction | **Implemented** | -0.02 × shared border count | Number of cross-faction jump-lanes between owned systems |
| Doctrine incompatibility | **Implemented** | -0.01 to -0.06 | Per `DOCTRINE_COMPATIBILITY` table — expansionist↔protectionist is the worst pair at -0.06 |
| Government opposition | **Implemented (sparse)** | -0.03 to -0.04 | Federation↔Authoritarian (-0.04), Authoritarian↔Cooperative (-0.03), Corporate↔Cooperative (-0.03), Militarist↔Theocratic (-0.03). All other government pairs contribute 0 |
| Alliance with enemy | **Implemented** | -0.05 × count | "My enemy's friend is my enemy." Counted per third-party where A is allied to X and X is hostile to B (or symmetric) |
| Resource envy | *Planned* | — | Weaker-economy faction resents richer neighbor; driven by GDP/production gap |
| Territory envy | *Planned* | — | Smaller faction looking at larger neighbor's territory; scales with size disparity |
| Historical grievance | *Planned (War)* | — | Lost territory in a previous war — needs the war system to produce the underlying record |
| Player actions (hostile) | *Planned* | — | Mass smuggling in faction space, hostile player behavior aggregated |
| Trade competition | *Planned* | — | Two mercantile factions competing for the same routes |

**Example compound scenario (today's drivers)**: The Kessari Dominion (expansionist, authoritarian) shares a long border with the Terran Sovereignty (protectionist, federation). Per-drift-tick contributions: baseline -0.05, border -0.02×N (for N shared lanes), doctrine -0.06 (expansionist vs protectionist), government -0.04 (authoritarian vs federation). With 5 shared border lanes that's -0.25/tick — visible negative drift, war zone in a few hundred ticks.

### Positive Relation Drivers

These push factions toward cooperation. Generally weaker than negative drivers — peace takes more effort than conflict.

| Driver | Status | Magnitude (per drift tick) | Mechanic |
|---|---|---|---|
| Common enemy | **Implemented** | +0.08 × count | "My enemy's enemy is my friend." Counted per third-party where both A and B have score < -25 with X |
| Trade volume | **Implemented** | +0.0002 × units traded since last drift tick, capped at +0.5 | Cumulative trade between systems on each side of the pair |
| Doctrine compatibility | **Implemented** | +0.01 to +0.03 | Per `DOCTRINE_COMPATIBILITY` — protectionist↔protectionist (+0.03), mercantile↔mercantile (+0.02), small positives between trade-aligned pairs |
| Active alliance | **Implemented** | +0.15 | Maintenance drift while an `AlliancePact` is active |
| Distance | *Planned* | — | Far-apart factions with no shared border drift toward neutral rather than hostile (today they still get baseline-bias drift) |
| Post-war recovery | *Planned (War)* | — | Needs the war system to produce the underlying ceasefire/end-of-war signal |
| Player actions (friendly) | *Planned* | — | Peaceful trading, cooperative missions, contributions to faction prosperity |

### Relations Thresholds

| Range | Status | Effects |
|---|---|---|
| +75 to +100 | Allied | Active `AlliancePact`. Positive maintenance drift (+0.15/tick). Mutual defense / shared trade bonuses *planned* (War) |
| +25 to +74 | Friendly | No tension. Alliance negotiation possible. Trade bonuses *planned* |
| -24 to +24 | Neutral | Normal trade. Background drift from baseline + driver mix |
| -74 to -25 | Unfriendly | `border_conflict` events spawn (one per pair at a time) — danger and production penalties on a representative shared-border system. Trade penalties *planned* |
| -100 to -75 | Hostile | War declaration zone. Today: border conflicts continue. Wars and embargoes *planned* (War) |

Tier resolution lives in `getRelationTier()`. Note the implementation matches the highest-min-first ordering — half-integer scores from the Float column fall into the lower tier cleanly.

### 2.1 Alliance Mechanics

Alliances are formal pacts between factions. Foundation ships the formation/dissolution lifecycle; the gameplay *consequences* (capacity limits, mutual defense, shared trade) are deferred to later sub-projects.

**Status: Partially implemented.** `AlliancePact` table + relations-processor lifecycle shipped (`lib/constants/relations.ts` `ALLIANCE` constants).

#### Formation & Dissolution Lifecycle (Implemented)

Alliances are not formed instantly when a pair crosses a threshold — they go through a telegraph window so players (and future negotiation-influence missions) can react.

- **Negotiation trigger**: When a pair's score crosses +75, the processor spawns a `pact_under_negotiation` event for that pair with a 5–10 tick window.
- **Confirmation**: When the window closes, the pair's score must still be ≥ +60 for the `AlliancePact` to form. Otherwise the negotiation event simply expires.
- **Influence hook**: `pendingAllianceInfluence` is a typed hook that future War-sub-project diplomatic missions can populate to nudge negotiation outcomes. No-op in Foundation.
- **Dissolution trigger**: When an active pact's pair drops below +50, the processor spawns an `alliance_dissolved` event with a 5-tick window. When the window closes, the pact is removed.
- **Constants**: `ALLIANCE.negotiationThreshold` (75), `holdThreshold` (60), `dissolutionThreshold` (50), `negotiationWindow` ([5, 10]), `dissolutionWindow` (5).

#### Alliance Capacity (Inversely Scales with Size)

> **Planned:** capacity limits are not enforced today. Any two factions whose relations stay above +60 through a negotiation window can ally, regardless of how many existing pacts each faction has.

| Faction Status | Alliance Slots | Rationale |
|---|---|---|
| Minor | 3 | Survival through coalition. Multiple small factions can collectively resist a major power |
| Regional | 2 | Strategic partnerships. Room for meaningful choices about who to ally with |
| Major | 1 | One ally maximum. Must choose carefully — allying with one power alienates others |
| Dominant | 0 | Too large to formally ally. Lonely at the top. Must rely on own strength |

The design intent is that as a faction grows, it loses alliance slots — creating natural balancing pressure. A cluster of allied minors can collectively match a major power, enabling David-vs-Goliath stories.

#### Alliance Effects

- Mutual defense (if one ally is attacked, the other is expected to join as co-defender): **planned (War)**. See [war-system.md](../../planned/war-system.md) §11.
- Shared trade bonuses between allied faction territories: **planned**.
- Positive relation drift while alliance is active: **implemented** (+0.15/tick via `alliancePresent`).

#### Alliance Conditions (Today)

- Forms when relations hold at ≥ +60 through the negotiation window (event-gated, see lifecycle above).
- Dissolves when relations drop below +50 (event-gated dissolution warning, then pact removal).
- One ally attacking a faction the other is friendly with (forced choice): **planned** (no attacking exists yet).
- One ally refusing a mutual defense call (alliance dissolves, reputation penalty): **planned (War)**.

---

## 3. Player-Faction Reputation

Per-player, per-faction reputation score.

**Status: Implemented (trade only).** `PlayerFactionReputation` table; tiers/multipliers in `lib/constants/reputation.ts`; service in `lib/services/reputation.ts`; integration in `lib/services/trade.ts` and `lib/services/convoy-trade.ts`. New players are bootstrapped with a 0-score row for every faction at registration time (single transaction in `app/api/register/route.ts`).

### Reputation Score

- **Range**: -100 to +100, stored per (player, faction).
- **Earned through**:
  - **Trading at faction systems** (implemented): +0.5 per successful trade against a faction-owned market, capped at +2.0 per (player, faction, tick) to prevent grind-spam.
  - **Completing faction missions** (planned — no faction missions exist yet).
  - **Contributing to war efforts** (planned — War sub-project).
- **Lost through** (all planned):
  - Supporting enemy factions in wars
  - Trading contraband in faction space (contraband pipeline lives in `GOVERNMENT_TYPES`; player-side seizure flow planned)
  - Attacking faction ships (future tactical layer)

### Forced Trade-Offs

> **Planned:** the "supporting faction A costs reputation with B" mechanic requires the war contribution system. Today reputation only moves up (via trade), and only with the directly-traded-with faction.

The design intent: players cannot be friends with everyone — they must pick sides. This creates factional identity and player communities. A **neutral trader** path is viable but limited: tolerated everywhere, welcomed nowhere. No access to the best prices, exclusive missions, or faction facilities.

### Reputation Effects

| Range | Standing | Buy multiplier | Sell multiplier | Other effects |
|---|---|---|---|---|
| +75 to +100 | Champion | ×0.92 | ×1.08 | Exclusive missions, political influence — *planned* |
| +25 to +74 | Trusted | ×0.96 | ×1.04 | Faction missions — *planned* |
| -24 to +24 | Neutral | ×1.00 | ×1.00 | Standard. Basic missions only |
| -74 to -25 | Distrusted | ×1.08 | ×0.92 | Limited services — *planned* |
| -100 to -75 | Hostile | denied | denied | Trade denied entirely. Denied docking / actively hunted — *planned* |

Multiplier values are tuning numbers — live in `REPUTATION_TIERS` as a single constant; the simulator tunes from there. Hostile standing is enforced inside the trade transaction via `accrueTradeReputationInTx`, which re-reads the fresh row to gate-check (TOCTOU-safe).

### Price Modifier Mechanism

Reputation affects trade prices as a **transaction multiplier** — it modifies what the player pays/receives, not the displayed market price. Market prices remain universal (driven by each good's stock), so all players see the same price information. Reputation is your personal competitive edge.

- **Buying**: `market_price × buy_multiplier` — higher reputation = lower multiplier = cheaper purchases
- **Selling**: `market_price × sell_multiplier` — higher reputation = higher multiplier = more profit

**Stacking with government modifiers**: Government modifiers (volatility, equilibrium spread, production rates) shape the *market itself* — what the price is. Reputation modifies the *transaction* — what you pay for that price. Different layers, naturally stack without conflict. A Champion trader at a Corporate system gets both the Corporate market characteristics and their personal reputation discount.

---

## 4. War and Conflict

Full war and conflict mechanics are covered in the dedicated **[War System](../../planned/war-system.md)** spec.

**Status: Border conflicts implemented. Full wars planned.**

### Border Conflicts (Implemented)

Border conflicts are ambient, low-stakes friction events that fire when a faction pair enters the unfriendly band. They are owned by the relations processor at spawn time but live inside the regular event lifecycle once created.

- **Trigger**: When a pair's score transitions from > -25 to ≤ -25 (entering Unfriendly), the relations processor spawns one `border_conflict` event for that pair, targeted at a representative shared-border system. Only one active border-conflict per pair at any time — a new one can only spawn after the previous one resolves *and* the pair re-enters the unfriendly band.
- **Three phases** (`lib/constants/events.ts` → `borderConflict`):
  - **Tension** (15–25 ticks): danger +0.05 on the target system.
  - **Skirmish** (25–35 ticks): danger +0.10, production rate ×0.9 on the target system.
  - **De-escalation** (10–20 ticks): danger +0.02.
- **No player notifications** — border conflicts surface on the political map, not in player feeds.
- **Replaces the old `war: N` government event-weight stubs** — the previous government definitions referenced a `"war"` event that was never actually defined; those dead weights were removed during Foundation. Border conflicts now provide the war-themed economy/danger pressure those weights were meant to gesture at.

### Full Wars (Planned)

> **Planned (War sub-project):**
>
> - **Faction wars** (interactive): full wars with two dedicated processors — war processor (strategic: declarations, exhaustion, ceasefire) and battle processor (tactical: fleet battles, sieges). Two-stage conquest model: fleet battles establish space superiority, sieges capture systems. Assault capacity limits simultaneous sieges. Conquest limits prevent faction destruction in a single war.
> - **Economy effects**: war modifiers feed into the existing economy processor — production penalties, war goods demand spikes, volatility increases. Attacker pays economy-wide; defender only on the front line.
> - **Alliance in war**: co-defenders contribute military output at reduced exhaustion cost. Can withdraw if overextended. See alliance mechanics §2.1 and [war-system.md](../../planned/war-system.md) §11.

Relations (§2) drive both layers — negative drift pushes factions through border conflicts into full wars. Doctrine (§1) influences declaration thresholds and war behavior.

---

## 5. Homeworlds

Every faction has a homeworld — their capital system.

**Status: Implemented (selection + storage only).** Selected during world-gen by `selectHomeworld()` in `lib/engine/faction-gen.ts` (highest aggregate trait quality in the faction's anchor region, with core/industrial/tech economy bias). Stored as `Faction.homeworldId` (unique FK to `StarSystem`).

### Homeworld Properties

- **Stored and selectable**: homeworlds exist, are unique per faction, and serve as flood-fill seeds for territory assignment.
- **Economic hub** (partial — emergent only): because homeworlds are selected by trait quality, they tend to be the richest systems in their region. There is no explicit "homeworld bonus" applied on top.

> **Planned (War / Facilities):** homeworld defense bonuses, unique faction-specific facilities at homeworlds, and homeworld-conquest mechanics (faction-in-exile, picking a new capital, cornered-animal bonuses, rebel resurrection) all depend on later sub-projects. The design intent is preserved below as the eventual target.

### Homeworld Conquest (Planned)

- Homeworld can only become contested after the faction has lost significant territory (e.g. below 50% of peak)
- Capturing a homeworld requires winning a war decisively, not just border skirmishes
- If homeworld falls:
  - Faction does NOT die
  - Drops to minor status ("faction in exile")
  - Picks new capital from remaining territory
  - Gains significant defensive bonuses (cornered animal effect)
  - Can attempt to reclaim homeworld in future wars
- A faction is only truly destroyed if it loses ALL territory
  - Even then, rebel events could attempt to resurrect it (far future)

### Starting Position (Implemented)

Per the resolved design question in [layer-2-faction-foundation.md](../../archive/layer-2-faction-foundation.md): **players are not faction-aligned at creation**. There is no `primaryFactionId` on `Player`. New players spawn at `GameWorld.startingSystemId` (the existing core-economy system near map center, now owned by a Federation-government major after Phase 2). All faction reputation scores start at 0; no faction nudge on registration.

Reputation grows through play (trading, eventual faction missions, eventual war contributions) and players choose their loyalties through behavior rather than character creation. This preserves the "neutral trader path is viable but limited" design from §3.

---

## 6. Initial Faction Roster

Starting roster of 8 major factions — one per government type. This ensures every government's economic profile is represented among the major powers. The system is built to support many more factions added over time.

**Status: Implemented.** Roster lives in `FACTION_ROSTER` (`lib/constants/factions.ts`); world-gen reads it at seed time.

| Faction | Government | Doctrine | Color | Personality |
|---|---|---|---|---|
| Terran Sovereignty | Federation | Protectionist | `#3a82c8` | Democratic superpower. Stable and prosperous, overwhelming defensive response. The galactic status quo — everyone else defines themselves relative to the Terrans |
| Meridian Compact | Corporate | Mercantile | `#d4a534` | Trade confederation driven by profit above ideology. Richest faction. Fights with embargoes and proxy wars before committing their own fleets |
| Kessari Dominion | Authoritarian | Expansionist | `#c83a3a` | Centralized military empire. State-controlled economy funnels everything toward expansion. Aggressive and disciplined but chronically overextended |
| Free Reaches | Frontier | Opportunistic | `#e07a2c` | Loose alliance of lawless fringe systems held together by mutual distrust of centralized power. Strikes when neighbors are distracted, vanishes when confronted |
| Arvani Communion | Theocratic | Protectionist | `#8a5cb8` | Insular faith-state built around ancient stellar prophecies. Peaceful and self-sufficient until sacred systems are threatened — then relentless. Heavy trade restrictions on "immoral" goods |
| Helix Ascendancy | Technocratic | Hegemonic | `#3acdc8` | Research-state that views technological superiority as a mandate to lead. Pressures weaker neighbors into client-state arrangements, sharing tech in exchange for resources and compliance |
| Solari Collective | Cooperative | Expansionist | `#5cb85c` | Worker-owned commune that believes all systems deserve liberation from exploitation. Genuinely idealistic, genuinely aggressive. Good intentions, uncomfortable methods |
| Ironveil Pact | Militarist | Opportunistic | `#7a8590` | Permanent war economy where every citizen serves. Not expansionist by ideology — they simply watch for weakened neighbors and strike when the cost is low. Respected and feared in equal measure |

### Emergent Rivalries

Rivalries are not hard-coded. They emerge naturally from the relation system (§2) based on doctrine incompatibility, government opposition, border friction, and geography.

- **Doctrine clashes**: Expansionist factions (Kessari, Solari) generate friction with Protectionist factions (Terran, Arvani) through border pressure. Hegemonic factions (Helix) create tension with any smaller neighbor.
- **Government opposition**: Authoritarian vs Federation, Corporate vs Cooperative, Militarist vs Theocratic — persistent low-level ideological friction (per the sparse table in §2 "Negative Relation Drivers").
- **Opportunistic wildcards** (*partially implemented*): the Free Reaches and Ironveil Pact share an opportunistic doctrine, but the actual "strike-when-weakened" targeting needs War — today they just contribute the same baseline + doctrine + government drift as everyone else.
- **Economic competition** (*planned*): Mercantile↔Mercantile trade-competition and Cooperative↔Corporate ideological friction are partially in the doctrine compatibility / government opposition tables but the trade-competition driver itself is not implemented.

### Starting Relation Scores (Implemented as zero-init)

All faction-pair relations are seeded at score 0 at world-gen time, *not* pre-nudged by doctrine compatibility or government opposition. The relations processor then immediately starts drifting them — within the first few hundred ticks the doctrine + government + border drivers produce a recognizable political landscape without needing a hand-tuned starting matrix. This was the simpler implementation choice and gives processor tuning a clean baseline.

All faction names, lore, and color choices are provisional. The roster will grow as the game scales.

---

## 7. Minor Factions

**Status: Implemented (soft constraints).** Procedural generation in `lib/engine/faction-gen.ts`; archetype distribution in `MINOR_ARCHETYPE_DISTRIBUTION` (`lib/constants/factions.ts`).

12 minor factions at default universe scale, 18 at 10K scale. Both values come from `UNIVERSE_GEN.MINOR_FACTION_COUNT` and scale with the universe preset. Minors use the same doctrine pool as majors — doctrine behavior scales with territory size, not faction category. An expansionist minor is a regional nuisance; an expansionist major is a galactic threat. Minor governments and doctrines are picked randomly from the full pool at world-gen time.

**Starting size**: minimum 5 systems per minor, enforced by `enforceMinorMinimum()` (post-flood-fill, any minor below the floor claims its nearest systems away from neighboring majors). Upper bound emerges from flood-fill — no hard cap.

### Placement Archetypes

Minor factions are distributed across four archetypes based on their position relative to major factions. Proportions in `MINOR_ARCHETYPE_DISTRIBUTION` add up to all `MINOR_FACTION_COUNT` slots — `ceil(N × proportion)` for the first three, remainder goes to cluster.

| Archetype | Proportion | Default (N=12) | 10K (N=18) | Position | Gameplay role |
|---|---|---|---|---|---|
| Buffer state | 0.33 | 4 | 6 | Near midpoint of two major homeworlds | Politically interesting. Courted or threatened by both neighbors. Survives by playing sides |
| Frontier independent | 0.33 | 4 | 6 | Furthest from map center (top 20% sampled) | Growth story. Unclaimed space to expand into. Safe but isolated early on |
| Enclave | 0.20 | 3 | 4 | Same region as a randomly-chosen major homeworld | At risk of absorption. Hegemonic factions pressure these first |
| Cluster | remainder | 1 | 2 | Furthest from all major homeworlds (top 30% sampled) | Weak individually, strong together. Natural target for player-driven alliances |

**Seed constraints (soft / best-effort):**
- *Designed*: no minor borders more than 2 majors. *Today*: archetype placement biases toward this but does not strictly enforce it post-flood-fill.
- *Designed*: every minor has systems not directly adjacent to a major faction's border. *Today*: same — biased, not enforced.
- *Designed*: frontier minors have unclaimed space on at least one side. *Today*: handled implicitly by the "top 20% furthest from center" sampling.

The cluster archetype is intended for 2+ adjacent minors that can form natural alliances. At default scale only one cluster slot is allocated (after the buffer/frontier/enclave ceil-rounding eats most of the budget); at 10K scale there are 2. This is acceptable per the implementation note — a 1-faction cluster is fine for Foundation.

### Faction Spawning (Planned)

> **Planned (far future):** new factions emerging from in-game events (secession, rebellion, colonial independence). Hard cap ~30–40 total. None of these spawn triggers are implemented today; the roster is fixed after seed.

**Spawn triggers** (design intent):
- **Secession**: A major faction that overextends or loses badly — outlying systems break away
- **Rebellion**: Systems under hostile occupation (recently conquered) revolt and form a new faction
- **Colonial independence**: Frontier systems settled by a major faction drift away culturally

New factions would always spawn as minor, inheriting some traits from their parent faction but developing their own doctrine and identity.

---

## 8. System Scale and Map Structure

### System Scale (Implemented)

Two universe presets, selected via the `UNIVERSE_SCALE` env var:

| Preset | Total systems | Map size | Regions | Major factions | Minor factions |
|---|---|---|---|---|---|
| `default` | 600 | 7,000 × 7,000 | 24 | 8 | 12 |
| `10k` | 10,000 | 25,000 × 25,000 | 60 | 8 | 18 |

The original design target was 1K–2K systems. Layer 0's universe-scaling work landed both a smaller dev preset (600, snappy iteration) and a stress-test preset (10K, validates PostgreSQL + tile/LOD scaling). The 1K–2K range is no longer a discrete preset — share-based status thresholds (§1) and percentage-based archetype distributions (§7) make both presets behave correctly without hand-tuning.

### Map Structure (Implemented)

The map is a single Pixi-rendered universe view with LOD-based zoom and a Mode/Overlay control:

- **Map Mode** (single-select): how the territory polygons are tinted.
  - `political` — tinted by `Faction.color`. Default mode.
  - `regions` — tinted by region (the legacy view; useful for orientation).
  - `none` — clean starfield.
- **Overlays** (multi-select, stack on top of any mode):
  - `tradeFlow` — particle overlay showing recent trade volume.
- **LOD**: system dots and labels cull at low zoom; territory polygons stay visible at every zoom level (eases from full opacity in universe view to ~0.6 in system view).

Regions are non-homogeneous by design — border regions can contain systems from multiple factions, and a faction's territory can span multiple regions. Region polygon shapes remain useful for orientation (clusters of systems with limited jump-lane access), even though gameplay weight has shifted to factions.

Region territory is not navigated as a separate "region map → system view" page; the same Pixi canvas zooms continuously from galaxy view down to individual systems.

---

## Related Design Docs

These topics are large enough to warrant their own design documents:
- **[War System](../../planned/war-system.md)** *(planned)* — border conflicts (the spawn side lives here in §4; the consume side is in war-system.md), faction wars, battles, territory control, player involvement
- **[Player Progression](../../planned/player-progression.md)** *(planned)* — ship upgrades, region unlocking, credit sinks, early/mid/late game arc
- **[Facilities](../../planned/facilities.md)** *(planned)* — faction-owned facilities, war targets, tier capabilities
- **[System Traits](./system-traits.md)** *(active)* — trait catalog, quality tiers, economy derivation
- **[Multiplayer Infrastructure](../../planned/multiplayer-infrastructure.md)** *(planned)* — player trading, alliances, communication, coordination
