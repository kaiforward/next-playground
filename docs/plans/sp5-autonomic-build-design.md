# SP5 Autonomic-Light — Autonomic Build (Growth Toward Viable Potential)

> **Status: ✅ Complete — shipped to main in #114** (`5e665be`, 2026-06-27). Economy sub-project SP5
> autonomic-light, the **build** half (SP3.5 shipped the **decay** half). Sits *on* the substrate-v2
> available-space model and the SP3.5 decay loop (both unchanged) and *beside* the directed-logistics half.
> This spec **replaced the reactive "co-build housing to staff industry" approach**; the proactive
> housing-led build it describes — housing leads, population fills, industry follows the resident workforce
> (spare-labour gated) — is now live in `lib/engine/directed-build.ts::planFactionBuilds`. Roadmap home:
> [economy-simulation-vision.md](../planned/economy-simulation-vision.md) §13 item 5 (autonomic, build half).
> **Follow-up:** migrate the functional content to `docs/active/gameplay/`, then delete this plan doc.

---

## Key mechanics (the headline)

SP3.5 gave systems a way to erode: infrastructure decays toward what is actively *used*, so a system that loses
its population sheds housing and industry. Growth was deliberately left out of SP3.5 — *what* to build and
*where* is a faction decision, not an automatic process. This sub-project is that growth: the autonomic build.

**One rule:**

> **Factions build their systems up toward viable potential. Housing leads, population fills it, industry
> follows the people.**

A system's **potential** is set by its physical substrate and *gated by viability*: habitable land bounds
housing, housing bounds population, population (the labour it provides) bounds industry. Building proceeds
wherever a system sits *below* its potential and conditions allow — whether that is a young system developing
for the first time or one that lost ground earlier. ("Re-building" is not a distinct concept: it is just
building where something stood before.) A system already at its potential has nothing left to build, so the
build loop is naturally **idle at potential** — visible only where a system is actually growing.

Three mechanisms, in causal order:

1. **Proactive housing.** Where a system is *fed and calm* and has habitable land not yet built out, build
   housing toward the habitable cap — *ahead* of population, creating the headroom population needs to grow.
   Housing is a thing factions build directly, not a side-effect of building industry.
2. **Population growth** fills the new housing — the existing logistic, **untouched**.
3. **Labour-gated industry.** Build production only where there is genuine **spare labour**
   (`population − labourDemand`) *and* a reachable structural deficit it can serve with available inputs.
   Industry follows the people who already live there; it is never built for population that does not yet exist.

The physical-bound chain is what keeps the build honest:

```
habitable land  →  housing  →  population  →  industry
   (caps)            (caps)       (caps)
```

A barren, metal-rich world with almost no habitable land houses almost no one, so it can staff almost no
industry — **no matter how many ore deposit slots it has.** Its slots stay unworked until a future habitat
mechanic raises its habitable ceiling. This is what makes the build well-behaved: industry is bounded by
*labour*, and labour is bounded by *habitable land*, so the planner can never place capacity (e.g. 56 ore
extractors on a 3-pop world) that no one can staff.

---

## How the pieces interact

```
            ┌──────────────────── autonomic build (this spec) ────────────────────┐
 fed & calm + habitable headroom ─► (1) build HOUSING toward the habitable cap     │
                                          │  popCap ↑ (a margin ahead of pop)       │
                                          ▼                                         │
                       (2) POPULATION grows into the new housing                    │
                                          │  spare labour appears                   │
                                          ▼                                         │
 reachable structural deficit + inputs ─► (3) build INDUSTRY ≤ spare labour         │
                                          │                                         │
                                          ▼  system climbs toward its potential     │
            └─────────────────────────────────────────────────────────────────────┘

 SP3.5 decay (separate, unchanged): a system that loses viability (supply shock or
 unrest) erodes — housing toward occupancy, industry toward staffing. Build and decay
 share one equilibrium (occupied housing, staffed-and-selling industry), so a viable
 system sits at potential with both ≈ 0 and neither churns the other.
```

Growth is the primary dynamic. The build climbs a system toward potential; decay only bites when a system
suffers a real supply or unrest shock. The trigger for building is **viability** — a fed, calm system — which is
exactly what the directed-logistics half delivers (supply arrives → low dissatisfaction). That is why
logistics-first was the correct sequencing: supply makes a system viable, and a viable system builds.

---

## Why this replaces the reactive co-build (the design correction)

The live slice builds *industry* demand-pulled (deficit + physical capacity + proximity) and **co-builds
housing only to staff that industry** (`directed-build.ts:296-309`, `labourDemand > popCap` → add housing). That
model cannot grow a system, for two reasons:

- **It is inert on a full seed.** Housing is tied to industry, and industry is gated on spare labour. A seeded
  system has `population = popCap = labourDemand` (staffing-consistent), so spare labour ≈ 0 and the planner
  builds nothing, anywhere. There is no path from a settled world to a more-developed one.
- **It can only ever top up industry to the population already present.** Nothing builds housing *ahead* of
  population, so a system's population ceiling never rises — it cannot expand past its seeded size. (The same
  gap is also why a system that has *shrunk* never grows again under the reactive model: housing and industry
  decay at the *same* rate — `disuseRate 0.005` — so a shrinking system stays proportional, housing ≈ industry ≈
  reduced population, and the spare-labour opening it waited for never appears.)

The fix is to make **housing a proactive build target**: build it ahead of population, toward the habitable
land, so it *creates* the headroom population needs to grow; industry then follows the people. This is simply
"build, properly" — housing is something factions build, not a by-product of building industry. The decay rates
are left exactly as shipped; slowing housing decay would only leave housing standing above its occupancy, which
is the wrong fix.

---

## The model (detail)

### 1) Proactive housing

**Target.** A system's habitable housing cap is the habitable land it has, in housing units, also bounded by the
general space housing competes with factories for:

```
habitableCap = min(habitableSpace, remainingGeneralSpace) / effectiveSpaceCost(HOUSING_TYPE)
```

(mirrors the seeder's and the old co-build's habitable bound — housing draws general space *and* is capped by
the habitable subset).

**Trigger — "fed and calm".** Build housing only where the system can sustain more people:

```
fedAndCalm  =  dissatisfaction ≤ D_settle  AND  unrest ≤ unrest_settle
```

Both signals already exist (`dissatisfaction()`, the stored unrest integral). No new state. A system short on
food, or unsettled, does not grow — food supply (via logistics/trade) is therefore the **natural ceiling** on
how full a system becomes, with no magic population cap.

**Pacing.** Build housing to keep `popCap` only a small margin ahead of current population, never exceeding the
habitable cap:

```
targetPopCap   = min(habitableCap × popProvided, population × (1 + settleMargin))
housingToBuild = max(0, (targetPopCap − currentPopCap) / popProvided)
```

(`habitableCap` is in housing units; `× popProvided` converts it to the population it can hold.) Population grows
~3× faster than housing decays (`growthRate 0.015` vs `disuseRate 0.005`), so a small `settleMargin` of headroom
is filled by population before disuse decay can erode it — no wasted build budget, no housing standing empty. The
margin re-opens each cycle as population grows in, so a fed system keeps creeping toward its habitable cap and
then stops (headroom → 0 at the cap).

### 2) Population growth

Unchanged. The existing logistic (`populationDelta`) grows population into `popCap` headroom when fed and calm
and asymptotes there. Proactive housing simply gives it somewhere to go; `popCap` already recomputes live from
the housing count (SP3.5).

### 3) Labour-gated industry

The demand-pull planner is kept — structural deficits, route-cost proximity, the tier-1+ input-availability
gate, the faction build budget, the single-pass opportunity allocation (the shipped perf fix) — with **one new
hard gate and one removal**:

- **Spare-labour gate (new).** A site can add at most the production its *current, already-resident* population
  can staff:

  ```
  spareLabour          = max(0, population − labourDemand(siteBuildings))
  newUnits(good g)     ≤ spareLabour / labourPerUnit(g)
  ```

  fractional throughout (a 0.3-pop outpost staffs 0.3 of a facility producing 0.3 output — no integer
  rounding). As builds are placed at a site within a cycle, `spareLabour` is decremented on the working copy
  (mirroring how the planner already decrements capacity and served deficit). The final per-build cap is:

  ```
  wantUnits = min( buildableUnits(capacity),  servedOutput / perUnit,  budget,  spareLabour / labourPerUnit )
  ```

- **Co-build housing removed.** Housing is proactive now; the industry path no longer synthesises housing. When
  industry is built, the population to staff it is *already present* (housing led, population filled). This
  deletes `directed-build.ts:296-309`.

Extraction (tier-0) and manufacturing (tier-1+) are both labour-gated identically. The 3-pop barren world has
`spareLabour ≈ 0` (its few pops are occupied with subsistence), so it builds nothing — its ore slots wait for a
habitat mechanic to raise its population ceiling.

### Budget and pacing

The faction build budget stays pooled (`Σ systemBuildGeneration(pop) = Σ pop × GENERATION_PER_POP`) and now
funds **both** housing and industry builds. No explicit cross-mechanism priority is needed: the gates sequence
the work on their own — a system with no spare labour spends budget only on housing (and only if fed and calm),
and industry draws budget only at systems that already have spare labour. A per-system per-cycle pacing cap
keeps a single system from absorbing a disproportionate share of the pooled budget in one run (calibration
knob). The physical bounds make the pooled budget safe — it cannot overfill one system's housing past its
habitable land, nor its industry past its labour.

---

## Relationship to decay (they don't churn)

Build and decay are independent autonomic forces, not opposites. Build grows a system toward its potential;
decay erodes capacity that has fallen out of use. They share one equilibrium — occupied housing,
staffed-and-selling industry — so a viable system sits at potential with **both ≈ 0**, and neither churns the
other. That shared equilibrium is the entire point of the labour gate: the build never creates capacity above
what can be staffed or used, so decay has nothing to immediately liquidate. Growth is the main dynamic; decay
only bites when a system suffers a real supply or unrest shock. **Decay rates and thresholds are not touched by
this sub-project** (SP3.5 ships as-is).

---

## Population ← viability (the narrow slice we pull forward)

The "fed and calm" housing trigger is a deliberately **narrow** slice of SP4's booked *"Population ← economic
viability"* phase — just enough to gate *settlement* on whether a system can sustain more people. It is **not**
the full carrying-capacity rework (food + jobs as the dominant growth/decline lever), which stays in SP4 where
physical perturbations make conditions vary enough for it to read. Pulling the full rework in here would reopen
the locked substrate-v2 calibration — out of scope, exactly as SP3.5 drew the same line. Food/water viability
already flows through the shipped spine (shortage → D → unrest → decline); we only add "don't grow housing into
a system that can't feed the people."

---

## Validation: seed-below-potential harness

The build loop is idle at potential, so a pristine full seed shows nothing. To observe (and calibrate) it, seed
systems **below** their potential and watch them build up — there is no separate "young vs. lost-ground" case,
it is all just building below potential:

- Lower the seeder's development `fill` (e.g. ×0.5) so every system starts at roughly half its substrate
  potential — housing, population, and industry all reduced coherently (food still matches the reduced
  population, so nothing starts starving).
- Run `npm run simulate` / a live seed and confirm the **coarse** behaviour: fed systems climb — housing toward
  habitable, population into the housing, industry behind the people — and asymptote at potential;
  barren/low-habitable worlds stay small; nothing builds past habitable land or past staffable labour; no NaN /
  runaway / galaxy-wide collapse.

This is a **validation harness**, not necessarily a permanent seeding change. Whether the *live* game ships
seeds at full potential (loop idle until a shock opens room) or below potential (a visibly developing galaxy
from turn 1) is a separate product call, decided after we have watched the build behave.

---

## Build order (phases)

1. **Engine — proactive housing + labour-gated industry (pure).** Rework `planFactionBuilds`: a housing pass
   (fed-and-calm, paced toward habitable cap) and the spare-labour gate on the industry pass; delete the
   co-build block. Vitest-tested in isolation (no DB import in the test graph): housing grows only when fed and
   calm and below cap; housing never exceeds habitable; industry never exceeds spare labour; barren world builds
   nothing; a below-potential fed system builds up to potential and then stops.
2. **Tick wiring.** Feed `dissatisfaction` + `unrest` + `population` into the build world/adapter (the
   `PrismaDirectedBuildWorld` already reads capacity; extend its read). Live (Prisma) + in-memory (simulator)
   adapters share the pure body. Housing builds flow through the existing insert-or-update count writes.
3. **Validation + calibration.** The seed-below-potential harness above; tune `settleMargin`, `D_settle`,
   `unrest_settle`, and the per-system budget pace to the coarse health bar.

Phases 1–2 are the engine PR(s); phase 3 is calibration. Continues `feat/sp5-autonomic-light`; the final
whole-branch review (deferred) runs after this lands.

---

## Scope boundaries

**In:** proactive housing build toward habitable land, viability-gated ("fed and calm") and paced ahead of
population; spare-labour gate on industry builds (fractional); removal of the reactive co-build; both builds
funded from the pooled faction budget with per-system pacing; the seed-below-potential validation harness.

**Deferred (explicitly out):**
- **Full "Population ← economic viability"** (food + jobs carrying capacity as the dominant lever) → SP4.
- **Habitat / terraforming** — a mechanism that *raises* a world's habitable ceiling (lets barren worlds host
  more population) → later. Until then, low-habitable worlds stay small by design ([[project-barren-galaxy-artificial-habitation]]).
- **Colonising un-owned space** (settling *beyond* a faction's existing systems) → Stage 2 emergent territory.
- **Faction `factionId` mutation**, treasury accounting beyond the existing generation budget, the military
  channel, war coupling → SP5-full / war-system.
- **Decay rate/threshold changes** → none; SP3.5 ships as-is.

---

## Open calibration knobs (all simulator-tunable)

- `settleMargin` — how far ahead of population housing is built (growth headroom). Small enough that population
  fills it before disuse decay erodes it (population grows ~3× faster than housing decays).
- `D_settle` / `unrest_settle` — the "fed and calm" thresholds gating housing growth.
- Per-system per-cycle budget pace — caps one system's share of the pooled faction budget per run.
- `GENERATION_PER_POP` — the faction build budget rate (existing); revisit only if the build is too fast/slow
  galaxy-wide.
- Seed `fill` multiplier for the validation harness (how far below potential systems start).

Per the standing approach, calibrate to a **coarse** health bar (fed systems build up and asymptote at
potential; barren worlds stay small; no build past habitable/labour; no NaN/runaway/collapse; dispersion across
systems) — precise tuning is perishable and waits until SP4/SP5-full land.

---

## Where this sits in the roadmap

- **Supersedes** the reactive co-build approach in the live build slice (`feat/sp5-autonomic-light`,
  `directed-build.ts`). The engine perf fix, catchUp capacity fix, Prisma adapter, and processor/registry
  wiring from that slice are retained; only the *allocation policy* (`planFactionBuilds` body) changes.
- **Pairs with** the directed-logistics half (`feat/sp5-logistics`) — logistics delivers supply → systems
  become fed and calm → the build develops them. Logistics-first sequencing is what makes the build's trigger
  fire.
- **Builds on** SP3.5 decay (`docs/active/gameplay/economy-infrastructure-decay.md`, shipped) and substrate-v2
  available-space (shipped) — both unchanged.
- **Vision §13:** the build half of item 5 (autonomic), with a narrow slice of item 4 (pop-viability) as the
  "fed and calm" gate. Full SP4 (events + the dominant-lever pop-viability rework), habitat/terraforming, full
  faction agency, and the war capstone follow on top of this moving substrate.
