import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { BodyView } from "@/lib/types/api";

/**
 * One physical body in a system's substrate. Habitable bodies get a green
 * left-accent stripe (overriding the default copper). Shows body type, size,
 * and habitability — the full deposit/space view returns with the P6 panel.
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
      <div className="flex gap-4 text-xs text-text-tertiary">
        <span>
          Size <span className="font-mono text-text-secondary">{body.size.toFixed(2)}</span>
        </span>
      </div>
    </Card>
  );
}
