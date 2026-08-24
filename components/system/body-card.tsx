import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipTriggerLabel, TooltipContent } from "@/components/ui/tooltip";
import { bodyDepositFeatures, habitabilityScoreBand } from "@/lib/utils/substrate";
import { QUALITY_BAND_DOT, QUALITY_BAND_TEXT, QUALITY_BAND_LABEL } from "@/lib/constants/ui";
import type { BodyView } from "@/lib/types/api";

/**
 * One physical body in a system's substrate — the people-land budget and extraction contribution
 * weight plus the deposits it hosts. The left-accent stripe and an
 * "Occupied" badge mark a body inside the system's current fill-best-first occupied prefix (the
 * cached habitability quality fold, read straight off `body.occupied` — this component computes nothing).
 * That replaces the retired per-body `habitable: boolean` and its "Habitable" badge: habitability
 * is now a score BAND (dot + label, the same vocabulary the deposit list already uses), shown for
 * every body including a locked one — a lock states itself in its own badge, never by hiding the
 * band. Locked bodies still show their authored budgets/deposits: they're dark (present but
 * non-functional) until a future technology unlocks them, not absent.
 */
export function BodyCard({ body }: { body: BodyView }) {
  const features = bodyDepositFeatures(body.counts, body.quality);
  const band = habitabilityScoreBand(body.score);
  return (
    <Card padding="sm" className={body.occupied ? "border-l-status-green" : undefined}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h4 className="font-display text-sm font-semibold text-text-primary">
          {body.archetypeName}
        </h4>
        <span className="flex shrink-0 items-center gap-1.5">
          {body.occupied && <Badge color="green">Occupied</Badge>}
          {body.locked && (
            <Badge color="slate" variant="outline">
              Locked — awaiting technology
            </Badge>
          )}
          <span className="inline-flex items-center gap-1 text-xs">
            <span aria-hidden className={`inline-block h-1.5 w-1.5 shrink-0 ${QUALITY_BAND_DOT[band]}`} />
            <span className={QUALITY_BAND_TEXT[band]}>{QUALITY_BAND_LABEL[band]}</span>
          </span>
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-tertiary">
        <span>
          Size <span className="font-mono text-text-secondary">{body.size.toFixed(2)}</span>
        </span>
        <span>
          People land <span className="font-mono text-text-secondary">{body.peopleLand.toFixed(0)}</span>
        </span>
        <Tooltip>
          <TooltipTriggerLabel className="text-xs">
            Extraction <span className="font-mono text-text-secondary">×{body.extractionModifier.toFixed(2)}</span>{" "}
            contribution weight
          </TooltipTriggerLabel>
          <TooltipContent className="w-56">
            Weights this body&rsquo;s share of the system&rsquo;s shared effective yield — extractors are a
            per-system pool, never placed on one body alone.
          </TooltipContent>
        </Tooltip>
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
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
