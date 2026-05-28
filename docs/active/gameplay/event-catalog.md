# Event Catalog

Event arcs and shocks that work with the existing event system. Each entry is a new `EventDefinition` — no engine or processor changes required. Add to `lib/constants/events.ts` and they just work.

Events with entries in `EVENT_MISSION_GOODS` (also in `events.ts`) automatically generate trade missions for their themed goods. Currently mapped: war, plague, trade_festival, mining_boom, supply_shortage, pirate_raid, solar_storm, refugee_crisis, trade_embargo, tech_breakthrough, asteroid_strike. New events get missions by adding a mapping entry.

For speculative event concepts that aren't built yet, see [event-ideas.md (planned)](../../planned/event-ideas.md). For ideas that require new engine mechanics, see [simulation-enhancements.md](../../archive/simulation-enhancements.md).

## Implemented

These events are live in `lib/constants/events.ts`.

### War

Target: Industrial, tech, extraction, core systems. Multi-phase arc with spread.

| Phase | Duration | Economy Modifiers | Navigation | Spread |
|-------|----------|-------------------|------------|--------|
| **Tensions** | 30-60 | Fuel demand +20, machinery demand +30 | — | — |
| **Escalation** | 20-40 | Fuel demand +50, machinery +50, production x0.7 | Danger 0.05 | — |
| **Active Conflict** | 80-150 | Fuel demand +80, machinery +60, production x0.4, reversion x0.5 | Danger 0.15 | conflict_spillover |
| **Aftermath** | 50-100 | Electronics demand +50, food +40, production x0.7 | Danger 0.03 | — |
| **Recovery** | 40-80 | Lingering demand shifts at 30% | — | — |

Player opportunity: Stockpile machinery during tensions, sell during active conflict. Deliver food/electronics during aftermath.

### Plague / Blight

Target: Agricultural systems. Multi-phase arc with spread.

| Phase | Duration | Economy Modifiers | Navigation | Spread |
|-------|----------|-------------------|------------|--------|
| **Outbreak** | 20-40 | Food production x0.3, food supply shock -30 | — | — |
| **Spreading** | 40-80 | Food production x0.2, medicine demand +40 | Danger 0.03 | plague_risk |
| **Containment** | 30-60 | Food production x0.5, medicine demand +20 | — | — |
| **Recovery** | 40-60 | Food production x0.8, reversion x0.6 | — | — |

Player opportunity: Rush food imports. Sell medicine. Secondary profit at neighbouring agricultural systems.

### Trade Festival

Target: Core systems. Single-phase event. Weight 8, cooldown 120.

| Phase | Duration | Economy Modifiers |
|-------|----------|-------------------|
| **Festival** | 40-80 | Luxury demand +60, food demand +30, all demand +15 |

Player opportunity: Sell luxuries and food at premium prices.

### Mining Boom

Target: Extraction systems. Multi-phase arc with spread. Weight 10, cooldown 100.

| Phase | Duration | Economy Modifiers | Spread |
|-------|----------|-------------------|--------|
| **Discovery** | 20-30 | Ore supply +60, ore production x1.5 | — |
| **Boom** | 60-100 | Ore supply +80, ore production x2.0, food demand +30, luxury demand +40 | ore_glut in region |
| **Peak** | 40-60 | Ore production x1.8, food demand +50 | — |
| **Depletion** | 60-100 | Ore production x0.6, ore supply -20 | — |

Player opportunity: Buy cheap ore during boom, sell to industrial systems. Sell food/luxuries to booming system. After depletion, the system is worse off — avoid buying ore there.

### Supply Shortage

Target: Any system. Single-phase shock event. Weight 8, cooldown 80.

| Phase | Duration | Economy Modifiers |
|-------|----------|-------------------|
| **Shortage** | 30-60 | All supply -25, all demand +25, reversion x0.7, food/fuel supply shock -20 |

Player opportunity: Deliver goods (especially food and fuel) for premium prices.

### Pirate Raid

Target: Any system. Two-phase arc. Weight 8, cooldown 80.

| Phase | Duration | Economy Modifiers | Navigation |
|-------|----------|-------------------|------------|
| **Raiding** | 40-80 | All supply -15, weapons demand +30 | Danger 0.15 |
| **Crackdown** | 20-40 | Machinery demand +25 | Danger 0.03 |

Player opportunity: Avoid the system during raiding (or risk cargo loss for discounted goods). Supply machinery during crackdown.

### Solar Storm

Target: Any system. Short, intense two-phase event. Weight 6, cooldown 40.

| Phase | Duration | Economy Modifiers | Navigation |
|-------|----------|-------------------|------------|
| **Storm** | 15-30 | All production x0.1 | Danger 0.25 |
| **Clearing** | 10-20 | Production x0.6, reversion x0.5 | — |

Player opportunity: Avoid during storm, rush in during clearing to buy goods at disrupted prices before reversion kicks in.

### Conflict Spillover (child event)

Spawned by War spread. Reduced severity (0.3x).

### Plague Risk (child event)

Spawned by Plague spread at neighbouring agricultural systems. Reduced severity (0.3x).

### Ore Glut (child event)

Spawned by Mining Boom spread. Reduced severity (0.4x). Ore supply surplus depresses local prices.

### Refugee Crisis

Target: Core, agricultural systems. Multi-phase arc with spread. Weight 8, cooldown 100.

| Phase | Duration | Economy Modifiers | Navigation | Spread |
|-------|----------|-------------------|------------|--------|
| **Influx** | 20-40 | Food demand +60, medicine demand +40, food supply shock -30% | — | — |
| **Overcrowding** | 40-80 | Food demand +100, medicine demand +80, production x0.7 | Danger 0.08 | plague_risk in region |
| **Settlement** | 30-60 | Food demand +30, medicine demand +15 | — | — |

Player opportunity: Rush food and medicine imports during influx/overcrowding. High demand creates premium prices. Watch for plague spreading to agricultural neighbors.

### Trade Embargo

Target: Core, industrial systems. Multi-phase arc. Weight 6, cooldown 120.

| Phase | Duration | Economy Modifiers |
|-------|----------|-------------------|
| **Imposed** | 20-40 | All supply x0.6, all demand +40, production x0.7 |
| **Enforcement** | 40-80 | All supply x0.4, all demand +70, production x0.5, reversion x0.4, electronics/machinery supply shock -50% |
| **Easing** | 30-60 | All supply x0.8, all demand +20 |

Player opportunity: Deliver electronics and machinery during enforcement for massive premiums. All goods are profitable due to blanket supply suppression.

### Tech Breakthrough

Target: Tech systems. Multi-phase arc (positive event). Weight 7, cooldown 120.

| Phase | Duration | Economy Modifiers |
|-------|----------|-------------------|
| **Discovery** | 15-30 | Electronics production x1.5, machinery demand +40 |
| **Innovation** | 40-80 | Electronics production x2.5, electronics supply +80, machinery demand +80 |
| **Adoption** | 30-60 | Electronics production x1.5, electronics supply +30, machinery demand +20 |

Player opportunity: Buy cheap electronics during innovation phase, sell to systems that need them. Deliver machinery to the tech system for good prices.

### Asteroid Strike

Target: Extraction systems. Multi-phase arc. Weight 5, cooldown 80.

| Phase | Duration | Economy Modifiers | Navigation |
|-------|----------|-------------------|------------|
| **Impact** | 10-20 | All production x0.05, ore supply shock -70%, fuel supply shock -50% | Danger 0.25 |
| **Aftermath** | 40-80 | All production x0.3, machinery demand +80 | — |
| **Recovery** | 30-60 | All production x0.7 | — |

Player opportunity: Avoid during impact (extreme danger). Deliver machinery during aftermath for high rewards. Salvage and recon missions spawn here.
