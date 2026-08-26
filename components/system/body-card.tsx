import { Card } from "@/components/ui/card";
import { BodyReadout } from "@/components/system/body-readout";
import type { BodyView } from "@/lib/types/api";

/**
 * `BodyReadout` wrapped in its own `Card` — the standalone tile used by the Astrography body grid,
 * where nothing else supplies a surface. The occupied left-accent stripe lives here, on the
 * `Card`, not in `BodyReadout` itself; a caller with its own surface (the system ring diagram's
 * popover) applies the same stripe to that surface instead, rather than nesting a second `Card`
 * inside it.
 */
export function BodyCard({ body }: { body: BodyView }) {
  return (
    <Card padding="sm" className={body.occupied ? "border-l-status-green" : undefined}>
      <BodyReadout body={body} />
    </Card>
  );
}
