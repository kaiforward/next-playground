import { Badge } from "@/components/ui/badge";
import { bodyDepositFeatures } from "@/lib/utils/substrate";
import { QUALITY_BAND_DOT, QUALITY_BAND_TEXT } from "@/lib/constants/ui";
import type { BodyView } from "@/lib/types/api";

/**
 * The body's detail readout — one physical body's people-land budget plus the deposits it hosts.
 * Surface-less by design: it renders no `Card`, border or background of its own, so every caller
 * owns the surface it sits in (the Astrography body list wraps every body's readout in one shared
 * `Card`, divider-separated, rather than giving each body its own card; the system ring diagram's
 * popover renders it directly, since `PopoverContent` is already a surface and a nested `Card`
 * inside it doubled the left accent stripe).
 *
 * The header row is `flex-wrap`, name and Occupied badge only; habitable land and habitability
 * each get their own labelled row below it, so they read at the popover's narrow, fixed width just
 * as they do at the Astrography list's full-width row — nothing here reads a width or a prop to
 * decide layout.
 *
 * The left-accent stripe (applied by whichever surface wraps this) and an "Occupied" badge mark a
 * body inside the system's current fill-best-first occupied prefix (the cached habitability
 * quality fold, read straight off `body.occupied` — this component computes nothing). That
 * replaces the retired per-body `habitable: boolean` and its "Habitable" badge.
 *
 * `body.score` renders as a labelled percentage under "Habitability", never the deposit-quality
 * band vocabulary (Poor/Average/Good/Rich) below it — that vocabulary grades extraction yield, and
 * a habitability rating wearing it reads as a yield label, which is what it used to be.
 *
 * The word is the same one the Astrography header uses for the SYSTEM (`growthMultiplier`, a fold
 * across occupied bodies feeding the growth modifier), and deliberately so: habitability scopes
 * itself to whatever it describes, so a body has one and so does the system. They are different
 * quantities, and a body at 100% under a system at 87% is not an arithmetic contradiction — the
 * header's figure carries a tooltip decomposing itself into these very bodies, which is where the
 * relationship is shown rather than left to be inferred from a label.
 *
 * Locked bodies still show their authored budgets/deposits: they're dark (present but
 * non-functional) until a future technology unlocks them, not absent — a lock states itself in its
 * own badge below the header, never by hiding the stats. Extraction YIELD (a percentage of normal)
 * is a system-level story and is never shown here — see the deposit table's yield tag. Each
 * deposit line does show this body's own worked/total slot count, though: physical occupancy of
 * its own ground, not the system's blended yield.
 */
export function BodyReadout({ body }: { body: BodyView }) {
  const features = bodyDepositFeatures(body.counts, body.quality, body.workedCounts);
  const habitabilityPct = Math.round(body.score * 100);
  return (
    <>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <h4 className="font-display text-sm font-semibold text-text-primary">
          {body.archetypeName}
        </h4>
        {body.occupied && <Badge color="green">Occupied</Badge>}
      </div>
      <div className="mb-2 space-y-0.5 text-xs text-text-tertiary">
        <div className="whitespace-nowrap">
          <span className="font-display">Habitable land</span>{" "}
          <span className="font-mono text-text-secondary">{body.peopleLand.toFixed(0)}</span>
        </div>
        <div className="whitespace-nowrap">
          <span className="font-display">Habitability</span>{" "}
          <span className="font-mono text-text-secondary">{habitabilityPct}%</span>
        </div>
      </div>
      {body.locked && (
        <div className="mb-2">
          <Badge color="slate" variant="outline">
            Locked — awaiting technology
          </Badge>
        </div>
      )}
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
