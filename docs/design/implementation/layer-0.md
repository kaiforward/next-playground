# Layer 0 — System Enrichment Implementation

Enriches the physical universe with traits, quality tiers, and bottom-up economy derivation. No new gameplay systems — richer world generation that creates the foundation every later layer builds on.

**Design doc**: [system-enrichment.md](../planned/system-enrichment.md) §1–3 (trait catalog, affinity scoring, region themes)

**Transition**: Clean cut. Old world generation replaced wholesale. Reseed the universe.

---

## 1. Scope

### In scope
- 29 system traits across 5 categories with quality tiers (1–3)
- Trait-to-economy affinity scoring (replaces weighted random economy assignment)
- 8 region themes replace 5 region identities
- Coherence guarantees (60% economy agreement, no monotonous regions)
- Trait production modifiers on economy processing
- UI: traits visible on system detail page, trait-influenced descriptions
- Simulator experiments to validate distributions

### Out of scope (later layers)
- Facilities (§5) — Layer 2
- Faction influence on economy derivation (§2.2) — Layer 2
- Trait-based danger modifiers — Layer 1+ (wired when ship stats ship)
- Trait-gated event spawning (§4 events) — Layer 3
- Core economy exception via graph connectivity (§2.3 connectivity rule) — deferred, trait+theme scoring handles core placement well enough for 200 systems

---

## 2. Schema Changes

### New model: `SystemTrait`

```prisma
model SystemTrait {
  id        String     @id @default(cuid())
  systemId  String
  traitId   String     // TraitId — validated by guard
  quality   Int        // 1 | 2 | 3
  system    StarSystem @relation(fields: [systemId], references: [id], onDelete: Cascade)

  @@unique([systemId, traitId])  // No duplicate traits on a system
  @@index([systemId])
}
```

### Modified model: `Region`

```prisma
model Region {
  // existing fields unchanged
  identity         String  // RegionTheme (was RegionIdentity) — "garden_heartland", "mineral_frontier", etc.
  dominantEconomy  String  // NEW — most common EconomyType among the region's systems. Computed at seed, re-derived in Layer 2 after conquest.
  // governmentType stays — government assignment still per-region until factions ship
}
```

### Modified model: `StarSystem`

```prisma
model StarSystem {
  // existing fields unchanged
  traits  SystemTrait[]  // new relation
  // economyType stays — now derived from traits at seed time, stored as before
}
```

**Why store economyType on the system?** It's still the primary key for economy processing, market initialization, and all current game logic. Deriving it at query time from traits would be expensive and fragile. Store the derived value; traits are the source of truth for re-derivation (e.g., when factions change government in Layer 2).

---

## 3. Type Definitions

### New types in `lib/types/game.ts`

```typescript
export type TraitId =
  // Planetary Bodies (7)
  | "habitable_world"
  | "ocean_world"
  | "volcanic_world"
  | "frozen_world"
  | "tidally_locked_world"
  | "desert_world"
  | "jungle_world"
  // Orbital Features (7)
  | "asteroid_belt"
  | "gas_giant"
  | "mineral_rich_moons"
  | "ring_system"
  | "binary_star"
  | "lagrange_stations"
  | "captured_rogue_body"
  // Resource Deposits (7)
  | "rare_earth_deposits"
  | "heavy_metal_veins"
  | "organic_compounds"
  | "crystalline_formations"
  | "helium3_reserves"
  | "exotic_matter_traces"
  | "radioactive_deposits"
  // Phenomena & Anomalies (7)
  | "nebula_proximity"
  | "solar_flare_activity"
  | "gravitational_anomaly"
  | "dark_nebula"
  | "precursor_ruins"
  | "subspace_rift"
  | "pulsar_proximity"
  // Infrastructure & Legacy (4)
  | "ancient_trade_route"
  | "generation_ship_wreckage"
  | "orbital_ring_remnant"
  | "seed_vault";

export type TraitCategory =
  | "planetary"
  | "orbital"
  | "resource"
  | "phenomena"
  | "legacy";

export type QualityTier = 1 | 2 | 3;

export type RegionTheme =
  | "garden_heartland"
  | "mineral_frontier"
  | "industrial_corridor"
  | "research_cluster"
  | "energy_belt"
  | "trade_nexus"
  | "contested_frontier"
  | "frontier_wilds";
```

### Replaces in `lib/types/game.ts`

```typescript
// DELETE:
export type RegionIdentity =
  | "resource_rich"
  | "agricultural"
  | "industrial"
  | "tech"
  | "trade_hub";

// All references to RegionIdentity become RegionTheme
```

---

## 4. Constants

### 4.1 Trait Definitions — `lib/constants/traits.ts`

Each trait stores its economy affinities and the goods it affects for production modifiers. Quality tier scales the modifier magnitude.

```typescript
export interface TraitDefinition {
  id: TraitId;
  name: string;
  category: TraitCategory;
  economyAffinity: Partial<Record<EconomyType, 1 | 2>>;  // only non-zero entries
  productionGoods: string[];     // which goods this trait boosts production of
  descriptions: Record<QualityTier, string>;  // flavour text per quality tier
  dangerModifier?: number;       // base danger adjustment (Layer 1+ — stored now, wired later)
  negative?: boolean;            // has downsides (volcanic, radioactive, etc.)
}
```

**Tiered descriptions**: Each trait defines 3 flavour strings — one per quality tier. These are the source for system detail page display and auto-generated system descriptions. Example for `asteroid_belt`:
- Tier 1: *"A sparse debris field orbits the outer system, yielding modest mineral deposits."*
- Tier 2: *"A substantial asteroid belt provides steady ore extraction and metallic resources."*
- Tier 3: *"A dense, mineral-rich belt stretches across the system — one of the richest extraction sites in the sector."*

**Economy affinity values** come directly from the design doc tables. Each trait has 0–3 economy types it's relevant to, scored 1 (minor) or 2 (strong). See [system-enrichment.md §1.1](../planned/system-enrichment.md) for the full catalog.

**Compact reference table** (affinities only — descriptions in design doc):

| Trait | agri | extr | refi | indu | tech | core | Prod. goods |
|---|---|---|---|---|---|---|---|
| habitable_world | 2 | — | — | — | — | 2 | food |
| ocean_world | 2 | 1 | — | — | — | — | food, water |
| volcanic_world | — | 2 | 1 | — | — | — | ore, chemicals |
| frozen_world | — | 1 | — | — | — | — | water |
| tidally_locked_world | — | 1 | — | — | 1 | — | ore |
| desert_world | — | 1 | — | 1 | — | — | ore |
| jungle_world | 1 | — | — | — | 1 | — | food, chemicals |
| asteroid_belt | — | 2 | — | — | — | — | ore, metals |
| gas_giant | — | 2 | 1 | — | — | — | fuel |
| mineral_rich_moons | — | 1 | — | 1 | — | — | ore |
| ring_system | — | 1 | — | — | — | — | water |
| binary_star | — | — | 2 | — | 1 | — | fuel, chemicals |
| lagrange_stations | — | — | — | 2 | — | 1 | machinery |
| captured_rogue_body | — | 1 | — | — | 1 | — | ore |
| rare_earth_deposits | — | 1 | — | — | 2 | — | electronics |
| heavy_metal_veins | — | 1 | — | 2 | — | — | metals, weapons |
| organic_compounds | 1 | — | 1 | — | — | — | chemicals, medicine |
| crystalline_formations | — | 1 | — | — | 2 | — | electronics |
| helium3_reserves | — | 1 | 2 | — | — | — | fuel |
| exotic_matter_traces | — | — | — | — | 2 | — | electronics |
| radioactive_deposits | — | 1 | — | 1 | — | — | fuel, chemicals |
| nebula_proximity | — | 1 | — | — | 1 | — | chemicals |
| solar_flare_activity | — | — | 1 | — | — | — | fuel |
| gravitational_anomaly | — | — | — | — | 2 | — | — |
| dark_nebula | — | — | — | — | — | — | — |
| precursor_ruins | — | — | — | — | 2 | 1 | electronics |
| subspace_rift | — | — | — | — | 2 | — | — |
| pulsar_proximity | — | — | — | 1 | 1 | — | electronics |
| ancient_trade_route | — | — | — | 1 | — | 2 | luxuries |
| generation_ship_wreckage | — | 1 | — | 1 | — | — | metals |
| orbital_ring_remnant | — | — | — | 2 | — | 1 | machinery |
| seed_vault | 2 | — | — | — | 1 | — | food, textiles |

### 4.2 Quality Tier Scaling

Quality tier scales production modifiers. The base modifier is the same for all traits — quality determines magnitude.

```typescript
export const QUALITY_TIERS: Record<QualityTier, { label: string; modifier: number; rarity: number }> = {
  1: { label: "Marginal",    modifier: 0.15, rarity: 50 },  // +15% per affected good
  2: { label: "Solid",       modifier: 0.40, rarity: 35 },  // +40% per affected good
  3: { label: "Exceptional", modifier: 0.80, rarity: 15 },  // +80% per affected good
};
```

**How production modifiers apply**: In the economy processor, when calculating production for a system, each trait's production goods get a bonus:

```
effective_production(good) = base_rate(economy_type, good) × (1 + sum(trait_modifiers))
trait_modifier = QUALITY_TIERS[quality].modifier  (if good is in trait's productionGoods)
```

Example: Extraction system with asteroid_belt (quality 3) + mineral_rich_moons (quality 2). Ore production = base × (1 + 0.80 + 0.40) = base × 2.2. That's the "galactic powerhouse" the design doc describes.

### 4.3 Region Themes — `lib/constants/universe-gen.ts`

Replaces `REGION_IDENTITIES`, `ECONOMY_TYPE_WEIGHTS`, and `REGION_NAME_PREFIXES`.

#### Theme assignment cycle

```typescript
export const REGION_THEMES: RegionTheme[] = [
  "trade_nexus",
  "mineral_frontier",
  "industrial_corridor",
  "research_cluster",
  "garden_heartland",
  "energy_belt",
  "contested_frontier",
  "frontier_wilds",
];
```

Cycling assignment like current identities — 8 themes for 8 regions means each appears exactly once (at 200 systems). If scale increases, themes cycle.

#### Theme → trait weights

Each theme defines relative weights for every trait. Traits not listed get a small base weight (e.g., 5) so unusual rolls are possible. Themes make their signature traits 3–6× more likely.

**Note**: The design doc lists 3–4 core traits per theme. The weight tables below extend each theme with 1–3 additional thematically coherent traits (e.g., `frozen_world` and `ring_system` in mineral_frontier). This fills out the probability space so systems within a theme have more variety while still feeling cohesive. All additions have relevant economy affinities for the theme.

```typescript
export const REGION_THEME_TRAIT_WEIGHTS: Record<RegionTheme, Partial<Record<TraitId, number>>> = {
  garden_heartland: {
    habitable_world: 30,
    ocean_world: 25,
    seed_vault: 20,
    jungle_world: 20,
    organic_compounds: 15,
    // all others: base weight 5
  },
  mineral_frontier: {
    asteroid_belt: 30,
    gas_giant: 25,
    mineral_rich_moons: 25,
    heavy_metal_veins: 20,
    ring_system: 15,
    frozen_world: 15,
    // all others: base weight 5
  },
  industrial_corridor: {
    lagrange_stations: 30,
    orbital_ring_remnant: 25,
    heavy_metal_veins: 25,
    desert_world: 15,
    ancient_trade_route: 15,
    // all others: base weight 5
  },
  research_cluster: {
    precursor_ruins: 30,
    gravitational_anomaly: 25,
    exotic_matter_traces: 25,
    crystalline_formations: 20,
    tidally_locked_world: 15,
    captured_rogue_body: 15,
    // all others: base weight 5
  },
  energy_belt: {
    binary_star: 30,
    gas_giant: 25,
    helium3_reserves: 25,
    solar_flare_activity: 20,
    volcanic_world: 15,
    // all others: base weight 5
  },
  trade_nexus: {
    ancient_trade_route: 30,
    habitable_world: 25,
    lagrange_stations: 25,
    orbital_ring_remnant: 15,
    organic_compounds: 10,
    // all others: base weight 5
  },
  contested_frontier: {
    // Mixed — no single trait dominates. Slightly elevated danger/resource traits.
    dark_nebula: 20,
    radioactive_deposits: 20,
    volcanic_world: 20,
    nebula_proximity: 15,
    asteroid_belt: 15,
    heavy_metal_veins: 15,
    // all others: base weight 8 (higher base = more variety)
  },
  frontier_wilds: {
    // Sparse traits (systems get fewer traits). Frontier/oddball mix.
    frozen_world: 20,
    nebula_proximity: 20,
    ring_system: 15,
    pulsar_proximity: 15,
    captured_rogue_body: 15,
    // all others: base weight 5
  },
};
```

#### Theme → trait count

Systems don't all get the same number of traits. Theme influences count. The design doc allows 1–4 globally; we set min 2 for non-frontier themes because single-trait systems produce weak affinity signals (one trait often ties multiple economy types), leading to more coherence enforcement. Frontier wilds keeps min 1 per the design doc's explicit "1–2 per system" note.

```typescript
export const REGION_THEME_TRAIT_COUNT: Record<RegionTheme, { min: number; max: number }> = {
  garden_heartland:     { min: 2, max: 4 },
  mineral_frontier:     { min: 2, max: 4 },
  industrial_corridor:  { min: 2, max: 4 },
  research_cluster:     { min: 2, max: 4 },
  energy_belt:          { min: 2, max: 4 },
  trade_nexus:          { min: 2, max: 4 },
  contested_frontier:   { min: 2, max: 4 },
  frontier_wilds:       { min: 1, max: 2 },  // sparse — design doc says 1-2
};
```

#### Theme → government type weights

Government assignment stays per-region. Weights need updating for 8 themes.

```typescript
export const GOVERNMENT_TYPE_WEIGHTS: Record<RegionTheme, Record<GovernmentType, number>> = {
  garden_heartland:     { federation: 40, corporate: 25, frontier: 20, authoritarian: 15 },
  mineral_frontier:     { frontier: 40, corporate: 30, federation: 20, authoritarian: 10 },
  industrial_corridor:  { corporate: 35, authoritarian: 30, federation: 25, frontier: 10 },
  research_cluster:     { corporate: 35, federation: 30, authoritarian: 20, frontier: 15 },
  energy_belt:          { corporate: 30, authoritarian: 30, federation: 25, frontier: 15 },
  trade_nexus:          { corporate: 35, federation: 35, authoritarian: 20, frontier: 10 },
  contested_frontier:   { frontier: 40, authoritarian: 25, corporate: 20, federation: 15 },
  frontier_wilds:       { frontier: 50, corporate: 20, federation: 20, authoritarian: 10 },
};
```

Same coverage guarantee as current: if any government type is missing after all 8 regions are assigned, swap a duplicate.

#### Theme → name prefixes

```typescript
export const REGION_NAME_PREFIXES: Record<RegionTheme, string[]> = {
  garden_heartland:     ["Eden", "Verdant", "Harvest", "Pastoral"],
  mineral_frontier:     ["Forge", "Quarry", "Vein", "Lode"],
  industrial_corridor:  ["Foundry", "Assembly", "Crucible", "Works"],
  research_cluster:     ["Prism", "Cipher", "Archive", "Axiom"],
  energy_belt:          ["Helios", "Corona", "Flare", "Dynamo"],
  trade_nexus:          ["Nexus", "Haven", "Crossroads", "Confluence"],
  contested_frontier:   ["Rift", "Breach", "Disputed", "Fracture"],
  frontier_wilds:       ["Expanse", "Drift", "Outreach", "Fringe"],
};
```

---

## 5. Generation Pipeline

### Current flow (being replaced)

```
generateRegions()       → 8 regions with identity + government
generateSystems()       → 25 per region, economy via weightedPick(ECONOMY_TYPE_WEIGHTS[identity])
generateConnections()   → MST + extras, gateways
selectStartingSystem()  → trade_hub + core economy
```

### New flow

```
generateRegions()       → 8 regions with theme + government     (modified)
generateSystemTraits()  → 1-4 traits per system, quality tiers  (NEW)
deriveEconomyTypes()    → affinity scoring from traits           (NEW, replaces weighted pick)
enforceCoherence()      → 60% agreement, no monotony            (NEW)
generateConnections()   → unchanged
selectStartingSystem()  → trade_nexus + core economy             (minor update)
```

### 5.1 `generateRegions()` — Modified

Minimal changes: `RegionIdentity` → `RegionTheme`, `REGION_IDENTITIES` → `REGION_THEMES`, weight tables updated. Placement algorithm unchanged.

### 5.2 `generateSystemTraits()` — New

For each system in each region:

```
1. Determine trait count: randInt(rng, theme.min, theme.max)
2. Build weight table: start with base weight (5) for all 29 traits,
   overlay theme-specific weights from REGION_THEME_TRAIT_WEIGHTS
3. For each trait slot:
   a. weightedPick(rng, weights) → traitId
   b. Remove picked trait from weights (no duplicates)
   c. Roll quality: weightedPick(rng, { 1: 50, 2: 35, 3: 15 })
   d. Store { traitId, quality }
```

Output: `GeneratedTrait[]` per system.

```typescript
export interface GeneratedTrait {
  traitId: TraitId;
  quality: QualityTier;
}

// Extended GeneratedSystem
export interface GeneratedSystem {
  // ... existing fields
  traits: GeneratedTrait[];
  // economyType is now derived, not picked
}
```

### 5.3 `deriveEconomyTypes()` — New

For each system, score all 6 economy types against its traits:

```
For each economyType:
  score = sum of (traitAffinity[economyType] × quality) for all system traits

Winner = economyType with highest score
Tiebreaker = region theme preference (optional small bonus table)
```

**Tiebreaker table** — small bonus when theme aligns with economy type:

```typescript
export const THEME_ECONOMY_TIEBREAKER: Record<RegionTheme, Partial<Record<EconomyType, number>>> = {
  garden_heartland:    { agricultural: 1 },
  mineral_frontier:    { extraction: 1 },
  industrial_corridor: { industrial: 1 },
  research_cluster:    { tech: 1 },
  energy_belt:         { refinery: 1 },
  trade_nexus:         { core: 1 },
  contested_frontier:  {},  // no preference — mixed
  frontier_wilds:      { extraction: 1 },
};
```

The tiebreaker only matters for exact ties. Trait affinity × quality dominates.

**Edge case — no affinity**: Systems with only "dark_nebula" (no economy affinity) or other zero-affinity combinations default to extraction (the baseline "just scraping by" economy).

### 5.4 `enforceCoherence()` — New

After all systems have derived economies, validate region coherence:

```
For each region:
  1. Count economy types across its systems
  2. Find dominant economy (most common)
  3. If dominant < 60% of systems:
     → Re-roll traits for borderline systems (those where top-2 economy scores are close)
     → Only re-roll up to the minimum needed to hit 60%
     → Re-roll uses same theme weights, so results are still thematic
  4. If all systems have the same economy (monotonous):
     → Force one non-gateway system to a secondary economy
     → Pick the system with the strongest secondary affinity
  5. Gateway systems exempt — their economy is whatever traits give them
```

**Note on starting system**: No special protection needed during coherence enforcement. `selectStartingSystem()` runs *after* coherence and picks the best core system from the final results. Trade nexus theme weights virtually guarantee at least one core system exists.

**Implementation note**: Coherence enforcement should be rare if trait weights are tuned well. Log when it fires so we can tune weights to minimize intervention.

### 5.5 `selectStartingSystem()` — Minor update

```
Filter: region.theme === "trade_nexus" → system.economyType === "core"
Fallback: any region → core economy → nearest region center
```

---

## 6. Economy Processor Integration

### Production modifier from traits

In `lib/tick/processors/economy.ts`, when calculating per-good production:

```typescript
// Current: flat rate from ECONOMY_PRODUCTION table
const baseRate = getProductionRate(economyType, goodId) ?? 0;

// New: base rate × (1 + trait bonus)
const traitBonus = system.traits.reduce((sum, t) => {
  const def = TRAITS[t.traitId];
  if (def.productionGoods.includes(goodId)) {
    return sum + QUALITY_TIERS[t.quality].modifier;
  }
  return sum;
}, 0);
const effectiveRate = baseRate * (1 + traitBonus);
```

**Data loading**: The economy processor already loads system data per-region. Add a join to include `SystemTrait` records. Since traits are immutable, they're excellent candidates for caching (but not required at 200 systems).

### Consumption — unchanged

Consumption rates are not trait-modified in Layer 0. Traits affect what a system produces, not what it consumes. Consumption stays driven by economy type alone.

### Equilibrium targets — unchanged

Market initialization at seed time still uses the produces/consumes/neutral pattern from `EQUILIBRIUM_TARGETS`. The economy type (now trait-derived) determines which goods are produced/consumed. No change to the equilibrium setup.

---

## 7. Seed Script Changes

### `prisma/seed.ts`

The seed script calls the generation functions and writes to DB. Changes:

1. **Universe generation** now returns `GeneratedSystem` with `traits` array and derived `economyType`
2. **New DB writes**: After creating `StarSystem`, create `SystemTrait` records for each trait
3. **Market initialization**: Unchanged — still uses `economyType` to determine produces/consumes

```typescript
// New: write traits after system creation
for (const trait of sys.traits) {
  await prisma.systemTrait.create({
    data: {
      systemId: createdSystem.id,
      traitId: trait.traitId,
      quality: trait.quality,
    },
  });
}
```

---

## 8. UI/UX Changes

### 8.1 System Detail Page (`app/(game)/system/[systemId]/`)

**Current**: Shows system name, economy type, region, active events, market, missions.

**New**: Add a **Traits section** showing the system's traits with quality indicators.

```
┌──────────────────────────────────────────────┐
│ Nexus-7                                      │
│ Core Economy · Trade Nexus Region             │
│ Federation Government                         │
├──────────────────────────────────────────────┤
│ System Traits                                 │
│                                               │
│  ★★★ Ancient Trade Route                     │
│  Historically significant junction...         │
│                                               │
│  ★★☆ Habitable World                         │
│  Temperate world with established...          │
│                                               │
│  ★☆☆ Lagrange Stations                       │
│  Small orbital platforms at the...            │
├──────────────────────────────────────────────┤
│ Market    Missions    Activity                │
│ ...                                           │
└──────────────────────────────────────────────┘
```

**Components**:
- `TraitCard` or `TraitList` — displays traits with quality stars, name, description
- Quality shown as filled/empty stars (★★☆ for quality 2)
- Description varies by quality tier (from design doc tier descriptions)
- Category shown as subtle label or grouped visually

### 8.2 Map Tooltips

**Current**: System nodes show name, economy type (color), ship count, event badges.

**System view tooltip** — add trait summary on hover:
- Show trait count and top trait: "3 traits · ★★★ Asteroid Belt"
- Keeps tooltip compact; full details on the system detail page

### 8.3 System Description

**Current**: Systems have a generic empty description.

**New**: Auto-generate a description from traits at seed time. Combine trait descriptions (quality-appropriate) into a 1–2 sentence system description.

Example: *"A dense, mineral-rich asteroid belt dominates this system, complemented by several resource-bearing moons. Extraction operations supply raw materials to refineries across the region."*

### 8.4 Region Label & Dominant Economy

**Current**: Region identity shown as-is ("Trade Hub", "Resource Rich").

**New**: Region theme displayed ("Trade Nexus", "Mineral Frontier", etc.).

**Dominant economy label**: The most common economy type among a region's systems, stored as `dominantEconomy` on the Region model. Computed once at seed time.

Displayed as a subtitle: *"Trade Nexus — Core Economy"*.

**Layer 2 note**: When faction conquest changes a system's economy (via government affinity nudge, see design doc §2.2), `Region.dominantEconomy` must be re-derived. This is tracked in `MIGRATION-NOTES.md` §1.

---

## 9. API & Service Changes

### Read path — system detail

`lib/services/universe.ts` — system detail query needs to include traits:

```typescript
const system = await prisma.starSystem.findUnique({
  where: { id: systemId },
  include: {
    station: { include: { markets: true } },
    traits: true,  // NEW
    region: true,
  },
});
```

API response type extends to include trait data. New type:

```typescript
// lib/types/api.ts
export interface SystemTraitResponse {
  traitId: TraitId;
  quality: QualityTier;
  name: string;       // from TRAITS constant
  category: TraitCategory;
  description: string; // quality-appropriate description
}
```

### No new API routes needed

Traits are read-only, immutable, and always returned with system data. No separate `/api/game/traits` endpoint needed.

---

## 10. Testing & Validation

### Unit tests (Vitest)

- **Trait generation**: Given a theme and RNG seed, produces expected trait distributions
- **Affinity scoring**: Given specific traits, derives correct economy type
- **Coherence enforcement**: Edge cases — all same economy, no clear winner, gateway exemptions
- **Production modifiers**: Verify trait bonuses apply correctly in economy processor math
- **Quality distribution**: Over 1000 rolls, distribution matches 50/35/15 targets (±5%)

### Simulator experiments

- **Distribution validation**: Run generation across 20+ seeds. Verify:
  - Trait rarity: ~50% quality 1, ~35% quality 2, ~15% quality 3
  - Economy type distribution: no type dominates or is absent globally
  - Region coherence: every region hits 60% threshold, no monotonous regions
- **Economy comparison**: Run 500-tick simulation on old vs new generation. Compare:
  - Price distributions, trade route profitability, mission generation rates
  - New generation should produce similar macro-economics but more local variety
- **Scale test** (optional): Generate at 1000-2000 systems to validate generation time and verify trait distributions hold at scale

### Manual validation

- Seed and inspect the map. Do regions feel thematic? Are trait combinations interesting?
- Check a few systems: do trait descriptions make sense together? Does the derived economy feel right?
- Play a few trade runs — is the economy still healthy after the switch?

---

## 11. File Change Summary

### New files
| File | Purpose |
|---|---|
| `lib/constants/traits.ts` | TraitDefinition, TRAITS record, QUALITY_TIERS |
| `lib/engine/trait-gen.ts` | Pure functions: generateSystemTraits, deriveEconomyType, enforceCoherence |
| `components/ui/trait-list.tsx` | Trait display component (stars, name, description) |

### Modified files
| File | What changes |
|---|---|
| `lib/types/game.ts` | Add TraitId, TraitCategory, QualityTier, RegionTheme. Remove RegionIdentity |
| `lib/types/guards.ts` | Add toTraitId, toQualityTier, toRegionTheme guards. Update toRegionIdentity → toRegionTheme |
| `lib/constants/universe-gen.ts` | REGION_THEMES replaces REGION_IDENTITIES. Theme weight tables replace identity weight tables. Name prefixes updated |
| `lib/engine/universe-gen.ts` | generateRegions uses themes. generateSystems calls trait gen + economy derivation. GeneratedSystem gains traits |
| `lib/tick/processors/economy.ts` | Production rates modified by trait bonuses |
| `lib/services/universe.ts` | System queries include traits |
| `lib/types/api.ts` | SystemTraitResponse type, system detail response includes traits |
| `prisma/schema.prisma` | SystemTrait model, Region.identity type docs, StarSystem.traits relation |
| `prisma/seed.ts` | Write SystemTrait records, use new generation output |
| `app/(game)/system/[systemId]/` | Show traits section |
| `app/(game)/map/` | Tooltip updates, region label updates |

### Deleted / replaced
| What | Why |
|---|---|
| `RegionIdentity` type | Replaced by `RegionTheme` |
| `REGION_IDENTITIES` array | Replaced by `REGION_THEMES` |
| `ECONOMY_TYPE_WEIGHTS` table | Economy types now derived from traits, not picked from weights |

---

## 12. Implementation Phases

Ordered steps. Each phase produces a testable artifact.

### Phase 1: Constants & types
- Define TraitId, TraitCategory, QualityTier, RegionTheme types
- Build TRAITS constant with all 29 definitions
- Build QUALITY_TIERS constant
- Add guards (toTraitId, toQualityTier, toRegionTheme)
- **Test**: Type-check passes, guards work

### Phase 2: Generation engine
- Implement generateSystemTraits() — trait rolling per system
- Implement deriveEconomyType() — affinity scoring
- Implement enforceCoherence() — region validation
- Update generateRegions() for themes
- Wire into generateSystems() / generateUniverse()
- **Test**: Vitest — distribution validation, economy derivation, coherence edge cases

### Phase 3: Schema & seed
- Add SystemTrait model to Prisma schema
- Update Region.identity docs for themes
- Update seed script to write traits
- Run `prisma db push` + `prisma db seed`
- **Test**: Seed completes, traits in DB, economy types derived correctly

### Phase 4: Economy processor
- Wire trait production modifiers into economy tick
- Load traits in economy processor region query
- **Test**: Simulator run — economy still healthy, trait-rich systems produce more

### Phase 5: UI
- Build trait display component
- Add traits to system detail page
- Update map tooltips and region labels
- Generate system descriptions from traits
- **Test**: Manual — browse map, check system pages, verify traits display correctly

### Phase 6: Validation & tuning
- Run simulator experiments across multiple seeds
- Compare old vs new economy distributions
- Tune weights if distributions are off
- **Done**: PR to main
