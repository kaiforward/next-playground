# Mini-Game Fullscreen Host

A dedicated, immersive surface for in-cantina mini-games. Mini-games currently render *inside* the system detail panel, which is dismissable mid-game; this design moves them to a top-layer fullscreen modal that escapes the shell and can only be left deliberately.

> **Status — designed, not built.** Approach and the two product decisions (confirm-and-forfeit exit, escrow-at-start wagers) are settled. This doc is the spec; turn it into a build plan (`docs/plans/`) when the work is picked up. Depends on nothing not already shipped — Void's Gambit (`lib/engine/mini-games/voids-gambit/`) and the cantina are live.

---

## 1. Problem

Everything under `app/(game)/` is wrapped in `GameShell` (sidebar + topbar). The system detail — including Explore → Cantina → Void's Gambit — renders in the `@panel` parallel-route slot as a `DetailPanel` modal (`components/ui/detail-panel.tsx`). That modal closes on **Escape, backdrop click, and the X button**. So a mini-game living there inherits "click-outside / Escape = gone," and a wagered game can be lost by accident.

Two gaps:
1. **No shell-less surface exists** — a mini-game can't take over the screen; it's always boxed inside the panel, inside the shell chrome.
2. **Leaving is accidental, not deliberate** — the panel's dismissal affordances actively work against a focused game with stakes.

## 2. Decision summary

- **Approach A — top-layer fullscreen modal** (chosen over a distinct shell-less route). A native `<dialog showModal()>` renders in the browser top layer, above the sidebar, topbar, *and* the panel, while staying inside the game's React tree (so it keeps all providers — fleet credits, settle, tick — for free). No route change.
- **Exit mid-game → confirm + forfeit.** Leaving an in-progress hand is possible but requires confirming a forfeit. Resolved hands (result on screen) leave freely.
- **Wagers escrow at game start.** The wager is debited when a hand begins and paid out at resolve, so a hard refresh / tab-close can't dodge a loss — the stake is already gone.

### 2.1 Why A over a distinct route (B)

For the four planned mini-games (Void's Gambit, Drift, Alignment, Cargo Roulette) — all single-session, **client-only** games with no server match state — A is the better UX, not just the simpler build:

- **Snappier entry** — a client-state flip + modal animation; no route teardown or Suspense flash.
- **Stronger focus containment** — native top-layer + focus trap; background controls are inert.
- **Deliberate-exit-only** — the only way out is the on-screen control, which *is* the anti-accidental-close goal. (On mobile this is stronger still: a back-swipe can't drop you out of a wagered hand.)

B's advantages — real URL, survives refresh, shareable — are all cashed out only by **server-stateful** games (resume-from-link, reconnect-after-refresh, async/PvP). None of the Phase-1 games have that. **Pivot rule:** if a future mini-game gains server-side match state, that same signal flips B from "nicer URL" to "actually better UX" — revisit then. The seams below (a host + per-game registry) make that pivot a re-mount, not a rewrite.

The one genuine wart in A: the browser back button has no history entry to pop, so it silently navigates the page *underneath* the modal. Minor, and mitigatable later by pushing a history entry on game-start and intercepting `popstate` into the same confirm-flow (more reliable for a client overlay than guarding route changes in App Router).

## 3. Architecture

Three new pieces, all inside the existing providers, mounted once in `GameShellInner`:

```
GameShellInner
 └─ MiniGameProvider          ← active session: { gameId, config } | idle
     ├─ <div> sidebar + topbar + <main>{map}{panel}</main>   (unchanged)
     └─ <MiniGameHost/>        ← renders the active game in a fullscreen <dialog showModal()>
```

- **`MiniGameProvider` / `useMiniGameSession`** (`components/providers/mini-game-provider.tsx`) — holds session state + `start(config)` / `clear()`. Mounted in `GameShellInner` so both the cantina (in the `@panel` slot) and the host share it.
- **`MiniGameHost`** (`components/mini-games/mini-game-host.tsx`) — reads the session; idle → renders nothing; active → fullscreen modal hosting the game looked up by `gameId`. Owns the exit-guard UI and the wager mutations.
- **Game registry** (`components/mini-games/registry.ts`) — `gameId → { component, displayName }`. Today only `voids-gambit`; the seam future games plug into.

Config is a discriminated union keyed by `gameId`, so each game declares its own launch params:

```ts
type MiniGameConfig =
  | { gameId: "voids-gambit"; systemId: string; npc: NpcArchetype; wager: number }
  // future: | { gameId: "drift"; ... }
```

## 4. Component & file changes

**New:**
- `components/providers/mini-game-provider.tsx` — session context + hook.
- `components/mini-games/mini-game-host.tsx` — the fullscreen host: registry lookup, exit-guard, wager mutations, `creditsChange` feedback.
- `components/mini-games/registry.ts` — `gameId → component` map.
- `components/mini-games/voids-gambit/voids-gambit-game.tsx` — wraps what is *currently* the cantina's `"game"` view: owns `useVoidsGambit`, renders `GameTable`, handles "Play Again". Implements the `MiniGameProps` contract (§5).
- `lib/mini-games/exit.ts` — pure `resolveExit(status)` → `"forfeit" | "free"`. Unit-tested.

**Changed:**
- `app/(game)/@panel/system/[systemId]/explore/cantina/page.tsx` — drop the `"game"` view, `useVoidsGambit`, `GameTable`, `creditsChange`, `handleGameComplete`, `currentWagerRef`. `CantinaView` shrinks to `"npcs" | "lobby"`. `handleStartGame` becomes one line: `session.start({ gameId: "voids-gambit", systemId, npc, wager })`. The panel stays at `/system/.../cantina`; on exit the modal closes and the player is back at the lobby. Net: the cantina page gets *smaller*.
- `components/game-shell.tsx` — wrap inner content in `MiniGameProvider`, render `<MiniGameHost/>` once at the shell root.
- `components/ui/dialog.tsx` — small extension: a `fullscreen` variant (fills the viewport instead of the centered `w-[960px]` modal) and an `onCancel` override so Escape routes into the confirm-flow instead of auto-closing (§7.2).

**Untouched:** the Void's Gambit engine, `GameTable`, and `useVoidsGambit` — pure drag into the new game component.

## 5. Exit, forfeit & settlement contract

The game component normalizes its own result to the shared settle vocabulary, so the host never sees game-specific types. The host owns money + guard; the game owns hand timing (only the game knows a hand's boundaries):

```ts
interface MiniGameProps {
  config: MiniGameConfig;                                  // narrowed by gameId inside the component
  stake: () => Promise<boolean>;                           // debit wager for a new hand (also re-stakes on "Play Again"); false = failed
  settle: (outcome: "win" | "loss" | "tie") => Promise<void>;
  creditsChange: number | null;                            // net feedback for the result screen
  onStatusChange: (s: "in-progress" | "resolved") => void; // tells the host whether an exit is a forfeit
  onExitRequest: () => void;                               // in-game "Leave table" pressed
}
```

**Deliberate-exit flow** (pure `resolveExit(status)`):
- Exit requested (Leave button *or* Escape) while **in-progress** → confirm sub-dialog *"Leave now and forfeit your {wager} CR wager?"* → confirm → host calls `settle("loss")` and clears the session → back to the cantina lobby in the panel.
- Exit while **resolved** (already settled at completion) → free; clears immediately.

Forfeit is host-autonomous: the host calls `settle("loss")` itself; the game (mid-hand) never reaches its own `settle`, and `resolveStake` is a no-op when there's no open stake, so a hand settles exactly once.

"Play Again" is internal to the game — it calls `stake()` again, then deals a fresh hand and reports `onStatusChange("in-progress")`.

## 6. Wager escrow

Core shift: **debit at stake, pay out at resolve.** Once the wager leaves the balance when a hand begins, a force-refresh can't dodge it — the stake is the forfeit.

| Outcome | Balance delta at resolve | Net over the hand | Player sees |
|---|---|---|---|
| Win | `+2×wager` (stake back + winnings) | `+wager` | "Won {wager} CR" |
| Tie | `+wager` (stake back) | `0` | "Wager returned" |
| Loss | `0` (stake forfeited) | `−wager` | "Lost {wager} CR" |
| Forfeit / hard-refresh | `0` (stake already gone) | `−wager` | — |

**Resolve integrity:** resolve reads the wager from the server-side stake record, **not** the client — the client sends only `outcome`. This *tightens* security versus today (the current `/wager` route trusts a client-passed `wager`). It does not defend against a cheating client reporting "win" (a client-side game can't be server-verified — true today too); it only ensures payout can't exceed the actual stake.

**New state — `CantinaStake`** (follows the `NpcVisit` pattern; keeps mini-game money off the `Player` model, per the project's separation preference):

```
CantinaStake { id, playerId, gameId, wager, status: "open" | "resolved" | "abandoned", createdAt }
```

Only one `open` stake per player (one game at a time). Starting a new stake first marks any lingering `open` stake `abandoned` (no refund — the forfeited rage-quit), which self-heals stale stakes. Requires `npx prisma db push`.

**Server / hook changes:**
- New `stakeWager(playerId, wager, gameId)` (service) — TOCTOU-guarded debit + create open stake. New route `POST /api/game/cantina/wager/stake`. New `useStakeWagerMutation`.
- `settleWager` → `resolveStake(playerId, outcome)` — reads the open stake, pays out per the table, marks resolved. The `/wager` route takes `outcome` only. `useSettleWagerMutation` → `useResolveStakeMutation`.
- `validateWager` (lobby affordability check) unchanged.
- Pure `computePayout(outcome, wager)` in the engine — unit-tested against the table above.

Both `stake` and `resolve` run in `prisma.$transaction` with a balance re-read (TOCTOU guard), matching the existing `settleWager` pattern.

## 7. Integration details / gotchas

### 7.1 Top layer escapes the shell
A modal `<dialog>` renders in the document top layer, above all stacking contexts and ancestor `overflow`/`transform`/`filter` — so it covers the sidebar, topbar, and panel regardless of where it's mounted. Mount `<MiniGameHost/>` high in `GameShellInner` anyway, for clarity.

### 7.2 Escape must not reach the panel's listener
`DetailPanel` registers a **document-level** `keydown` Escape listener that navigates the panel away (`detail-panel.tsx:67`). While the host dialog is open, an Escape press fires the dialog's `cancel` event *and* a `keydown` that bubbles to `document` — which would close the cantina panel underneath. Mitigation: in the host dialog, handle Escape in the **capture phase** with `stopPropagation()` + route it to `onExitRequest`, and `preventDefault` the dialog's `cancel` event (the existing `Dialog` already intercepts `cancel`; extend it with an `onCancel` override instead of the default auto-close).

### 7.3 `beforeunload` is now optional
With escrow, the stake is already debited, so a forced unload *is* the forfeit — `beforeunload` is no longer load-bearing for the exploit. Keep a light "leave game?" warning as a courtesy if desired, but it carries no integrity weight.

### 7.4 `creditsChange` reflects the net, not the raw delta
The balance moves twice (−wager at stake, payout at resolve). For the result screen, pass the **net** (`win:+wager / loss:−wager / tie:0`) so `GameTable`'s existing "+100 CR" display stays correct without change. The host computes it from `config.wager` + `outcome`.

## 8. Testing

- Engine unchanged — already covered.
- `resolveExit(status)` — pure, unit-tested (`in-progress → forfeit`, `resolved → free`).
- `computePayout(outcome, wager)` — pure, unit-tested against the §6 table.
- `stakeWager` / `resolveStake` services — integration-style tests (open→resolved, double-resolve no-op, lingering-open→abandoned, insufficient-credits guard).
- Host/provider are thin UI; keep logic in the pure helpers above. (Repo has no jsdom — DOM-heavy host tests are limited; lean on the pure helpers.)

## 9. Build order

Phases are independently shippable; escrow ships first, behind the existing in-panel UI:

1. **Wager escrow** — `CantinaStake` model, `stakeWager` / `resolveStake` services + routes, `computePayout`, hooks. Wire the *existing* in-panel cantina to stake-on-start / resolve-on-complete. No new UI. Verifiable on its own (closing the panel mid-game now correctly forfeits).
2. **Fullscreen host** — `MiniGameProvider`, `MiniGameHost`, registry, the `voids-gambit-game` component, `Dialog` `fullscreen`/`onCancel` extension, exit-guard + forfeit. Slim down the cantina page to launch via `session.start`.
3. **(Deferred)** back-button `popstate` interception, if the swallowed-back wart proves annoying.

## 10. Open / deferred

- Back-button interception (§2.1, §9 phase 3) — deferred unless it bites.
- Forfeit feedback — a brief toast/notification on forfeit ("Forfeited — lost {wager} CR") vs. silent. Minor; decide during build.
- Per-NPC win/loss tracking (from `mini-games.md` / `in-system-gameplay.md`) is **out of scope** here — `CantinaStake` could later carry `npcType`, but this spec covers only the surface + money flow.

## 11. Related design docs

- **[Mini-Games](./mini-games.md)** — the games that render on this surface (Void's Gambit live; Drift, Alignment, Cargo Roulette planned).
- **[In-System Gameplay](./in-system-gameplay.md)** — §8.5 (Void's Gambit integration) describes the game mounting inside the cantina location view; this spec refines that to "launches into a fullscreen host," and §9.4 (Mini-Game UI) is the surface this hosts.
