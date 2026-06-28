# Layering-Contract Audit — SP5 (Faction Agency) & War vs the Substrate

> **Working analysis doc** (not a build plan, not yet a spec). Purpose: check whether the shipped
> economy substrate exposes the primitives the planned SP5 (faction agency) and war systems need —
> prompted by the question "did substrate-v2 fail to make facilities discrete?" Conclusions should
> fold into the eventual SP5 design (→ `docs/planned/`). Delete once that spec absorbs it.
>
> Sources audited: `docs/planned/economy-simulation-vision.md` (§5, §10, §12, §13, §14 — the
> authoritative SP4/SP5 design), the shipped SP3 model (`docs/active/gameplay/economy.md` + `system-traits.md`) (SP3 §2, §15 —
> the discrete-vs-abstract decision + deferral list), `docs/planned/war-system.md`,
> `docs/active/gameplay/economy-substrate-v2-available-space.md`, `docs/active/gameplay/faction-system.md`,
> `prisma/schema.prisma`, `lib/engine/industry.ts`, `lib/engine/industry-seed.ts`,
> `lib/tick/adapters/prisma/{economy,population}.ts`, `lib/services/{factions,topology,reputation}.ts`.

---

## Headline

1. **The discreteness worry is a non-problem.** Abstract per-type `SystemBuilding.count: Float` is a
   *deliberate* design choice (SP3 §2), and **both** SP5 (build planner = `count += Δ`) and war
   (razing = `count -= Δ`, matching war's own percentage-based effect model) were specced to operate
   on it. No discreteness is required in the economic substrate; we do **not** need to reopen
   substrate-v2 or its calibration. Genuine discreteness lives only in *separate* layers (strategic
   military facilities, player-owned facilities, military-project unlock thresholds).
2. **The real linchpin is the faction treasury.** A monetary-only faction treasury funded by a
   throughput tax is fully designed (vision §12.1) but **100% unbuilt** — the `Faction` model has no
   financial fields. It gates most of SP5 and all of war's cost mechanics. The instinct to "introduce
   faction funds" is correct and already-designed; it just needs building.
3. **None of the actual blocking gaps are about discreteness.** They are additive primitives on top
   of a sound continuous substrate (treasury, runtime build-out, ownership mutation, labour
   allocation, military/construction channel).

---

## 1. The discreteness question — resolved

**The economic substrate is continuous by design, and that is correct for SP5 + war.**

- SP3 §2 (locked decision): *"Building representation: Abstract per-type count, not entities. A
  `(system, buildingType)` row stores a single `count: Float`. No per-facility rows, no construction
  state, no ownership… Entity-level facilities (owned, constructed, upgradeable, seizable) belong to
  player-facilities/SP5, where there is an actor to own them."*
- Production math is continuous end-to-end: `production = count × outputPerUnit × labourFulfillment ×
  yieldMult` (`lib/engine/industry.ts`). Population is an explicitly continuous magnitude ("a tiny
  outpost is `pop 0.3`, never rounded down" — substrate-v2 spec).
- War's own effect model is **fractional/percentage** ("−30–40% all goods, +50–60% volatility" —
  war-system.md §10), so "war degrades industrial capacity" is naturally `count -= Δ` or a multiplier.

**Where genuine discreteness *does* live (all separate from the economic substrate):**
- **Directed-logistics order record** — a transient faction command object (source, sink, volume,
  capital, duration; vision §12.2). Discrete record, continuous payload.
- **Military-project unlock thresholds** — a discrete gate ("need a large enough base before you can
  attempt capital ships"; vision §12.4), but evaluated as a *read* over the continuous building-count
  vector. Thresholds deferred (§14).
- **Strategic military facilities** (Naval Base / Shipyard / Defence Platform) — a *tiered, discrete*
  layer (Layer-2 Sub-Project 2), separate from production buildings; war's deferred facility-damage
  degrades their tier.
- **Player-owned facilities** — owned/constructed/seizable entities, their own planned layer.

**Implication for the Industry UI:** since the model is deliberately continuous, the gamified Industry
tab has a genuine choice — embrace a continuous *capacity/fill* framing (honest to the model), or
render discretized cells as a deliberate *metaphor*. Discrete-cell treatment is most truthful when
applied to the layers that are actually discrete (strategic facilities, player facilities) once they
exist. This is a design decision to make, not a bug to fix. (See Open Points.)

---

## 2. The real blocking gaps (the layering-contract result)

| # | Missing primitive | Status | Blocks | Risk |
|---|---|---|---|---|
| G1 | **Faction treasury + throughput/sales tax + budget bands** | Greenfield — designed vision §12.1, **zero** schema/collection/spend | SP5 construction spend, directed logistics, military upkeep; war's credit drain & war fund | High impact, self-contained |
| G2 | **Runtime build-out path** — `SystemBuilding` is written only at seed (`prisma/seed.ts`), read-only every tick | Shape is right (`count: Float`, build-space columns exist on `StarSystem`); no write path, and nothing reads `availableSpace/general/habitable` to *gate* a write | SP5 build planner (Op A), autonomic drift (Op I), colonisation (Op B) | Lowest-risk — primitive exists, just frozen; needs batched per-tick writes (Prisma N+1 gotcha) |
| G3 | **Runtime `factionId` reassignment** — written only at seed; **and** `topology.ts` `getOpenEdges()` cache is built once per process and never invalidated | Missing + a live integration trap | War capture (§5.8), rebellion (§7); trade-flow/migration topology won't update on ownership change | Medium — concrete bug-in-waiting |
| G4 | **Explicit labour allocation / priority** — labour is one uniform `min(1, pop/labourDemand)` ratio (`industry.ts:44`), never stored, applied to all buildings equally | Missing (additive term planned, SP3 §15) | SP5 labour-priority policy (Op C); your "factions choose where labour goes / idle facilities" | Low — additive over existing ratio |
| G5 | **Military-output quantity + construction/military demand channel** (vision §5.1 channel 3, §12.4) | Designed, deferred (SP3 §15; faction-system.md "Military Output… not implemented") | War power, military-as-industrial-ceiling, war-goods demand | Medium |
| G6 | **War physical-destruction ops** (sabotage, facility damage) | Thinnest part of war-system.md; `layer-2-war.md` "to be written" | "raze infra → strand workers"; sabotage | Spec gap, not a substrate gap |

---

## 3. What already exists and layers fine (don't rebuild)

- **System ownership** — `StarSystem.factionId` (nullable FK). Shape is right; just needs a runtime writer (G3).
- **Build-space headroom** — substrate-v2 `availableSpace / generalSpace / habitableSpace / slot*` columns
  on `StarSystem`; "built ≤ available" is explicit ("the room faction build-out grows into").
- **Building-count vector for the military ceiling** — `SystemBuilding` is queryable per system; faction
  territory via `factionId`. The ceiling is a *read* over the continuous base — no new state.
- **Infrastructure vs population independence** — separate records (`SystemBuilding` rows incl. `"housing"`
  vs the `StarSystem.population` magnitude). "High pop, nowhere to work" is *representable today*; it's just
  *unspecified* by the war doc (G6).
- **Doctrine/government weighting** — `Faction.governmentType` + `doctrine` shipped; government already
  modulates markets (`lib/constants/government.ts`).
- **Unrest** — `StarSystem.unrest` accumulates correctly; rebellion just needs a threshold→`factionId` consequence (G3/G5).
- **Diffusion flow boundary** — already faction-bounded (SP2); SP5 opens it by relation score.

---

## 4. SP5 faction → economy operations (contract)

All from `economy-simulation-vision.md` §12 unless noted. "Discrete?" = does it require discrete whole units.

| Op | Operation | Primitive needed | Exists? | Discrete? |
|---|---|---|---|---|
| A | Build production/extraction/housing at runtime (build planner, §12.3) | Mutable `count` write path + build-space gate | Shape yes, path **no** (G2) | No (`count += Δ`) |
| B | Colonise undeveloped deposit fields (orbital habitation + extractors) | Ability to *raise* habitable capacity on a zero-habitable body | Unspecified mechanism | No |
| C | Allocate/prioritise labour (§12.3, SP3 §15) | Explicit labour-allocation weighting | **No** (G4) | No |
| D | Doctrine/government-weighted priorities | Ownership + readable doctrine | **Yes** | — |
| E | Directed logistics (abstract orders above diffusion cap, §12.2) | Order record + above-cap delivery + civilian crowd-out + **capital** | **No** | Order record yes; payload no |
| F | Military as industrial-base ceiling (§12.4) | Aggregate `count` by type across territory | **Yes** (read) | No (continuous) |
| F′ | Military-project unlocks (§12.4) | Threshold gate over the base | Read exists; thresholds TBD (§14) | Yes (read-side gate) |
| G | Military build + upkeep (§12.4) | Construction/military demand channel + **capital sink** | **No** (G5 + G1) | No |
| H | Rebellion + relation-weighted borders (§7, §13) | `unrest`→`factionId` mutation; relation-aware flow boundary | Partial (G3) | No |
| I | Autonomic drift (self-funded, subsistence) | Same as A, **no treasury needed** | Shape yes, path no (G2) | No |

**Autonomic-light vs full brain (§13 item 5):** SP5 splits into (1) **autonomic-light** — every system
self-develops on a subsistence + local-resource policy, *self-funded, slow* — which needs **only G2**
(the static→dynamic build-out path) and existing build-space reads; and (2) the **full faction brain** —
treasury-funded, doctrine-weighted planner + directed logistics + military ceiling — which is what's
blocked on **G1 (treasury)**, G4, G5. *You can stand up half of SP5 against today's substrate.*

---

## 5. War → economy operations (contract)

`war-system.md` is a rich *functional* spec but deliberately **non-physical**: war's economic effect is
dominated by a **per-system modifier layer the economy processor reads** (§10: "no new economic mechanism
is needed"), plus ownership transfer, lane-cut, military upkeep, and (under-specified) sabotage/facility
damage. **No direct population-kill is specified** — civilians are hit only indirectly via §10 modifiers →
unmet need → unrest → the existing decline/migration loop.

- **Discreteness:** not required. `count: Float` + fractional reduction is model-consistent and matches
  war's percentage-based tables. Discrete units appear only in the *separate* facility-tier system.
- **Infra-vs-pop independence:** supported by the substrate (separate records) but **not articulated** by
  the war doc — the "raze factories, strand workers" outcome is representable yet unspecified (G6).
- **Funds:** war assumes a faction war fund + finite per-tick military-output divided across fronts
  (§3 credit drain, §5.3 siege attrition, §8 war fund, §4/§5.4 multi-front). **Neither exists** (G1, G5).
  Note: the war-system.md "war fund" is *player credit donations*, not a persistent faction treasury.

---

## 6. Faction funds / treasury — the design that exists, and the gap

**Designed (vision §12.1), not built.** Key points of the existing design, worth confirming:
- *"Money is the driver, and it is the only unbounded quantity… spending **must** be a real sink or
  treasuries inflate to meaninglessness."*
- *"A **monetary-only treasury**. A faction holds capital, not physical stockpiles… This keeps everything
  in two substrates we already have: money + diffusing market stock."*
- *"Funded by a **throughput / sales tax** — a percentage skim on the value of goods sold in faction
  territory (civilian consumption + exports)… no civilian wallets to model."*
- *"Spending is a budget allocation… v1 ships only **two bands** — military upkeep and logistics
  efficiency — alongside one-off construction spend and war attrition… doctrine/government bias the
  allocation… a war chest is built by deliberate austerity and drained during war."*

**Open question for you:** §12.1 is emphatic that the treasury is **money-only** (no physical faction
stockpiles — physical things stay in diffusing market stock). Your phrasing was "funds **/ resources**."
Decide: adopt the money-only model as designed (simpler, one sink), or do you want factions to hold
physical resource reserves too (more state, more sinks, risks double-modelling stock)? Recommendation:
start money-only per §12.1; "resources" a faction controls = the *stock in its territory's markets*,
which it already influences.

---

## 7. Process reflection

The audit is *reassuring* on the "built too big, too fast, doesn't layer" worry — more than it felt:
- The specs **drew the discrete-vs-abstract line on purpose** (SP3 §2) and **listed what they deferred**
  (SP3 §15: runtime building, labour priority, war-demand channel — all explicitly "→ SP5").
- The substrate exposes the *right shapes* for the upper layers to extend (`count: Float`, separate
  pop/buildings, `factionId` FK, build-space columns). The gaps are **unbuilt additive primitives**, not
  **mis-built** ones — the layering holds.
- The genuine miss was **verbal intent (discrete facilities) diverging from the written design (abstract
  counts)**, never reconciled until now. The written design is internally coherent and downstream-compatible.

**One concrete integration risk to log:** `topology.ts getOpenEdges()` caches faction-bounded edges once
per process and never invalidates — so the moment `factionId` changes at runtime (war capture, rebellion),
trade-flow and migration topology go stale until restart. Must be fixed when G3 lands.

---

## 8. Open points to discuss / decide

1. **Confirm the abstract-count model.** Accept that economic facilities stay continuous `count: Float`
   (no substrate-v2 reopening)? *(Recommended: yes.)*
2. **Industry UI metaphor.** Continuous capacity/fill framing (honest to the model) vs discrete-cell
   metaphor? And: reserve true discrete-cell UI for the layers that are actually discrete (strategic /
   player facilities) when they arrive?
3. **Treasury shape.** Adopt §12.1 money-only treasury + throughput tax? Money-only vs also physical
   resource reserves (see §6)?
4. **Labour as a faction decision.** Confirm "AI chooses where labour goes / idle facilities" = the SP5
   labour-priority policy (G4) — explicit allocation state layered over the uniform ratio.
5. **War's physical destruction.** Formalise "raze infra → strand workers" + the sabotage/facility-damage
   op (G6), or keep war modifier-only for v1?
6. **Sequencing.** Likely order: **G2 (runtime build-out) + autonomic-light first** → **G1 (treasury)** →
   full faction brain (G4/G5) → war coupling. Where does SP4 (events / "population ← economic viability")
   sit relative to this? Where does the Industry UI work sit — does it wait until build-out makes the
   numbers *move*, or ship against the static economy now?
7. **Log the topology-cache invalidation** as a hard prerequisite for any runtime `factionId` change.

---

## 9. Bottom line

Nothing here requires undoing substrate-v2. The path to your vision is **additive**: build the missing
faction-agency primitives — **treasury first**, then runtime build-out, labour priority, and the
military/war coupling — on top of the (sound, deliberately continuous) substrate. The discreteness you
remembered wanting is real, but it belongs to the *strategic-facility* and *player-facility* layers, not
the economic production substrate.
