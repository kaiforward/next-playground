# Navigation Changes

Remaining navigation deltas not yet built. This is a delta document against the active navigation system ([navigation.md](../active/gameplay/navigation.md)) — it describes what still changes, not the full system. When implemented, merge into the active doc.

> **Shipped**: Convoys, speed-based travel time, and ship-stat / upgrade / escort effects in the arrival danger pipeline are all live — see [navigation.md](../active/gameplay/navigation.md). What remains below is contraband/goods restrictions (§4) plus facility- and war-driven navigation effects that depend on still-planned systems (§5–§6). Section numbers are preserved from the original delta (§1–3 were the now-shipped convoy/speed/pipeline changes) so cross-references from other planned docs stay valid.

---

## 4. Contraband and Goods Restrictions

**Replaces**: The current model where all 12 goods are available at all systems.

Government type determines which goods are **restricted** at regular markets. Restricted goods cannot be bought or sold at standard markets in systems with that government — they are contraband. Government type also determines which goods are **taxed** on import (the Import Duty stage of the shipped danger pipeline) and the **inspection modifier** that scales the Contraband Inspection stage's detection chance — see [navigation.md](../active/gameplay/navigation.md) for the live pipeline stages.

### Government Trade Rules

| Government | Contraband | Taxed goods | Inspection mod | Identity |
|---|---|---|---|---|
| **Federation** | Weapons | Chemicals @12% | 1.2× | Regulated but fair — weapons banned, light taxes, moderate enforcement |
| **Corporate** | — | — | 0.8× | Wide open, profit-first — minimal enforcement, anything profitable goes |
| **Authoritarian** | Weapons, Chemicals | — | 1.5× | Strict state control — strategic goods banned, heavy inspection presence |
| **Frontier** | — | — | 0× | Lawless — no enforcement of any kind, smuggler's paradise |
| **Cooperative** | Luxuries | — | 1.0× | Egalitarian — ostentatious wealth rejected, but otherwise fair and open |
| **Technocratic** | — | Water, Food @8% | 0.6× | Innovation-focused — basics taxed to fund research, minimal enforcement. Best market for advanced goods |
| **Militarist** | — | Electronics, Machinery @10% | 1.3× | War economy — industrial goods appropriated for military use, military patrols enforce compliance |
| **Theocratic** | Weapons, Chemicals, Luxuries | — | 1.4× | Ideological — immoral goods banned, zealous inspection corps. Most restricted trade environment |

### Design Rationale

The 8 governments create a clean gradient of trade restriction:

| Restriction level | Governments | Contraband count |
|---|---|---|
| Open trade | Corporate, Frontier, Technocratic, Militarist | 0 |
| Moderate restriction | Federation, Cooperative | 1 |
| Strict restriction | Authoritarian | 2 |
| Heavy restriction | Theocratic | 3 |

Each government has a distinct smuggling/trading identity:
- **Frontier** and **Corporate** are safe destinations for any cargo — no inspection risk
- **Technocratic** is open to trade but taxes staple goods (water, food) to fund research — traders bringing basics pay a premium, but advanced/luxury goods flow freely
- **Militarist** has no contraband because a war economy *wants* everything flowing in — it taxes industrial goods instead, appropriating electronics and machinery for the military. High inspection rate means smugglers bringing contraband *through* militarist space get caught often
- **Cooperative** bans luxuries — egalitarian values reject ostentatious wealth. Neutral inspection rate
- **Theocratic** is the hardest to trade with — three contraband goods and high inspection. Chemicals maps to "narcotics" (closest match in the 12-good catalog). But theocratic systems pay premiums for basic goods they can't easily produce

### Black Markets

**Black markets** (see [facilities.md](./facilities.md)) bypass government restrictions entirely — all goods are available regardless of government type. This creates the smuggling loop: buy restricted goods at a black market or frontier system, transport them through restricted space (risking inspection), sell at another black market for a premium.

### Customs House Facility

The base contraband inspection chance is set by government type (25% base × government modifier). The **Customs House** facility (see [facilities.md](./facilities.md)) adds a per-system bonus on top:

`effective_inspection_chance = government_base × government_modifier + customs_house_bonus`

This makes inspection rates system-specific, not just government-specific. Smugglers route around customs house systems even within the same government territory. Destroying a customs house during wartime opens smuggling routes — a strategic consideration.

---

## 5. Fuel and Refueling

All systems offer refueling — no system lacks the ability to refuel a ship. The base cost remains universal (currently 2 CR per fuel unit).

The **Fuel Depot** facility (see [facilities.md](./facilities.md)) provides a discount on refueling at that system. Higher-tier fuel depots give larger discounts. This makes fuel depots valuable waypoints for long-haul routes but never gates access — a player can always refuel, they just pay more at systems without a depot.

---

## 6. War Zone Navigation Effects

**New section** — how active wars ([war-system.md](./war-system.md)) modify the navigation experience. Wars create the most dangerous travel conditions in the game and are where convoy mechanics matter most.

### War Zone Danger

War zones are an additional danger source, additive with government baseline and events:

```
totalDanger = min(governmentBaseline + eventDanger + warZoneDanger, 0.5)
```

The 0.5 cap prevents danger from becoming a guaranteed loss — even in the worst conditions, there's always a chance of safe passage.

**Danger values by war state:**

| System state | War zone danger | Duration | Notes |
|---|---|---|---|
| **Contested** (active battle) | ~0.20–0.25 | While war is active | Systems being actively fought over ([war-system.md §5.1](./war-system.md)). Highest sustained danger |
| **Staging** (border, no active battle) | ~0.10–0.15 | While war is active | Border systems adjacent to contested zones. Military buildup, supply convoys, nervous patrols |
| **Recently captured** | ~0.15 → decaying | Post-capture, fades over ~50 ticks | Post-capture instability — resistance, looting, power vacuum. Decays as the new faction establishes control |
| **Rear territory** | 0 | — | Deep in either faction's territory. War doesn't increase danger away from the front |

These are tuning numbers — exact values set during implementation and simulation.

### Pipeline Interaction

War zone danger feeds into the existing pipeline through the total danger calculation:

- **Stage 1 (Hazard)**: Indirectly affected — higher total danger means hazard incidents are more likely in contested systems, but the primary driver is still cargo hazard level
- **Stage 4 (Event Loss)**: Directly affected — war zone danger adds to the event-based loss probability. This is the main impact: pirates exploiting the chaos, debris from battles, military engagements that catch civilian ships in crossfire
- **Stages 2–3 (Duty/Inspection)**: Unaffected by war danger — taxes and inspections are government policy, not combat. A system's government doesn't change during wartime (though it may change if the system is captured and the new faction has a different government type)

### Convoys in War Zones

War zones are where escort mechanics earn their keep:

- Unescorted trade ships in contested systems face very high effective danger — war zone danger stacked on event danger can approach the 0.5 cap
- A single corvette escort in a contested system reduces Stage 4 loss probability by ~50% (the shipped escort diminishing-returns curve, see [navigation.md](../active/gameplay/navigation.md))
- Convoy speed trade-off is sharpest here: a frigate escort gives maximum protection but crawls through the most time-sensitive space. A faster corvette gets through quicker but with less protection
- War zones create natural demand for combat ships — players who invested in escorts see their fleet composition pay off when wars break out

### Blockades

**Not in initial design.** The current system adds danger to war zones but doesn't restrict access — any ship can still plot a route through contested space, they just face higher danger. Full blockade mechanics (preventing passage entirely, requiring blockade runners) are a future extension noted in [war-system.md](./war-system.md). The danger-based system is sufficient for initial implementation and avoids the complexity of route-blocking logic.

---

## Related Design Docs

- **[Navigation (active)](../active/gameplay/navigation.md)** — current implementation this doc modifies
- **[Ship Roster](../active/gameplay/ship-roster.md)** — ship stats, escort mechanics, fleet composition, ship damage
- **[Ship Upgrades](../active/gameplay/ship-upgrades.md)** — module catalog, slot types, danger pipeline interactions (§7)
- **[War System](./war-system.md)** — war zones, contested systems, battle mechanics
- **[Faction System](../active/gameplay/faction-system.md)** — government types, doctrine effects on navigation
- **[Facilities](./facilities.md)** — customs house, fuel depot, black market, drydock facilities
