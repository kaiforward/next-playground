import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ResourceVectorBars } from "./resource-vector-bars";
import type { BodyView } from "@/lib/types/api";

/**
 * One physical body in a system's substrate. Habitable bodies get a green
 * left-accent stripe (overriding the default copper). Resources read rich-first
 * with trace resources collapsed.
 */
export function BodyCard({ body }: { body: BodyView }) {
  return (
    <Card padding="sm" className={body.habitable ? "border-l-status-green" : undefined}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h4 className="font-display text-sm font-semibold text-text-primary">
          {body.archetypeName}
        </h4>
        {body.habitable && <Badge color="green">Habitable</Badge>}
      </div>
      <div className="mb-3 flex gap-4 text-xs text-text-tertiary">
        <span>
          Size <span className="font-mono text-text-secondary">{body.size.toFixed(2)}</span>
        </span>
        <span>
          Pop weight{" "}
          <span className="font-mono text-text-secondary">{body.popCapWeight.toFixed(0)}</span>
        </span>
      </div>
      <ResourceVectorBars vector={body.resources} sort collapseTrace />
      {body.richness.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {body.richness.map((r) => (
            <Badge key={r.id} color="amber" variant="outline">
              {r.name} ×{r.multiplier} {r.resource}
            </Badge>
          ))}
        </div>
      )}
    </Card>
  );
}
