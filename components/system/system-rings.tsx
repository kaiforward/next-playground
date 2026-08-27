"use client";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { BodyReadout } from "@/components/system/body-readout";
import { ringLayout } from "@/components/system/ring-layout";
import { SUN_CLASS_COLORS } from "@/lib/constants/ui";
import type { BodyView } from "@/lib/types/api";
import type { SunClass } from "@/lib/types/game";

/**
 * The system panel's usable square in the same logical units `ringLayout` resolves against — the
 * SVG's `viewBox` and every overlay button's percentage position share this one number, so the
 * diagram scales with its container (an SVG `viewBox` is resolution-independent) while the maths
 * behind it stays fixed. Not the panel's literal pixel width: `ring-layout.test.ts` exercises the
 * real worst case (`PANEL_SIZE = 512`) against `detail-panel.tsx`'s usable width, and this constant
 * only has to share that coordinate space, not its exact pixel count.
 */
const VIEW_SIZE = 480;

const RING_COLOR = "var(--color-border-strong)";
const BODY_COLOR_DEFAULT = "var(--color-text-secondary)";
const BODY_COLOR_OCCUPIED = "var(--color-status-green)";
const LOCKED_STROKE = "var(--color-text-tertiary)";
const DASH = "4 3";

function bodyColor(body: BodyView): string {
  return body.occupied ? BODY_COLOR_OCCUPIED : BODY_COLOR_DEFAULT;
}

/**
 * The system-as-a-place diagram: a star at the centre, one ring per body, drawn from `ringLayout`'s
 * numbers alone (`docs/active/gameplay/system-view.md` → "What is drawn"). Every co-ordinate here is
 * read off `RingLayout`/`RingBody` — this component does no placement arithmetic of its own.
 *
 * Each body is ALSO a real `<button>`, absolutely positioned over its `ringLayout` point and wired
 * through the shared `Popover` — real button semantics and keyboard reachability (Tab, then
 * ArrowDown to enter the card, Escape to return) come from composing that component rather than
 * hand-rolling focus/keyboard handling on an SVG element. The popover's own exclusivity registry is
 * what keeps at most one body's card open at a time; nothing here reimplements it.
 *
 * An asteroid belt is the one body with no on-ring mark: instead its orbit ring itself is drawn
 * dashed, wide enough to read as the belt rather than a body's path. Its trigger button still sits
 * at the same `ringLayout` point every other body's does, so it stays exactly as reachable.
 */
export function SystemRings({ bodies, sunClass }: { bodies: BodyView[]; sunClass: SunClass }) {
  if (bodies.length === 0) return null;

  const layout = ringLayout(bodies, VIEW_SIZE);

  return (
    <div className="relative mx-auto aspect-square w-full max-w-[420px]">
      <svg viewBox={`0 0 ${VIEW_SIZE} ${VIEW_SIZE}`} className="absolute inset-0 h-full w-full" aria-hidden>
        <circle cx={layout.cx} cy={layout.cy} r={layout.starRadius} fill={SUN_CLASS_COLORS[sunClass]} />

        {bodies.map((body) => {
          const rb = layout.bodies[body.id];
          const isBelt = body.bodyType === "asteroid_belt";
          return (
            <circle
              key={`ring-${body.id}`}
              data-orbit-ring={body.id}
              cx={layout.cx}
              cy={layout.cy}
              r={rb.ringRadius}
              fill="none"
              stroke={isBelt ? bodyColor(body) : RING_COLOR}
              strokeWidth={isBelt ? 1.5 : 1}
              strokeDasharray={isBelt ? DASH : undefined}
            />
          );
        })}

        {bodies
          .filter((body) => body.bodyType !== "asteroid_belt")
          .map((body) => {
            const rb = layout.bodies[body.id];
            const dashed = body.locked;
            return (
              <circle
                key={`body-${body.id}`}
                data-body-mark={body.id}
                cx={rb.cx}
                cy={rb.cy}
                r={rb.radius}
                fill={dashed ? "none" : bodyColor(body)}
                stroke={dashed ? (body.occupied ? BODY_COLOR_OCCUPIED : LOCKED_STROKE) : "none"}
                strokeWidth={dashed ? 1.5 : undefined}
                strokeDasharray={dashed ? DASH : undefined}
              />
            );
          })}
      </svg>

      {bodies.map((body) => {
        const rb = layout.bodies[body.id];
        // Unit conversion only — `rb.hitRadius` already carries the sizing decision
        // (`ring-layout.ts`); this line just maps it into the overlay's percentage co-ordinate
        // space, the same way `left`/`top` below map `cx`/`cy`.
        const diameterPct = ((rb.hitRadius * 2) / VIEW_SIZE) * 100;
        return (
          <Popover key={body.id}>
            <PopoverTrigger>
              <button
                type="button"
                aria-label={body.archetypeName}
                className="absolute cursor-pointer rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                style={{
                  left: `${(rb.cx / VIEW_SIZE) * 100}%`,
                  top: `${(rb.cy / VIEW_SIZE) * 100}%`,
                  width: `${diameterPct}%`,
                  height: `${diameterPct}%`,
                  transform: "translate(-50%, -50%)",
                }}
              />
            </PopoverTrigger>
            <PopoverContent
              aria-label={body.archetypeName}
              className={body.occupied ? "border-l-status-green" : undefined}
            >
              <BodyReadout body={body} />
            </PopoverContent>
          </Popover>
        );
      })}
    </div>
  );
}
