/**
 * System-view ring geometry: the star's centre/radius plus, per body, its ring radius, drawn
 * centre co-ordinates and drawn circle radius. Pure maths, no DOM — the unit project has no
 * jsdom, so the geometry that deserves tests lives here and the rendering component stays a thin
 * renderer over these numbers, the same split `provision-view.ts` uses in this directory.
 *
 * Placement is derived, never stored (`docs/active/gameplay/system-view.md` → "Where on the
 * ring"): a body's angle comes from its `orbitIndex` alone, at the golden angle per step, so
 * successive bodies never bunch and the arrangement is identical on every call for the same
 * input. Ring radii are likewise derived from `orbitIndex` (ring 1 innermost, nearest the star)
 * and spaced against the authored display-size band so the worst case — eight bodies, all at
 * maximum size — still fits the panel and never overlaps.
 */
import { DISPLAY_SIZE_MAX, DISPLAY_SIZE_MIN } from "@/lib/constants/bodies";
import type { BodyView } from "@/lib/types/api";

/** Degrees between successive bodies around their rings. Never a divisor of 360°, so no body
 *  count ever bunches bodies at a repeating angle (spec → "Where on the ring"). */
const GOLDEN_ANGLE_DEG = 137.5;

/** Star radius as a fraction of the panel's `size`, so the star scales with the drawn square
 *  rather than a fixed pixel count. */
const STAR_RADIUS_FRAC = 0.05;

/**
 * Drawn body-circle radius band, as a fraction of `size` — the pixel ends a body's authored
 * `DISPLAY_SIZE_MIN..MAX` size maps onto. Kept small relative to `STAR_RADIUS_FRAC` and the
 * per-ring spacing budget below (see the module test's fit/overlap fixtures) so the eight-ring,
 * all-maximum-size worst case still fits inside the panel without any two adjacent rings'
 * bodies overlapping.
 */
const BODY_RADIUS_FRAC_MIN = 0.012;
const BODY_RADIUS_FRAC_MAX = 0.02;

/** One body's resolved geometry, every field a real number ready for an SVG attribute. */
export interface RingBody {
  /** Distance from the star's centre to this body's ring. */
  ringRadius: number;
  /** This body's drawn centre, in the same co-ordinate space as `RingLayout.cx/cy`. */
  cx: number;
  cy: number;
  /** This body's drawn circle radius. */
  radius: number;
  /**
   * This body's interactive (pointer/touch) hit-target radius — never smaller than `radius`.
   * The same value for every body in a system, regardless of its own drawn size: it is always
   * `BODY_RADIUS_FRAC_MAX` of `size`, the largest radius any body ever draws. A small body is
   * therefore no harder to hit than a large one, and the value is exactly the bound the ring
   * spacing below already computes its fit and no-overlap budgets against, so no separate budget
   * is needed for the hit target.
   */
  hitRadius: number;
}

export interface RingLayout {
  /** The star's drawn centre — also the common centre every ring is drawn around. */
  cx: number;
  cy: number;
  /** The star's drawn circle radius. */
  starRadius: number;
  /** Per-body resolved geometry, keyed by `BodyView.id`. */
  bodies: Record<string, RingBody>;
}

/** Maps a body's authored `size` onto [0, 1] against the fixed display-size band, clamped so an
 *  out-of-band value (or a degenerate zero-span band) never produces a radius outside the drawn
 *  band or a non-finite fraction. */
function sizeFraction(bodySize: number): number {
  const span = DISPLAY_SIZE_MAX - DISPLAY_SIZE_MIN;
  const t = span > 0 ? (bodySize - DISPLAY_SIZE_MIN) / span : 0;
  return Math.min(1, Math.max(0, t));
}

/**
 * Resolves ring geometry for a system's bodies inside a `size`×`size` square. Nothing is stored
 * and nothing is random: the same `bodies`/`size` always resolve to the same `RingLayout`.
 *
 * Ring radii are spaced equally across the budget between the star's edge and the panel's usable
 * half-width, MINUS the maximum drawn body radius — so even a body at `DISPLAY_SIZE_MAX` on the
 * outermost ring stays inside the square. That same equal spacing, divided across up to eight
 * rings, is kept wider than twice the maximum drawn radius, which is what guarantees two adjacent
 * rings' bodies never overlap regardless of the angle either lands at.
 *
 * Both guarantees extend to `hitRadius` for free: it is always exactly `BODY_RADIUS_FRAC_MAX` of
 * `size` — the same bound `bodyRadiusMax` above already reserves from the fit and no-overlap
 * budgets — so no separate budget is needed for the hit target.
 */
export function ringLayout(bodies: BodyView[], size: number): RingLayout {
  // A degenerate `size` (zero, negative, non-finite) still resolves to a valid, non-negative
  // layout rather than propagating NaN/Infinity into every field.
  const s = Number.isFinite(size) ? Math.max(0, size) : 0;
  const cx = s / 2;
  const cy = s / 2;
  const starRadius = s * STAR_RADIUS_FRAC;
  const bodyRadiusMax = s * BODY_RADIUS_FRAC_MAX;

  const ringCount = Math.max(bodies.length, 1);
  const available = Math.max(0, s / 2 - starRadius - bodyRadiusMax);
  const ringSpacing = available / ringCount;

  const out: Record<string, RingBody> = {};
  for (const body of bodies) {
    const ringRadius = starRadius + ringSpacing * body.orbitIndex;
    const angleRad = (body.orbitIndex * GOLDEN_ANGLE_DEG * Math.PI) / 180;
    const radiusFrac = BODY_RADIUS_FRAC_MIN
      + sizeFraction(body.size) * (BODY_RADIUS_FRAC_MAX - BODY_RADIUS_FRAC_MIN);

    const radius = s * radiusFrac;
    out[body.id] = {
      ringRadius,
      cx: cx + ringRadius * Math.cos(angleRad),
      cy: cy + ringRadius * Math.sin(angleRad),
      radius,
      hitRadius: bodyRadiusMax,
    };
  }

  return { cx, cy, starRadius, bodies: out };
}
