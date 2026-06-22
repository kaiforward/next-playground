import { prepareTradeBars } from "@/lib/utils/substrate";
import type { SubstrateGoodRate } from "@/lib/engine/physical-economy";

function netClass(net: number): string {
  if (net > 0) return "text-green-400";
  if (net < 0) return "text-red-400";
  return "text-text-secondary";
}

/**
 * Per-good production/consumption profile as diverging bars: consumption grows
 * left from the centre, production grows right, both scaled to the system's
 * largest single rate. The asymmetry is the net balance, shown numerically on
 * the right and coloured by direction (green = net export, red = net import).
 * Goods are ordered net exporters first.
 */
export function SubstrateTradeBars({ goods }: { goods: SubstrateGoodRate[] }) {
  const bars = prepareTradeBars(goods);
  if (bars.length === 0) {
    return <p className="text-sm text-text-tertiary">No trade profile.</p>;
  }

  return (
    <div className="space-y-2">
      {/* Legend */}
      <div className="flex items-center gap-2 text-xs text-text-tertiary">
        <span className="w-24 shrink-0" />
        <div className="flex flex-1 items-center justify-between">
          <span>&#9664; Consumes</span>
          <span>Produces &#9654;</span>
        </div>
        <span className="w-16 shrink-0 text-right">Net/cyc</span>
      </div>

      {bars.map((b) => (
        <div
          key={b.goodId}
          className="flex items-center gap-2"
          title={`Produces ${b.production.toFixed(1)}/cyc · Consumes ${b.consumption.toFixed(1)}/cyc`}
        >
          <span className="w-24 shrink-0 truncate text-xs text-text-secondary">{b.name}</span>
          <div className="flex flex-1 items-center">
            {/* Consumption — fills leftward from the centre divider. */}
            <div className="flex h-2 flex-1 justify-end overflow-hidden bg-surface-active">
              <div className="h-full bg-red-500/70" style={{ width: `${b.consFraction * 100}%` }} />
            </div>
            <div className="h-3 w-px shrink-0 bg-border" />
            {/* Production — fills rightward from the centre divider. */}
            <div className="flex h-2 flex-1 overflow-hidden bg-surface-active">
              <div className="h-full bg-green-500/70" style={{ width: `${b.prodFraction * 100}%` }} />
            </div>
          </div>
          <span className={`w-16 shrink-0 text-right font-mono text-xs ${netClass(b.net)}`}>
            {b.net > 0 ? "+" : ""}{b.net.toFixed(1)}
          </span>
        </div>
      ))}
    </div>
  );
}
