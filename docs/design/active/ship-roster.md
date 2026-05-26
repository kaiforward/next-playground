# Ship Roster

Status: **Active** — shipped (core ship system).

Ship classes, roles, stats, and how ships interact with travel, combat, and the arrival danger pipeline. Ships are the player's primary asset.

**Design principle**: Size is the foundation. A ship's size category determines its baseline stat profile — small ships are fast, evasive, and stealthy but carry little; large ships haul massive cargo and absorb damage but can't hide or dodge. Ship classes specialise within their size category by role.

**Implementation**: Definitions live in `lib/constants/ships.ts`. Ship-stat → danger-pipeline integration lives in `lib/engine/danger.ts`. Escort math lives in `lib/engine/damage.ts`.

---

## 1. Ship Stats

### 1.1 Core Stats

Every ship has these stats. Values are set by the ship class and modified by installed upgrade modules (see [ship-upgrades.md](./ship-upgrades.md)).

| Stat | Description | Favours |
|---|---|---|
| **Size** | Physical scale of the ship. Foundation stat — influences baseline evasion, stealth, cargo, and hull. Not directly modifiable by upgrades | Small ships: evasion/stealth. Large ships: cargo/hull |
| **Cargo capacity** | Volume of goods the ship can carry | Trade, missions |
| **Fuel range** | Maximum fuel capacity — determines how many hops before refuelling | Exploration, long-range trade |
| **Speed** | Ticks per hop. Lower is faster | Travel time, time-sensitive missions, escape from danger |
| **Hull** | Structural integrity — damage resistance and total hit points | Surviving danger pipeline (hazard stage), combat durability |
| **Shield** | Regenerating ablative layer absorbed before hull damage | Combat survivability, arrival damage |
| **Firepower** | Offensive combat capability | Combat encounters, escort protection |
| **Evasion** | Ability to avoid hits and escape threats. Baseline set by size | Danger pipeline survival (event cargo loss stage), combat defence |
| **Stealth** | How difficult the ship is to detect. Baseline set by size | Reducing contraband inspection chance, avoiding detection |
| **Sensors** | Detection and scanning range | Survey-mission stat gates, intel |
| **Crew capacity** | How many crew the ship can support | Currently a flavour stat — feeds into future crew mechanics |
| **Upgrade slots** | Typed module slots (see §4 and [ship-upgrades.md](./ship-upgrades.md)) | Customisation depth |

### 1.2 Size Categories

Size is the foundational stat. It sets the baseline profile that individual ship classes then specialise within.

| Size | Evasion baseline | Stealth baseline | Cargo baseline | Hull baseline | Upgrade slots |
|---|---|---|---|---|---|
| **Small** | High | High | Low | Low | 2 |
| **Medium** | Moderate | Moderate | Moderate | Moderate | 3–4 |
| **Large** | Low | Low | High | High | 4–5 |

A huge capital ship has terrible stealth simply because it's enormous — no amount of technology can hide something that big. A tiny shuttle is naturally hard to detect and can dodge threats, but one solid hit could destroy it.

---

## 2. Ship Roles

| Role | Primary stats | Gameplay purpose |
|---|---|---|
| **Trade** | Cargo, fuel range, speed | Hauling goods between systems |
| **Combat** | Firepower, hull, evasion | Escort duty, combat missions, pirate defence |
| **Scout** | Speed, sensors, fuel range | Exploration, survey missions, finding opportunities |
| **Stealth** | Stealth, evasion, moderate cargo | Smuggling, blockade penetration |
| **Support** | Hull, crew capacity, sensors | Fleet coordination, long-range operations |

Not every ship maps perfectly to one role — early-game ships are versatile generalists; late-game ships tend toward sharper specialisation.

---

## 3. Ship Roster

Twelve classes total. Exact stat values live in `lib/constants/ships.ts`.

### 3.1 Small Ships

Affordable, limited, but capable in their niche. These are the ships players learn the game with.

| Class | Role | Slot layout | Identity |
|---|---|---|---|
| **Shuttle** | Generalist (trade) | 1 engine, 1 cargo | The starter ship. Every player begins here. Reliable but outgrown quickly |
| **Light Freighter** | Trade | 1 engine, 1 cargo | First trade upgrade. The "I want to haul more" choice |
| **Interceptor** | Combat | 1 engine, 1 defence | Fast attack ship. Escort duty, early combat missions |
| **Scout Skiff** | Scout | 1 engine, 1 systems | Fast, far-ranging, sees everything. Gets out before trouble arrives |

### 3.2 Medium Ships

Role specialisation becomes pronounced — medium ships are good at their job and mediocre at everything else.

| Class | Role | Slot layout | Identity |
|---|---|---|---|
| **Bulk Freighter** | Trade | 1 engine, 2 cargo, 1 defence | The workhorse. Serious trading volume |
| **Corvette** | Combat | 1 engine, 2 defence, 1 systems | Medium warship. Escort convoys, combat missions |
| **Blockade Runner** | Stealth | 1 engine, 1 cargo, 1 defence, 1 systems | The smuggler's ship. Carries enough to be profitable |
| **Survey Vessel** | Support | 1 engine, 1 cargo, 2 systems | Deep exploration and intelligence — survey-mission specialist |

### 3.3 Large Ships

Very expensive. Significant investment that marks a player as a serious power in the galaxy.

| Class | Role | Slot layout | Identity |
|---|---|---|---|
| **Heavy Freighter** | Trade | 1 engine, 3 cargo, 1 defence, 1 systems | The trade titan. One run equals five in a bulk freighter |
| **Frigate** | Combat | 1 engine, 3 defence, 2 systems | Pure warship. System defence, fleet flagship |
| **Stealth Transport** | Stealth | 1 engine, 2 cargo, 1 defence, 2 systems | Ultimate smuggler. Moves serious cargo through dangerous space |
| **Command Vessel** | Support | 2 engine, 1 cargo, 1 defence, 2 systems | High crew capacity, excellent sensors, multi-role platform |

---

## 4. Fleet Composition

Players build fleets across multiple roles. A well-composed fleet outperforms an equal-cost fleet of identical ships.

### 4.1 Convoys

Convoys are explicit player-formed groups — ships docked at the same system are grouped and sent on the same route together, travelling at the speed of the slowest ship. See [navigation.md](./navigation.md) for full convoy mechanics.

### 4.2 Escort Mechanics

All ships in a convoy contribute their `firepower` to a shared escort pool. Combat ships dominate the pool naturally because they have much higher firepower values (10–18 vs 1–3 for traders).

- Total firepower drives `damage chance reduction` via a diminishing-returns curve (`fp / (fp + K)`) capped at a maximum reduction
- Damage severity reduction is half the chance reduction — escorts prevent more than they mitigate
- The reduction applies to the hull/shield damage stage of the arrival pipeline
- A heavy freighter alone is fragile in dangerous space; pairing it with a corvette or frigate dramatically improves survival, at the cost of slowing the convoy to the escort's speed

Implementation: `computeEscortProtection()` in `lib/engine/damage.ts`.

### 4.3 Ship Stats in the Danger Pipeline

Three of the five arrival-pipeline stages read ship stats directly. Module bonuses (see [ship-upgrades.md](./ship-upgrades.md)) stack on top.

| Pipeline Stage | Ship Stat | Effect |
|---|---|---|
| **Stage 1: Hazard Incidents** | **Hull** (+ armour module) | Diminishing reduction to *loss severity*. A sturdier ship contains hazardous cargo better. Does not reduce incident *chance* |
| **Stage 2: Import Duty** | None | Government tax rate. Ship stats irrelevant |
| **Stage 3: Contraband Inspection** | **Stealth** (+ no current module — base stat only) | Diminishing reduction to *inspection chance*. A stealthy ship is harder to scan. Hidden Compartment then conceals a fixed portion of cargo from any inspection that does happen |
| **Stage 4: Event-Based Cargo Loss** | **Evasion** (+ manoeuvring thrusters) | Diminishing reduction to *loss probability*. An agile ship dodges debris and pirate attacks. Point Defence Array adds further multiplicative probability reduction |
| **Stage 5: Hull/Shield Damage** | **Hull/Shield** + escort firepower | Hull/shield absorb damage. Escort firepower reduces chance and severity |

Each stat maps to a different kind of threat. No single stat dominates the pipeline:

- **Trade ships** (low evasion, low stealth, moderate hull): Vulnerable across the board. Rely on safe routes and escorts
- **Stealth ships** (high stealth, high evasion, lower hull): Sail through inspections and dodge event hazards, but hazardous cargo incidents hit harder
- **Combat ships** (high hull, moderate evasion, low stealth): Shrug off hazard incidents but get inspected every time. Not built for smuggling

---

## 5. Ship Lifecycle

### 5.1 Acquisition

- **Purchase**: Buy at any system's shipyard service for the listed price. The full class roster is offered everywhere — shipyard *tier* gating (only T1 shipyards sell small ships, etc.) is deferred. `[PENDING: facilities]`
- **Starter ship**: New players spawn with a free Shuttle

### 5.2 Upgrades

Ships are customised through modular upgrades. See [ship-upgrades.md](./ship-upgrades.md) for slot types, module catalog, and installation.

### 5.3 Damage and Repair

- Ships take hull and shield damage from the arrival pipeline (hazard incidents, event cargo loss, hull/shield damage) and from combat
- Shields regenerate while docked
- Hull damage is permanent until repaired at a shipyard; the cost scales with damage taken
- **Hull at 0 disables a ship**: the ship's status flips to `disabled`, all cargo is lost, and the ship cannot move until repaired. There is no graceful degradation (e.g. "hull at 50% = reduced cargo capacity") — that is intentional simplicity, not a planned mechanic
- Ship destruction (as distinct from disable) — where the ship is lost permanently along with installed modules — is a future risk tied to combat outcomes, not currently triggered by the arrival pipeline. `[PENDING: combat-destruction]`

### 5.4 Selling

- Ships can be sold at a shipyard for a fraction of purchase price
- Installed modules can be removed before selling (at any drydock service) and stay in the player's inventory

---

## 6. Future Extensions

Tagged with `[PENDING: <system>]` so they're greppable. Run `grep -r "\[PENDING:" docs/design/active/` to find all deferred work across active specs.

- **Faction-exclusive ship variants** — six factions each offer enhanced versions of base classes with faction-specific stat profiles. Gated by Champion reputation. `[PENDING: faction-system]`
- **Operating costs beyond fuel** — maintenance, crew wages, and module upkeep are not currently charged. Only fuel is a recurring cost. Designed but deferred until automation makes fleet bloat a real risk. `[PENDING: automation]`
- **Combat power aggregation** — for large-scale faction battles, individual ship stats would roll up into a single combat-power rating. `[PENDING: war-system]`
- **Hull damage stat degradation** — the design discussed "hull at 50% means reduced cargo capacity, slower speed". Currently hull is a binary functional/disabled threshold; graceful degradation is a future tuning lever. `[PENDING: design-call]`
- **Hard fleet size cap** — there is no cap today and no plan to introduce one; the natural soft cap will emerge once operating costs ship. `[PENDING: automation]`

---

## Related Design Docs

- **[Ship Upgrades](./ship-upgrades.md)** — modular upgrade system, slot types, module catalog
- **[Navigation](./navigation.md)** — convoy travel, jump lanes, arrival pipeline
- **[Combat](./combat.md)** — battle resolution, combat mission flow
