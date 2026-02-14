"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useEconomySnapshot, useResetEconomyMutation } from "@/lib/hooks/use-dev-tools";

export function EconomyOverviewSection() {
  const [showAll, setShowAll] = useState(false);
  const { data, isLoading } = useEconomySnapshot(true);
  const resetMutation = useResetEconomyMutation();
  const [confirmReset, setConfirmReset] = useState(false);

  const systems = data?.systems ?? [];
  const displayed = showAll ? systems : systems.slice(0, 10);

  return (
    <div className="space-y-3">
      {isLoading ? (
        <p className="text-xs text-white/40">Loading economy...</p>
      ) : (
        <>
          <div className="max-h-64 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-gray-900">
                <tr className="text-white/50 text-left">
                  <th className="py-1 pr-2">System</th>
                  <th className="py-1 pr-2">Type</th>
                  <th className="py-1 text-right">Goods</th>
                </tr>
              </thead>
              <tbody>
                {displayed.map((sys) => {
                  const avgPrice =
                    sys.markets.length > 0
                      ? Math.round(
                          sys.markets.reduce((s, m) => s + m.price, 0) / sys.markets.length,
                        )
                      : 0;
                  return (
                    <tr key={sys.systemId} className="border-t border-white/5">
                      <td className="py-1 pr-2 text-white/70 truncate max-w-[100px]">
                        {sys.systemName}
                      </td>
                      <td className="py-1 pr-2 text-white/40">{sys.economyType}</td>
                      <td className="py-1 text-right text-white/50">
                        avg {avgPrice}cr
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {systems.length > 10 && (
            <Button variant="ghost" size="xs" onClick={() => setShowAll(!showAll)}>
              {showAll ? "Show less" : `Show all ${systems.length}`}
            </Button>
          )}
        </>
      )}

      <div className="border-t border-white/10 pt-2">
        {confirmReset ? (
          <div className="flex gap-2">
            <Button
              variant="action"
              color="red"
              size="xs"
              onClick={() => {
                resetMutation.mutate();
                setConfirmReset(false);
              }}
              disabled={resetMutation.isPending}
            >
              Confirm Reset
            </Button>
            <Button variant="ghost" size="xs" onClick={() => setConfirmReset(false)}>
              Cancel
            </Button>
          </div>
        ) : (
          <Button
            variant="action"
            color="red"
            size="xs"
            onClick={() => setConfirmReset(true)}
            disabled={resetMutation.isPending}
          >
            Reset Economy
          </Button>
        )}

        {resetMutation.data && (
          <p className="text-xs text-green-400 mt-1">
            Reset {resetMutation.data.marketsReset} markets, cleared{" "}
            {resetMutation.data.eventsCleared} events
          </p>
        )}
      </div>
    </div>
  );
}
