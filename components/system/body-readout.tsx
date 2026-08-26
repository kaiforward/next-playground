import { Badge } from "@/components/ui/badge";
import { bodyDepositFeatures, habitabilityScoreBand } from "@/lib/utils/substrate";
import { QUALITY_BAND_DOT, QUALITY_BAND_TEXT, QUALITY_BAND_LABEL } from "@/lib/constants/ui";
import type { BodyView } from "@/lib/types/api";

/**
 * The body's detail readout — one physical body's people-land budget plus the deposits it hosts.
 * Surface-less by design: it renders no `Card`, border or background of its own, so every caller
 * owns the surface it sits in (`BodyCard` wraps it in a `Card` for the Astrography body grid; the
 * system ring diagram's popover renders it directly, since `PopoverContent` is already a surface
 * and a nested `Card` inside it doubled the left accent stripe).
 *
 * The left-accent stripe (applied by whichever surface wraps this) and an "Occupied" badge mark a
 * body inside the system's current fill-best-first occupied prefix (the cached habitability
 * quality fold, read straight off `body.occupied` — this component computes nothing). That
 * replaces the retired per-body `habitable: boolean` and its "Habitable" badge: habitability is
 * now a score BAND (dot + label, the same vocabulary the deposit list already uses), shown for
 * every body including a locked one — a lock states itself in its own badge, never by hiding the
 * band. Locked bodies still show their authored budgets/deposits: they're dark (present but
 * non-functional) until a future technology unlocks them, not absent. Extraction YIELD (a
 * percentage of normal) is a system-level story and is never shown here — see the deposit table's
 * yield tag. Each deposit line does show this body's own worked/total slot count, though:
 * physical occupancy of its own ground, not the system's blended yield.
 */
export function BodyReadout({ body }: { body: BodyView }) {
  const features = bodyDepositFeatures(body.counts, body.quality, body.workedCounts);
  const band = habitabilityScoreBand(body.score);
  return (
    <>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h4 className="font-display text-sm font-semibold text-text-primary">
          {body.archetypeName}
        </h4>
        <span className="flex shrink-0 items-center gap-1.5">
          {body.occupied && <Badge color="green">Occupied</Badge>}
          <span className="inline-flex items-center gap-1 text-xs">
            <span aria-hidden className={`inline-block h-1.5 w-1.5 shrink-0 ${QUALITY_BAND_DOT[band]}`} />
            <span className={QUALITY_BAND_TEXT[band]}>{QUALITY_BAND_LABEL[band]}</span>
          </span>
        </span>
      </div>
      {body.locked && (
        <div className="mb-2">
          <Badge color="slate" variant="outline">
            Locked — awaiting technology
          </Badge>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-tertiary">
        <span>
          Habitable land <span className="font-mono text-text-secondary">{body.peopleLand.toFixed(0)}</span>
        </span>
      </div>
      {features.length > 0 && (
        <ul className="mt-2 space-y-1">
          {features.map((f) => (
            <li key={f.resource} className="flex items-center gap-1.5 text-xs">
              <span
                aria-hidden
                className={`inline-block h-1.5 w-1.5 shrink-0 ${QUALITY_BAND_DOT[f.band]}`}
              />
              <span className={QUALITY_BAND_TEXT[f.band]}>{f.name}</span>
              <span className="ml-auto font-mono text-text-tertiary">{f.worked}/{f.total} worked</span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
