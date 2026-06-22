import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { bodyDepositFeatures } from "@/lib/utils/substrate";
import { QUALITY_BAND_DOT, QUALITY_BAND_TEXT } from "@/lib/constants/ui";
import type { BodyView } from "@/lib/types/api";

/**
 * One physical body in a system's substrate — flavour, not function. Habitable
 * bodies get a green left-accent stripe (overriding the default copper). Lists
 * the deposits the body hosts as named features, grade-coloured (richest first);
 * the worked / yield state of those deposits lives on the Industry tab.
 */
export function BodyCard({ body }: { body: BodyView }) {
  const features = bodyDepositFeatures(body.slots, body.quality);
  return (
    <Card padding="sm" className={body.habitable ? "border-l-status-green" : undefined}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h4 className="font-display text-sm font-semibold text-text-primary">
          {body.archetypeName}
        </h4>
        {body.habitable && <Badge color="green">Habitable</Badge>}
      </div>
      <div className="flex gap-4 text-xs text-text-tertiary">
        <span>
          Size <span className="font-mono text-text-secondary">{body.size.toFixed(2)}</span>
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
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
