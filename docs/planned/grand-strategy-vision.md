# Grand-Strategy Re-Conception — Game Vision

Status: **North star / approved direction** — created 2026-07-06 from a full concept audit. This document re-conceives the game from a browser-based multiplayer space-trading game into a **single-player grand-strategy game** (Stellaris / Victoria / EU5 register) built on the living-economy simulation. It is the successor to the game framing in `docs/SPEC.md`'s overview and to the roadmap in [economy-simulation-vision.md](./economy-simulation-vision.md) §13; the simulation *model* in that doc remains valid and load-bearing.

This is deliberately above implementation: it locks the concept, records what is kept / re-pointed / cut, disposes of the obsolete doc tree, and sketches phasing. Each build phase gets its own spec → plan → build cycle.

---

## 1. Headline

**The player rules a faction.** You take the seat the NPC "agency layer" was being designed for: steer a spacefaring polity's economy, expansion, population, and (eventually) wars in a procedurally generated galaxy, against AI factions running the same machinery. Single-player, pausable, save/load — a real-time-with-pause grand strategy game, not a persistent multiplayer world.

**Why the pivot.** The concept audit (2026-07-05) found the project had already become this game in all but the player seat: ~80% of design and code effort went into the living world simulation (physical substrate, dynamic population, build/decay, logistics, specialisation, factions), while the player-facing trading layer stayed shallow and every attempt to deepen it fought the design (the contract layer was built then ditched; the trade rework was blocked on price-spread problems; multiplayer infrastructure was never designed). The personal-scale pilot fantasy (fly a ship, dodge hazards, arbitrage markets) cannot compete in its genre without real-time flight and combat, and real-time multiplayer was the single largest cost multiplier — anti-exploit design, contention design, infrastructure, and the need for a player population. The simulation is the crown jewel; this pivot makes it the game board.

**The inversion that makes this cheap rather than expensive:** the autonomic agency layer (directed logistics, build planner, and the planned SP5 treasury / budget bands / doctrine-weighted priorities) stops being an NPC brain and becomes the **player's control surface** — and, unchanged, the AI opponents. Most strategy games struggle to make the AI play the player's game; we built the AI-playable version first.

---

## 2. Design pillars

1. **A living physical world, not a spreadsheet with a map.** Everything derives from universe generation and how factions use it (unchanged north star). Goods are produced by what a system physically is, consumed by the people who live there; systems genuinely thrive or starve. Price is a readout, not a reward.
2. **Magnitude, not building slots.** Industry, population, and flows are continuous magnitudes (fractional building counts, 1 pop-unit ≈ 1M people). Dedicating a world's space to shipyards is an *allocation*, not tile placement. This is the scale-feeling differentiator — the thing Stellaris's 8-slot colonies never convey.
3. **Logistics as terrain.** Goods move through a real diffusion/flow network with distance, borders, and throughput limits. Where things are and how they get there is a first-class strategic concern, modelled in more detail than the genre normally attempts. The player influences flow *effectiveness* (control, infrastructure, later escorts) rather than micromanaging cargo.
4. **Direct control, opt-in automation (the EU5 model).** Everything is manually controllable and everything is automatable, per domain, when it stops being fun to do by hand. Two building avenues with separate automation: **basic industry** (extractors, factories, housing — the autonomic planner already places these well) and **special buildings** (specialisation complexes, academies, later wonders/military installations — scarce, identity-defining, the player's toys).
5. **Start small, grow into the scale.** Factions seed as small developed cores in a mostly-unclaimed galaxy and expand by colonisation (Stellaris opening). Early game is hands-on with a handful of systems; automation unlocks arrive as the empire outgrows manual play. The management load and the automation curve grow together.
6. **Economy is war potential.** Deferred but designed: military power is a capacity ceiling derived from the industrial base, realised only when supplied ([economy-simulation-vision.md](./economy-simulation-vision.md) §12.4). Good economic management *is* military strength; logistics interdiction degrades a fleet before a shot is fired. War is the capstone that makes the economy's stakes lethal.
7. **Gameplay first, graphics second.** Text, numbers, and the WebGL map are the presentation. Depth budget goes to systems, not art.

---

## 3. The player

- **Seat**: an existing faction, from the first minute. No personal avatar, no rise-from-one-ship arc, no starting smaller than faction scale. (The Mount & Blade progression fantasy is explicitly retired — its payoff was real-time battles we will never have.)
- **Arc**: small core → colonise → develop → specialise → project power. The three-phase feel comes from empire size, not unlock gates.
- **Verbs (v1 target)**: set budgets and priorities; place/expand industry, housing, and special buildings (fractional allocations); direct colonisation; influence flow effectiveness; conduct basic diplomacy; respond to events; toggle per-domain automation.
- **Verbs (later)**: policies/laws over pops and ideology; war — mobilisation, fronts, interdiction; deeper diplomacy (pacts, claims, coalitions).
- **AI factions** use the identical control surface with no overrides — one brain, N seats, one of them human.

---

## 4. System dispositions

Verdicts for every active system. *Keep* = survives as-is or near-as-is. *Re-point* = survives with changed role/rules. *Cut* = deleted with its code, UI, and docs.

### Keep — the game board

| System | Notes |
|---|---|
| System substrate & traits | Unchanged foundation. |
| Economy engine (production, consumption, stock, labour, satisfaction) | Core loop unchanged; demand re-pointed (see §5.1). |
| Population / unrest / migration / infrastructure decay | Unchanged; extends to pops (§5.2). |
| Directed logistics + autonomic build | Becomes the automation engine + AI player (§2 pillar 4). |
| Specialisation track S1–S3 (skill labour, complexes, tiered demand) | Complexes/academies seed the "special buildings" avenue; skill grades are the embryo of pop classes (§5.2). |
| Trade simulation (edge diffusion) | Kept and streamlined; merges with directed logistics into one flow system with player-influenced effectiveness (§5.3). |
| Faction system + inter-faction relations | Player becomes a faction; relations become the diplomacy foundation. Government types decompose into ideology axes (§5.2). |
| Tick engine + processor pipeline | Kept; gains pause/speed, loses the 5-second wall-clock and multiplayer broadcast (§6). |
| Universe generation + WebGL map | Kept as the primary game surface. World-gen start state changes (§5.4). Fog-of-war re-scopes from per-player to player-faction sensor/exploration coverage. |
| Simulator / calibration harness | Kept — it is now literally the game engine's test bench. |

### Re-point — survives with a different job

| System | From → To |
|---|---|
| Events | Market-modifier decoration → physical perturbations (already planned as SP4) **plus** player-facing decision content (Paradox-style event choices). Relations-owned events continue. |
| Ships & fleets | Player-owned tradeables → faction assets. Fleet composition later derives from the industrial base (war design). Personal upgrades/modules die; roster stats inform fleet archetypes. |
| Combat engine | Personal bounty battles → salvage as the kernel for fleet/war battle resolution (evaluate at war time; may be rewritten). |
| Notifications / Captain's Log | Per-player asset alerts → faction alert feed + situation log (the Paradox alert strip). Model simplifies; concept survives. |
| Pricing | Player reward (arbitrage spread) → cost signal for player/AI decisions. The bid-ask spread, slippage, and anti-resell apparatus are deleted — they defended a multiplayer market from players. The maturity-dependent spread problem stops being a blocker (nothing needs arbitrage margins) and becomes an economy-health observation. |

### Cut — deleted outright

| System | Why |
|---|---|
| Personal trading UI + trade missions | The player no longer buys low / sells high by hand; the faction's flows are the game. |
| Navigation danger pipeline (hazard/duty/contraband/loss per arrival) | Personal-cargo mechanic with no faction-scale meaning. Danger as a concept returns with war/piracy design if needed. |
| Operational missions (patrol/survey/bounty) + battle viewer | Personal-scale content. Survey's exploration role returns as faction exploration in colonisation design. |
| Player-faction reputation | The player *is* a faction; relations replace it. |
| Ship upgrades / modules | Personal-scale. |
| Auth, sessions, per-player state, SSE fan-out | Single-player. |
| In-system gameplay / locations / NPCs / dialogue | A different game. The Explore tab framework and Void's Gambit are parked, not designed against. |
| Mini-games track | Parked with the above. Void's Gambit's engine is finished, standalone, and keepable as an easter egg someday — zero further investment. |
| Multiplayer infrastructure (stub) | Retired. A far-future Paradox-style lockstep MP is noted in §6 (determinism), nothing more. |
| Anti-exploit economy mechanics (spread/slippage caps, rep grind caps, contention design) | Existed because strangers shared a market. |

---

## 5. New / re-pointed design spaces

Sketch level. Each is its own future spec; open questions are flagged rather than resolved.

### 5.1 Goods re-pointed — demand with teeth

The 26-good economy stops serving arbitrage and starts serving the three demand channels the vision doc always specified (§5.1 there): **pops** (civilian baskets, already live via S3), **production inputs** (live), and **construction / military** (the socket, now to be built). Building/expanding/colonising consumes real goods marshalled to the site; military later draws on the same channel. The goods roster itself gets a review pass (some goods exist to be trade flavour; each good must earn its place in a demand channel). Likely simplifications: fewer, more meaningful goods; military-tagged goods gain their real sink.

### 5.2 Pops and ideology

- **Pops**: population moves from one scalar per system to **fractional pop entities with characteristics**. The S3 demand basis `{population, technicians, engineers}` is the embryo — grades become persistent pop classes that grow, migrate, and get educated, rather than ceilings re-derived from academies each tick. Migration, unrest, satisfaction re-target naturally.
- **Ideology axes**: the 8 government types decompose into Stellaris-style mix-and-match axes (e.g. authority, economy, society, posture — exact set TBD); existing governments become presets, existing government modifiers re-derive from axis positions. Doctrine likely folds in.
- **Culture without history**: a generated galaxy has no inherited culture map, so identity **derives from material conditions** — pops seed and drift ideologically by what they are (class, prosperity, war exposure, institutions present). Friction = distance between pop ideology and faction ideology, feeding the existing unrest/control machinery; diplomacy compatibility re-derives from inter-faction axis distance. Cross-border texture (diasporas, ideological border regions, digestion of conquests) **emerges from the simulation** — migration and conquest write the history.
- **v1 commitment is lean**: one ideology vector per pop group, friction → unrest/control, diplomacy from distance, slow policy levers. Named future space, deliberately deferred: religion/language layers, separatism/new-faction formation, cultural casus belli.

### 5.3 Flow, control, and the merged logistics system

Market diffusion and directed logistics merge into **one player-legible flow system**: goods move toward need through a network whose per-edge effectiveness is governed by **control** (a new per-system stat alongside unrest — EU5's control analogue: distance from core, infrastructure, unrest, later wartime interdiction), rather than two parallel mechanisms with different rules. The player invests in flow effectiveness (infrastructure, control) and sets priorities ("feed this forge world", "stockpile at the frontier"); the routing itself is automated by default. The negative-space principle survives: flow capacity deliberately under-serves total need, so geography and prioritisation matter.

### 5.4 World-gen: small cores in an open galaxy

Seeding inverts from "8 majors + minors own everything" to **small developed faction cores in a mostly unclaimed galaxy**. The partial-varied seeding philosophy applies to cores; the frontier is empty or thinly inhabited (independent systems — the existing minor-faction archetypes inform this). Colonisation becomes a core loop: found/absorb systems, marshal construction goods to them, grow them into the network. This absorbs the previously-parked "Stage 2 emergent territory" work (dynamic `factionId`, un-owned space, colonisation) as a launch feature rather than an afterthought. Rebellion (deferred from SP2) gets its natural home here too.

### 5.5 Open design questions (each needs its own pass)

- **Goals / win conditions / scenario structure** — sandbox with self-set goals is the genre default; decide what, if anything, sits on top.
- **Event content model** — how Paradox-style choice-events are authored/triggered against a fully emergent world.
- **Diplomacy verbs** — relations exist; the player-facing action set does not.
- **Culture/ideology depth** — the lean v1 vs the deep layers (§5.2).
- **Goods roster rework detail** — which goods survive, what construction/military actually consumes.
- **UI paradigm** — the current page-per-screen web app vs a map-first single-surface app (genre standard). Likely map-first with panels; needs a design pass.
- **Tick/time model** — tick length, speed steps, what "a day" is.
- **Title** — "Stellar Trader" no longer describes the game.

---

## 6. Platform & engine

**Single-player, in-memory, desktop-packageable.** The processor architecture (pure bodies + Prisma/memory adapters) means the engine already runs DB-free — the simulator runs the full economy for thousands of ticks in-process. The pivot completes that:

- **Runtime**: the world lives in memory; the tick engine runs in-process with pause/speed controls. Postgres/Prisma retire from the game runtime entirely (with them go the transaction-timeout, N+1-batching, and TOCTOU constraints — most of the DB gotchas simply stop applying).
- **Persistence**: save/load = world-state snapshots to disk (Paradox-style save files), plus autosave.
- **Migration surface**: the read/mutation services (`lib/services/`) re-point from Prisma to the in-memory world; auth deletes; SSE becomes an in-process event bus; `prisma/seed.ts` becomes world-gen. Mechanical, multi-week, low design risk.
- **Packaging path**: A (pragmatic) — keep Next.js, world in local server memory, wrap with Electron for desktop. B (clean end state) — engine in a Web Worker, fully client-side, shippable as static web + Tauri/Electron desktop from one codebase. A migrates into B; don't decide today.
- **Determinism**: seeded RNG, no wall-clock in the tick. Cheap to maintain now, and it keeps Paradox-style lockstep multiplayer possible *someday* without being designed for. Lockstep needs no DB and no stateful server — identical sims exchange only player commands via a stateless relay — so retiring Postgres closes no MP doors. Full guardrails (command boundary, JS transcendental-`Math` cross-engine float divergence) are recorded in [pivot-phase2-engine-extraction.md](./pivot-phase2-engine-extraction.md) §Multiplayer-someday guardrails.

---

## 7. Doc & roadmap dispositions

Per the no-archive rule, superseded docs are **deleted** (git is history). Execute this table when the pivot is adopted.

### Delete now (roadmap/design superseded by this doc)

| Doc | Reason |
|---|---|
| `docs/MIGRATION-NOTES.md` | Pre-pivot layer roadmap; Layers 3–5 (content, player facilities, multiplayer) are dead, the rest is shipped history. |
| `planned/layer-2-roadmap.md` | Superseded roadmap bridge. |
| `planned/player-progression.md` | The three-phase personal arc is retired. |
| `planned/in-system-gameplay.md`, `planned/mini-games.md`, `planned/mini-game-fullscreen-host.md` | Parked game-direction; Void's Gambit code stays in-repo, unmaintained. |
| `planned/missions.md` | Personal mission framework; faction-gated variants die with it. |
| `planned/multiplayer-infrastructure.md` | Retired ambition. |
| `planned/navigation-changes.md` | Personal navigation/contraband layer. |
| `planned/player-facilities.md` | Player-personal ownership layer; the *faction* build system is the game now. |
| `planned/facilities.md` | Bundled-facility model long superseded by generic buildings + special buildings. |
| `planned/production.md`, `planned/production-roster.md` | Shipped/superseded by the live economy docs; kept only as goods-catalog reference — fold anything still useful into the goods-rework spec, then delete. |
| `planned/economy-scaling-and-trade-rework.md` | Its remaining sub-projects (contract-model rework, ship re-pricing, offered-fraction dial) served player arbitrage. The scale knob shipped. Before deleting, carry the maturity-dependent-spread finding (Key Finding #4 UPDATE) into the S4/calibration notes — it remains a real economy-health observation. |
| `planned/server-side-filtering.md` | Multiplayer-scale API concern. |
| `planned/sp5-war-layering-contract-audit.md` | Audited the *personal-player* layering contract for war; war will be re-specced against the faction seat. |

### Keep, re-framed

| Doc | Fate |
|---|---|
| `planned/economy-simulation-vision.md` | **Stays the simulation north star.** §13 (roadmap) and the player-as-premium-throughput framing in §12.2 are superseded by this doc; the model (§2–§12) stands. Annotate, don't delete. |
| `planned/war-system.md` | Stays planned; needs a re-spec pass for the player-as-faction seat before build. |
| `planned/negative-space-economy.md` | Principle survives intact (§5.3 above depends on it). |
| `planned/event-ideas.md` | Feeds the events re-point. |
| `planned/economy-specialisation.md` + `economy-specialisation-s4-guardrails.md` | S4 calibration pauses; resume inside the post-pivot economy pass (goods rework + flow merge will reopen calibration anyway — do it once). |
| `docs/SPEC.md` | Overview + core-loop sections rewrite to this concept; active-system sections update as systems are cut/re-pointed during the build. |
| `docs/BACKLOG.md` | Needs a purge pass (trade-rework, mini-game, smuggling, reputation items die). |

### Active docs

Active docs describe shipped code and stay accurate until the code changes: each cut system's doc (`trading.md`, `combat.md`, `ship-upgrades.md`, `notifications.md`, parts of `navigation.md`) is deleted in the same PR that deletes its system.

---

## 8. Phasing sketch

Order of operations, not a build plan. Each phase gets its own spec → plan → build; earlier phases are deliberately playable.

- **Phase 0 — Adopt the pivot (docs only).** Commit this doc; execute the doc dispositions; purge BACKLOG; rewrite SPEC.md's overview.
- **Phase 1 — Teardown.** Delete the §4 cut systems from the code: UI, routes, services, hooks, tick processors, Prisma models, tests — and each system's active doc in the same PR. Done *before* engine extraction so the migration surface shrinks (nothing dead gets migrated). The app keeps running in its current form throughout; build + tests stay green after each sweep. Not purely mechanical — entanglements need per-piece calls in the spec (ship *travel* survives for fleets while the danger pipeline dies; the market screen dies as a trading surface but partially survives as an economy inspection view; auth stays untouched in Phase 1 — it's load-bearing for every route and deletes wholesale in Phase 2 with the services re-point). Plan: [build-plans/pivot-phase1-teardown.md](../build-plans/pivot-phase1-teardown.md).
- **Phase 2 — The ant farm (engine extraction).** Single-player runtime: in-memory world, remaining services re-pointed, auth deleted, save/load, pause/speed, world-gen from seed script. Milestone: the living galaxy runs locally as an observable simulation with the full map — no Postgres, no login. Spec: [pivot-phase2-engine-extraction.md](./pivot-phase2-engine-extraction.md).
- **Phase 3 — The player seat (v1 of the game).** Pick a faction; treasury/budget bands + build orders (the SP5 "full agency" design, built player-facing and AI-shared); manual placement with fractional allocations; per-domain automation toggles; new world-gen (small cores, open galaxy) + colonisation; alert feed. Milestone: you can *play* — develop a small faction against AI rivals.
- **Phase 4 — Pops, ideology, control.** Pop entities + ideology axes + friction; control stat; flow-system merge (diffusion + logistics + control levers). The big economy re-pointing (goods → construction/pops channels) lands here; recalibrate once.
- **Phase 5 — Diplomacy & events as content.** Player diplomacy verbs over the relations substrate; Paradox-style event choices; physical event perturbations (the old SP4).
- **Phase 6 — War (capstone).** Military ceiling from the industrial base, mobilisation, fronts, logistics interdiction, conquest → digestion via pops. Re-spec `war-system.md` first.

The old sequence (S4 guardrails → contract rework → ship re-pricing → SP4 → full SP5 → events → war) is superseded; its surviving members are absorbed above (full-SP5 agency → Phase 3, SP4 viability/events → Phase 5, war → Phase 6, S4 calibration → Phase 4's single recalibration).

---

## 9. What this document supersedes

- The **game concept** in `docs/SPEC.md` (browser-based multiplayer space trading; core loop "Travel → Discover → Trade / Fight → Profit → Upgrade").
- The **roadmap**: `economy-simulation-vision.md` §13 (CURRENT SEQUENCE block and all dated sequencing notes), `MIGRATION-NOTES.md` layers, and the trade-rework decomposition.
- The **player model**: personal avatar, fleet-of-one-trader, reputation, progression arc, in-system adventure layer, multiplayer.
- It does **not** supersede: the simulation model (vision §2–§12), the substrate/economy/population/logistics active specs, the negative-space principle, or the engineering architecture docs — those are the foundation it builds on.
