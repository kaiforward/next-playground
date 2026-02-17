# Migration Notes

Architectural shifts where planned systems replace active implementations. The planned docs describe the target state. These items track what changes during implementation — delete each item once the migration is complete and the active docs are updated.

### 1. Government Ownership: Region → Faction

**Active** (universe.md, economy.md): Government type is assigned per *region* at seed time. All systems in a region share the same government.

**Planned** (faction-system.md §1): Government type belongs to the *faction*. Systems inherit their controlling faction's government type. When territory changes hands in a war, the system's government changes.

**Key deltas**: Government modifiers (volatility, equilibrium spread, tax, danger, contraband) move from per-region to per-system based on owning faction. Affects economy processing, danger pipeline, contraband inspection, and tax collection.

---

### 2. Economy Type Assignment: Top-Down → Trait-Derived

**Active** (universe.md): Economy type is assigned per system, weighted by region identity. Top-down assignment at seed time.

**Planned** (system-enrichment.md §2–3): Economy type is *derived* from system trait affinity scoring. Bottom-up derivation. Region themes weight trait generation but don't dictate economy. System enrichment §3 acknowledges this ("Current Model (Being Replaced)").

**Key deltas**: Entire world generation pipeline changes. Region identity no longer determines system economies — traits do.

---

### 3. Ship Types: 2 → 12, Stats: 2 → 10

**Active** (navigation.md): 2 ship types (Shuttle, Freighter) with 2 stats (fuel capacity, cargo capacity).

**Planned** (ship-roster.md): 12 ship classes with 10 stats. Ship stats modify the danger pipeline (ship-roster.md §4.3). Convoy mechanics added (navigation-changes.md §1). Speed stat replaces fixed travel time formula (navigation-changes.md §2).

**Key deltas**: Navigation.md ship section entirely replaced. Danger pipeline gains ship stat modifiers. Travel time becomes speed-dependent. Convoy grouping added.

---

### 5. Universe Scale: 200 → 1,000-2,000 Systems

**Active** (universe.md): 200 systems, 8 regions, 25 per region.

**Planned** (faction-system.md §7): 1,000-2,000 systems across faction territories.

**Key deltas**: Region count increases significantly. Cascading impacts on tick engine (round-robin processing frequency), map rendering (60+ regions), connection generation (scaling MST), and seed generation time.

---

### 7. Tick Engine Expansion

New tick processors needed for planned systems. None are described in the active tick engine doc yet. Processor dependency order not yet considered.

**Faction system**: Relation drift, war exhaustion, battle resolution, territory control, faction economy effects.

**Ship automation**: Automated trade execution for player ships.

**Player facilities**: Facility production output.

To be designed during implementation of each respective system.

---

### 12. Region Identity Lists

**Active** (universe.md): 5 region identities (Trade Hub, Resource Rich, Industrial, Tech, Agricultural).

**Planned** (system-enrichment.md §3): 8 region themes (Garden heartland, Mineral frontier, Industrial corridor, Research cluster, Energy belt, Trade nexus, Contested frontier, Frontier wilds).

**Confirmed**: The new 8-theme list replaces the old 5-identity list. This is intentional — system enrichment explicitly notes the current model is being replaced.
