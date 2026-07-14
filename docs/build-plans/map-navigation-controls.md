# Map Navigation Controls — build plan

Small map-UX fix that unblocks moving around the galaxy. Transient plan — delete once shipped; fold a
one-line "Navigation" note into `docs/active/engineering/map-rendering.md` and let the code be the truth.

## Problem

Now that WS1 made every Voronoi cell clickable (cells tile the whole extent), the map "swallows all clicks":
`interactions.ts` selects a system/faction on pointer**down**, so a press-drag opens a panel instantly, and
the centered `DetailPanel` backdrop (`inset-0`, z-30) then eats the rest of the gesture — you can't drag to
pan. There's also no keyboard panning. The camera *already* implements drag-pan (`camera.ts:173-193`); the
selection timing is what breaks it.

## Approved design

Two behaviours, one PR. No visual/layout change (that's WS4) — behavioural only, so no prototype.

### 1. Keyboard panning

- **Keys:** WASD **and** arrow keys. Held for continuous panning; two keys held → diagonal.
- **Feel:** constant **screen-space** speed, integrated per-frame off the existing ticker (smooth, not
  steppy). `Shift` = 2× boost. Diagonal direction is **normalised** so W+D isn't √2 faster than W alone.
- **Focus model:** **window-level** `keydown`/`keyup` so panning works whenever the map is up without
  clicking it first — **guarded** to ignore keys when focus is in an `INPUT`/`TEXTAREA`/`SELECT` or
  `isContentEditable` (save-name box, dev tools) so it never hijacks typing. Works with a panel open.
- First pan keypress **cancels any in-flight camera animation** (`fitView` / "Show on Map" glide) so the
  player takes over instantly.
- **Zoom stays on the wheel** — no keyboard zoom in this pass.

### 2. Mouse-drag disambiguation

- Move system/faction selection from stage `pointerdown` → `pointerup`, and **only select if the pointer
  moved < `CLICK_DRAG_THRESHOLD` (~5px screen)** between down and up. Move more → it was a drag → the camera
  pans (as it already does) and nothing is selected.
- **Fold the per-star `pointerdown`-select** (`interactions.ts` `bindSystem`) into the same stage-level
  pointer-up cell hit-test — a star always sits inside its own cell, so one selection path covers direct
  hits and near-misses. Keep the star's `pointerover`/`pointerout` hover.

## Touch-points

- **`components/map/pixi/theme.ts`** — add `CAMERA.panKeySpeed` (px/s, screen-space), `CAMERA.panKeyBoost`
  (×2), and `CLICK_DRAG_THRESHOLD` (px).
- **`components/map/pixi/camera.ts`** — held-key state (`Set<direction>`), window `keydown`/`keyup` bound in
  `attach()` / unbound in `detach()` with the input-focus guard, and per-frame pan integration inside the
  existing `update(dtMs)` (normalised direction × speed × boost × dtMs ÷ zoom). **Integrate held-key pan
  before `update()`'s current `if (!this.animation) return false` early-return** (today it no-ops when idle),
  and make `update` report "changed" when a key is held. Pressing a pan key clears any active animation.
- **`components/map/pixi/interactions.ts`** — record pointerdown screen pos; bind stage `pointerup`; select
  on up only when movement < threshold; drop `bindSystem`'s `pointerdown` handler (keep hover).
- **`pixi-map-canvas.tsx`** — no change expected (ticker already runs `camera.update(dtMs)`; `attach/detach`
  already wired). Confirm cleanup still symmetric.

## Test plan (TDD, pure logic — no DOM/Pixi)

- **`camera.test.ts`**
  - held `KeyW` for one `update(16)` moves `y` up by `panKeySpeed·(16/1000)/zoom`; zoom-invariant in
    screen space (same screen delta at zoom 0.5 and 2).
  - `Shift` doubles the delta; diagonal (W+D) has the **same speed** as a single axis (normalised), split
    across x/y.
  - opposing keys (W+S) cancel to zero; no keys → `update` returns/does nothing.
  - a pan keypress cancels an in-flight `animateTo`.
- **click-vs-drag helper** (extract a pure `movedBeyond(ax, ay, bx, by, threshold)` or similar)
  - < threshold → click (select); ≥ threshold → drag (suppress select).

Guarded-focus behaviour (ignore keys while typing) is a thin DOM wrapper — cover with an inline `globalThis`
stub if cheap, else exercise it in the manual smoke.

## Tasks

1. Constants in `theme.ts` + pure helpers, with tests (red → green).
2. Keyboard state + `update()` integration in `camera.ts`, with tests.
3. Window listeners + focus guard in `attach/detach`.
4. Pointer-up + threshold selection in `interactions.ts`; drop per-star pointerdown-select.
5. Manual smoke: WASD/arrows pan (incl. diagonal + Shift), drag pans without selecting, a short click still
   selects, typing in the save-name box doesn't pan, panning works with a panel open.

## Lifecycle

Single PR → shared `feat/economy-rework-base`. On ship: add a one-line "Navigation" note to
`map-rendering.md`, delete this build plan.
