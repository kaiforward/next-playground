# Layer 0 — System Enrichment Implementation

Enriches the physical universe with traits, quality tiers, and bottom-up economy derivation. No new gameplay systems — richer world generation that creates the foundation every later layer builds on.

**Design doc**: [system-enrichment.md](../planned/system-enrichment.md) §1–2 (trait catalog, affinity scoring)

**Transition**: Clean cut. Old world generation replaced wholesale. Reseed the universe.

---

## 1. Scope

### In scope
- 42 system traits across 5 categories with quality tiers (1–3)
- Strong-affinity-only economy derivation with guaranteed strong-affinity first roll
- RegionTheme concept removed — 24 regions with flat name pool, neutral styling
- Uniform trait count (2–4) for all systems, uniform government distribution (25% each)
- Trait production modifiers on economy processing
- UI: traits visible on system detail page, neutral region palette with economy-coloured labels
- Simulator experiments to validate distributions

### Out of scope (later layers)
- Facilities (§5) — Layer 2
- Faction influence on economy derivation (§2.2) — Layer 2
- ~~Trait-based danger modifiers~~ — **Done** (wired into ship-arrivals processor + simulator)
- Trait-gated event spawning (§4 events) — Layer 3
- Core economy exception via graph connectivity (§2.3 connectivity rule) — deferred, trait scoring handles core placement well enough for 600 systems

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
  dominantEconomy  String  // NEW — most common EconomyType among the region's systems. Computed at seed, re-derived in Layer 2 after conquest.
  // governmentType stays — government assignment still per-region until factions ship
  // identity field REMOVED — RegionTheme concept deleted
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
  // Planetary Bodies (12)
  | "habitable_world"
  | "ocean_world"
  | "volcanic_world"
  | "frozen_world"
  | "tidally_locked_world"
  | "desert_world"
  | "jungle_world"
  | "geothermal_vents"
  | "hydrocarbon_seas"
  | "fertile_lowlands"
  | "coral_archipelago"
  | "tectonic_forge"
  // Orbital Features (8)
  | "asteroid_belt"
  | "gas_giant"
  | "mineral_rich_moons"
  | "ring_system"
  | "binary_star"
  | "lagrange_stations"
  | "captured_rogue_body"
  | "deep_space_beacon"
  // Resource Deposits (9)
  | "rare_earth_deposits"
  | "heavy_metal_veins"
  | "organic_compounds"
  | "crystalline_formations"
  | "helium3_reserves"
  | "exotic_matter_traces"
  | "radioactive_deposits"
  | "superdense_core"
  | "glacial_aquifer"
  // Phenomena & Anomalies (9)
  | "nebula_proximity"
  | "solar_flare_activity"
  | "gravitational_anomaly"
  | "dark_nebula"
  | "precursor_ruins"
  | "subspace_rift"
  | "pulsar_proximity"
  | "ion_storm_corridor"
  | "bioluminescent_ecosystem"
  // Infrastructure & Legacy (7)
  | "ancient_trade_route"
  | "generation_ship_wreckage"
  | "orbital_ring_remnant"
  | "seed_vault"
  | "colonial_capital"
  | "free_port_declaration"
  | "shipbreaking_yards";

export type TraitCategory =
  | "planetary"
  | "orbital"
  | "resource"
  | "phenomena"
  | "legacy";

export type QualityTier = 1 | 2 | 3;

// RegionTheme type DELETED — themes removed entirely
// RegionIdentity type DELETED — replaced by nothing
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
  dangerModifier?: number;       // base danger adjustment (wired into ship-arrivals + simulator)
  negative?: boolean;            // has downsides (volcanic, radioactive, etc.)
}
```

**Tiered descriptions**: Each trait defines 3 flavour strings — one per quality tier. These are the source for system detail page display and auto-generated system descriptions. Example for `asteroid_belt`:
- Tier 1: *"A sparse debris field orbits the outer system, yielding modest mineral deposits."*
- Tier 2: *"A substantial asteroid belt provides steady ore extraction and metallic resources."*
- Tier 3: *"A dense, mineral-rich belt stretches across the system — one of the richest extraction sites in the sector."*

**Economy affinity values** come directly from the design doc tables. Each trait has 0–3 economy types it's relevant to, scored 1 (minor) or 2 (strong). See [system-enrichment.md §1.1](../planned/system-enrichment.md) for the full catalog.

**Compact reference table** (affinities only — descriptions in design doc). Strong affinities (2) drive economy derivation per §2.1; minor affinities (1) are flavour/production only.

| Trait | agri | extr | refi | indu | tech | core | Prod. goods |
|---|---|---|---|---|---|---|---|
| habitable_world | **2** | — | — | — | — | **2** | food |
| ocean_world | **2** | 1 | — | — | — | — | food, water |
| volcanic_world | — | **2** | 1 | — | — | — | ore, chemicals |
| frozen_world | — | 1 | — | — | — | — | water |
| tidally_locked_world | — | 1 | — | — | 1 | — | ore |
| desert_world | — | 1 | — | 1 | — | — | ore |
| jungle_world | 1 | — | — | — | 1 | — | food, chemicals |
| geothermal_vents | — | 1 | **2** | — | — | — | fuel, chemicals |
| hydrocarbon_seas | — | 1 | **2** | — | — | — | chemicals, fuel |
| fertile_lowlands | **2** | — | — | — | — | — | food |
| coral_archipelago | **2** | 1 | — | — | — | — | food, water |
| tectonic_forge | — | 1 | — | **2** | — | — | metals, machinery |
| asteroid_belt | — | **2** | — | — | — | — | ore, metals |
| gas_giant | — | **2** | 1 | — | — | — | fuel |
| mineral_rich_moons | — | 1 | — | 1 | — | — | ore |
| ring_system | — | 1 | — | — | — | — | water |
| binary_star | — | — | **2** | — | 1 | — | fuel, chemicals |
| lagrange_stations | — | — | — | **2** | — | 1 | machinery |
| captured_rogue_body | — | 1 | — | — | 1 | — | ore |
| deep_space_beacon | — | — | — | — | — | **2** | — |
| rare_earth_deposits | — | 1 | — | — | **2** | — | electronics |
| heavy_metal_veins | — | 1 | — | **2** | — | — | metals, weapons |
| organic_compounds | 1 | — | 1 | — | — | — | chemicals, medicine |
| crystalline_formations | — | 1 | — | — | **2** | — | electronics |
| helium3_reserves | — | 1 | **2** | — | — | — | fuel |
| exotic_matter_traces | — | — | — | — | **2** | — | electronics |
| radioactive_deposits | — | 1 | — | 1 | — | — | fuel, chemicals |
| superdense_core | — | **2** | — | — | — | — | ore, metals |
| glacial_aquifer | — | **2** | — | — | — | — | water, chemicals |
| nebula_proximity | — | 1 | — | — | 1 | — | chemicals |
| solar_flare_activity | — | — | 1 | — | — | — | fuel |
| gravitational_anomaly | — | — | — | — | **2** | — | — |
| dark_nebula | — | — | — | — | — | — | — |
| precursor_ruins | — | — | — | — | **2** | 1 | electronics |
| subspace_rift | — | — | — | — | **2** | — | — |
| pulsar_proximity | — | — | — | 1 | 1 | — | electronics |
| ion_storm_corridor | — | — | **2** | — | — | — | chemicals |
| bioluminescent_ecosystem | **2** | — | — | — | 1 | — | food, medicine |
| ancient_trade_route | — | — | — | 1 | — | **2** | luxuries |
| generation_ship_wreckage | — | 1 | — | 1 | — | — | metals |
| orbital_ring_remnant | — | — | — | **2** | — | 1 | machinery |
| seed_vault | **2** | — | — | — | 1 | — | food, textiles |
| colonial_capital | — | — | — | 1 | — | **2** | luxuries |
| free_port_declaration | — | — | — | — | — | **2** | luxuries, textiles |
| shipbreaking_yards | — | 1 | — | **2** | — | — | metals, weapons |

**Strong affinity count per economy**: tech 6, agricultural 6, extraction 5, industrial 5, refinery 5, core 5. This balance ensures even economy distribution without enforcement.

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

### 4.3 Universe Generation Config — `lib/constants/universe-gen.ts`

RegionTheme removed. All theme-keyed exports deleted (`REGION_THEMES`, `REGION_NAME_PREFIXES`, `GOVERNMENT_TYPE_WEIGHTS`, `REGION_THEME_TRAIT_COUNT`). Replaced with:

#### Region count & map size

```typescript
export const UNIVERSE_GEN = {
  REGION_COUNT: 24,       // was 8
  SYSTEMS_PER_REGION: 25, // unchanged — 24 × 25 = 600 total systems
  MAP_SIZE: 7000,         // was 4000 — usable area ~4900² fits 24 regions at 800 min distance
  // ...
};
```

#### Flat name pool

```typescript
export const REGION_NAMES: string[] = [
  "Arcturus", "Meridian", "Vanguard", "Horizon", "Zenith", "Solace",
  "Pinnacle", "Tempest", "Bastion", "Frontier", "Aegis", "Nebula",
  "Eclipse", "Sentinel", "Cascade", "Vertex", "Rift", "Threshold",
  "Citadel", "Expanse", "Dominion", "Prism", "Crucible", "Nexus",
  "Forge", "Drift", "Axiom", "Haven",
];
```

28 generic space names (24 + 4 extras for collision fallback). Picked sequentially from the pool; `-N` suffix on collision. Not economy-biased — narrative variety comes from traits.

#### Uniform trait count

```typescript
export const TRAIT_COUNT = { min: 2, max: 4 } as const;
```

All systems get 2–4 traits. No more sparse 1–2 frontier systems. Every system gets a clear economy signal from the guaranteed strong-affinity first roll.

#### Uniform government distribution

Government is now uniform 25% per type: `weightedPick(rng, { federation:1, corporate:1, authoritarian:1, frontier:1 })`. With 24 regions, all 4 types are virtually guaranteed. Simplified coverage check kept as safety net.

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
generateRegions()       → 24 regions with government (no theme)  (simplified)
generateSystemTraits()  → 2-4 traits per system, quality tiers   (NEW, guaranteed strong-affinity first roll)
deriveEconomyTypes()    → strong-affinity scoring from traits     (NEW, replaces weighted pick)
generateConnections()   → unchanged
selectStartingSystem()  → centrality-based (closest to map center)(rewritten)
```

**No coherence enforcement step.** Balanced strong affinity counts (5–6 per economy type) and the guaranteed strong-affinity first roll produce naturally varied regions without post-hoc correction.

### 5.1 `generateRegions()` — Simplified

Signature: `generateRegions(rng, params, names: string[])`. Names picked sequentially from flat pool. Government uniform 25% with coverage guarantee. No theme assignment.

### 5.2 `generateSystemTraits()` — New

For each system in each region:

```
1. Determine trait count: randInt(rng, TRAIT_COUNT.min, TRAIT_COUNT.max)
2. Build uniform weight table: weight 1 for all 45 traits (no theme bias)
3. FIRST TRAIT (guaranteed strong-affinity roll):
   a. Filter to only traits with at least one strong (value 2) affinity
   b. weightedPick(rng, filteredWeights) → traitId
   c. Remove picked trait from weights (no duplicates)
   d. Roll quality: weightedPick(rng, { 1: 50, 2: 35, 3: 15 })
   e. Store { traitId, quality }
4. REMAINING TRAITS (from full pool):
   a. weightedPick(rng, weights) → traitId
   b. Remove picked trait from weights (no duplicates)
   c. Roll quality: weightedPick(rng, { 1: 50, 2: 35, 3: 15 })
   d. Store { traitId, quality }
```

The guaranteed strong-affinity first roll ensures every system has a clear economy signal. No system falls through to fallback logic.

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

For each system, score all 6 economy types using **strong affinities only** (value 2):

```
For each economyType:
  score = sum of (quality) for all system traits WHERE traitAffinity[economyType] === 2

Winner = economyType with highest score
Tiebreaker = seeded random selection (no theme bias)
```

Minor affinities (value 1) are ignored for derivation. They still affect production modifiers and serve as flavour connections.

**Edge case — no strong affinity**: With the guaranteed strong-affinity first roll (§5.2), this should never occur. If it does (e.g., a system somehow has only `dark_nebula`), fallback to extraction.

### 5.4 `selectStartingSystem()` — Rewritten

Centrality-based selection (no theme dependency):

```
1. Find region closest to map center (mapSize/2, mapSize/2)
2. Within that region, find systems with core economy
3. Pick the core system closest to the region center
4. Fallback: if no core system, pick system closest to region center regardless of economy
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

**Data loading**: The economy processor already loads system data per-region. Add a join to include `SystemTrait` records. Since traits are immutable, they're excellent candidates for caching (but not required at 600 systems).

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

**New**: Region name displayed with neutral slate palette. Economy shown as small coloured label using `ECONOMY_LABEL_COLOR` lookup (derived from `ECONOMY_BADGE_COLOR` pattern).

**Dominant economy label**: The most common economy type among a region's systems, stored as `dominantEconomy` on the Region model. Computed once at seed time.

Displayed as a subtitle: *"Arcturus — Core Economy"*.

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

- **Trait generation**: Given an RNG seed, produces expected trait distributions
- **Guaranteed strong-affinity roll**: First trait always has at least one strong (value 2) affinity
- **Affinity scoring**: Given specific traits, derives correct economy type using strong affinities only
- **Production modifiers**: Verify trait bonuses apply correctly in economy processor math
- **Quality distribution**: Over 1000 rolls, distribution matches 50/35/15 targets (±5%)

### Simulator experiments

- **Distribution validation**: Run generation across 20+ seeds. Verify:
  - Trait rarity: ~50% quality 1, ~35% quality 2, ~15% quality 3
  - Economy type distribution: no type dominates or is absent globally, reasonably even spread
  - Every system has at least one strong-affinity trait
  - No economy type accounts for >30% or <10% of systems (approximate targets for 6 types)
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
| `lib/constants/traits.ts` | TraitDefinition, TRAITS record (45 traits), QUALITY_TIERS |
| `lib/engine/trait-gen.ts` | Pure functions: generateSystemTraits (with guaranteed strong roll), deriveEconomyType (strong-affinity-only) |
| `components/ui/trait-list.tsx` | Trait display component (stars, name, description) |
| `scripts/validate-distributions.ts` | Multi-seed distribution validation script |

### Modified files
| File | What changes |
|---|---|
| `lib/types/game.ts` | Add TraitId, TraitCategory, QualityTier. Delete RegionTheme. Remove identity from RegionInfo |
| `lib/types/guards.ts` | Add toTraitId, toQualityTier guards. Delete REGION_THEMES, toRegionTheme, ALL_REGION_THEMES |
| `lib/constants/universe-gen.ts` | Delete 4 theme exports. Add REGION_NAMES (flat pool), TRAIT_COUNT. REGION_COUNT 8→24, MAP_SIZE 4000→7000 |
| `lib/constants/ui.ts` | Delete REGION_THEME_BADGE_COLOR |
| `lib/engine/trait-gen.ts` | Simplified `generateSystemTraits(rng)` — no theme param, uniform TRAIT_COUNT |
| `lib/engine/universe-gen.ts` | Simplified signatures, centrality-based starting system, uniform government |
| `lib/tick/processors/economy.ts` | Production rates modified by trait bonuses |
| `lib/services/universe.ts` | System queries include traits, remove identity from region select |
| `lib/types/api.ts` | SystemTraitResponse type, system detail response includes traits |
| `prisma/schema.prisma` | SystemTrait model, remove identity from Region, StarSystem.traits relation |
| `prisma/seed.ts` | Write SystemTrait records, use new generation output |
| `components/map/region-node.tsx` | Neutral slate palette, economy-coloured label |
| `lib/hooks/use-map-graph.ts` | Remove identity from node data |
| `lib/engine/simulator/` | Remove identity from types, world, runner |
| `scripts/simulate.ts` | Remove Identity column |
| `scripts/validate-distributions.ts` | Update generateUniverse call, use region.name |
| `app/(game)/system/[systemId]/` | Show traits section, remove identity display |

### Deleted / replaced
| What | Why |
|---|---|
| `RegionTheme` type + guards | Themes removed entirely — regions are neutral |
| `REGION_THEMES`, `REGION_NAME_PREFIXES` | Replaced by flat `REGION_NAMES` pool |
| `GOVERNMENT_TYPE_WEIGHTS` | Uniform 25% distribution |
| `REGION_THEME_TRAIT_COUNT` | Uniform `TRAIT_COUNT = { min: 2, max: 4 }` |
| `REGION_THEME_BADGE_COLOR` | Neutral slate palette for all regions |
| `ECONOMY_TYPE_WEIGHTS` table | Economy types now derived from traits, not picked from weights |

---

## 12. Implementation Phases

Ordered steps. Each phase produces a testable artifact.

### Phase 1: Constants & types ✅
- Define TraitId, TraitCategory, QualityTier types
- Build TRAITS constant with 29 initial definitions
- Build QUALITY_TIERS constant
- Add guards (toTraitId, toQualityTier)
- RegionIdentity → RegionTheme rename

### Phase 2: Generation engine ✅
- Implement generateSystemTraits() — trait rolling per system
- Implement deriveEconomyType() — affinity scoring (all affinities)
- Implement enforceCoherence() — region validation (60% threshold)
- Update generateRegions() for themes
- Wire into generateSystems() / generateUniverse()

### Phase 3: Schema & seed ✅
- Add SystemTrait model to Prisma schema
- Update Region model for themes, add dominantEconomy
- Update seed script to write traits
- Run `prisma db push` + `prisma db seed`

### Phase 4: Economy processor ✅
- Wire trait production modifiers into economy tick (real + simulator)
- Load traits in economy processor region query

### Phase 5: UI ✅
- Build TraitList component (full + compact variants, quality stars)
- Add traits card to system detail page overview
- Add compact traits to map system detail panel
- Show dominant economy on region nodes

### Phase 6: Validation — revealed design issue ✅
- Built multi-seed distribution validation script (`scripts/validate-distributions.ts`)
- Validated across 25 seeds: quality tiers on target (49.5/35.3/15.2)
- **Issue found**: 36% of regions fail 60% coherence threshold
- Root cause: enforcing economy clustering via coherence is fighting the trait diversity that makes systems interesting
- Decision: rework derivation to use strong affinities only, add 13 new traits for balance, remove coherence enforcement

### Phase 7: Generation rework ✅
- Add 13 new traits to `lib/constants/traits.ts` (42 total)
- Add 13 new TraitIds to `lib/types/game.ts` + guards
- Update `generateSystemTraits()` — guaranteed strong-affinity first roll
- Update `deriveEconomyType()` — strong affinities only (value 2), seeded random tiebreaker
- Remove `enforceCoherence()` from generation pipeline
- Flatten theme weights (2–3× bias, not 6×)
- Remove `THEME_ECONOMY_TIEBREAKER` table
- Re-run validation — even economy spread (14.3–18.6%, ideal 16.7%)
- 405 tests passing, build clean

### Phase 8: Theme removal & 24-region expansion ✅
- Delete `RegionTheme` type, guards, and all theme-keyed constants
- Expand from 8 → 24 regions (600 systems), MAP_SIZE 4000 → 7000
- Flat `REGION_NAMES` pool (28 generic space names)
- Uniform trait count `{ min: 2, max: 4 }` for all systems
- Uniform government distribution (25% each)
- Centrality-based starting system (region closest to map center → core economy)
- Neutral slate UI palette for region nodes, economy-coloured labels
- Remove `identity` from Region schema, all types, services, simulator, scripts
- Re-seed: 24 regions, 600 systems, 1778 connections, 1787 traits
- 403 tests passing, build clean

### Phase 9: Documentation & PR
- Update implementation doc and design spec
- **Done**: PR to main
