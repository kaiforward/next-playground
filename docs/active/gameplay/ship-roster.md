# Ship Roster

Status: **Active** — shipped (core ship system).

Ship classes, roles, and stats. Since the pivot Phase 1 teardown, ships are travel assets only: cargo, upgrades, purchase, repair, and the arrival danger pipeline are gone. Combat-facing stats (hull, shields, firepower, evasion, stealth) remain on the roster but are inert until the war layer lands, when ships return as faction assets.

**Design principle**: Size is the foundation. A ship's size category determines its baseline stat profile — small ships are fast, evasive, and stealthy; large ships absorb damage but can't hide or dodge. Ship classes specialise within their size category by role.

**Implementation**: Definitions live in `lib/constants/ships.ts`.

---

## 1. Ship Stats

### 1.1 Core Stats

Every ship has these stats. Values are set by the ship class.

| Stat | Description | Status |
|---|---|---|
| **Size** | Physical scale of the ship. Foundation stat — sets the baseline profile | Live (drives class identity) |
| **Fuel range** | Maximum fuel capacity — determines how many hops before refuelling | Live |
| **Speed** | Ticks per hop. Lower is faster | Live |
| **Hull** | Structural integrity — damage resistance and total hit points | Inert until war |
| **Shield** | Regenerating ablative layer absorbed before hull damage | Inert until war |
| **Firepower** | Offensive combat capability | Inert until war |
| **Evasion** | Ability to avoid hits and escape threats. Baseline set by size | Inert until war |
| **Stealth** | How difficult the ship is to detect. Baseline set by size | Inert until war |
| **Sensors** | Detection and scanning range | Inert (future intel) |
| **Crew capacity** | How many crew the ship can support | Flavour stat |

### 1.2 Size Categories

Size is the foundational stat. It sets the baseline profile that individual ship classes then specialise within.

| Size | Evasion baseline | Stealth baseline | Hull baseline |
|---|---|---|---|
| **Small** | High | High | Low |
| **Medium** | Moderate | Moderate | Moderate |
| **Large** | Low | Low | High |

A huge capital ship has terrible stealth simply because it's enormous — no amount of technology can hide something that big. A tiny shuttle is naturally hard to detect and can dodge threats, but one solid hit could destroy it.

---

## 2. Ship Roles

| Role | Primary stats | Identity |
|---|---|---|
| **Trade** | Fuel range, speed | Hauling between systems (war-era logistics) |
| **Combat** | Firepower, hull, evasion | Escort duty, fleet actions |
| **Scout** | Speed, sensors, fuel range | Exploration, intel |
| **Stealth** | Stealth, evasion | Covert operations |
| **Support** | Hull, crew capacity, sensors | Fleet coordination, long-range operations |

---

## 3. Ship Roster

Twelve classes total. Exact stat values live in `lib/constants/ships.ts`.

| Class | Size | Role | Identity |
|---|---|---|---|
| **Shuttle** | Small | Trade | The starter ship. Every player begins here |
| **Light Freighter** | Small | Trade | A reliable hauler at the cost of speed |
| **Interceptor** | Small | Combat | Fast attack ship |
| **Scout Skiff** | Small | Scout | Fast, far-ranging, sees everything |
| **Bulk Freighter** | Medium | Trade | The workhorse |
| **Corvette** | Medium | Combat | Medium warship |
| **Blockade Runner** | Medium | Stealth | The smuggler's ship |
| **Survey Vessel** | Medium | Support | Deep exploration and intelligence |
| **Heavy Freighter** | Large | Trade | The trade titan |
| **Frigate** | Large | Combat | Pure warship. Fleet flagship |
| **Stealth Transport** | Large | Stealth | Moves serious tonnage through dangerous space |
| **Command Vessel** | Large | Support | High crew capacity, excellent sensors, multi-role platform |

---

## 4. Ship Lifecycle

- **Starter ship**: New players spawn with a free Shuttle. Fleets are otherwise fixed — purchase died with the shipyard (ships return as faction assets in the war layer). The dev teleport tool remains for testing.
- **Disabled flag**: `disabled` persists on the model but nothing sets it — no system damages hulls since the arrival pipeline was removed.

---

## 5. Future Extensions

Tagged with `[PENDING: <system>]` so they're greppable. Run `grep -r "\[PENDING:" docs/active/` to find all deferred work across active specs.

- **Combat power aggregation** — for large-scale faction battles, individual ship stats would roll up into a single combat-power rating. `[PENDING: war-system]`
- **Faction fleet grouping** — war-era fleet formations are a fresh design (the old player convoys were cut in the teardown). `[PENDING: war-system]`

---

## Related Design Docs

- **[Navigation](./navigation.md)** — travel, jump lanes, fuel, arrival
