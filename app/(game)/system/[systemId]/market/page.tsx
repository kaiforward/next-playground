"use client";

import { use, useState, useCallback, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { useFleet } from "@/lib/hooks/use-fleet";
import { useMarket } from "@/lib/hooks/use-market";
import { usePriceHistory } from "@/lib/hooks/use-price-history";
import { useTradeMutation } from "@/lib/hooks/use-trade-mutation";
import { useConvoys, useConvoyTradeMutation } from "@/lib/hooks/use-convoy";
import { MarketTable } from "@/components/trade/market-table";
import { TradeForm } from "@/components/trade/trade-form";
import { PriceChart } from "@/components/trade/price-chart";
import { SupplyDemandChart } from "@/components/trade/supply-demand-chart";
import { FormError } from "@/components/form/form-error";
import { SelectInput } from "@/components/form/select-input";
import { QueryBoundary } from "@/components/ui/query-boundary";
import type { TradeType, CargoItemState } from "@/lib/types/game";
import { getCargoUsed } from "@/lib/utils/cargo";

/**
 * Parsed selection from the unified ship/convoy dropdown.
 * Format: "ship:{id}" or "convoy:{id}" or "" for browse-only.
 */
function parseSelection(value: string): { kind: "ship" | "convoy"; id: string } | null {
  if (value.startsWith("ship:")) return { kind: "ship", id: value.slice(5) };
  if (value.startsWith("convoy:")) return { kind: "convoy", id: value.slice(7) };
  return null;
}

function MarketContent({ systemId }: { systemId: string }) {
  const searchParams = useSearchParams();

  const { fleet } = useFleet();
  const { market, stationId } = useMarket(systemId);
  const { history } = usePriceHistory(systemId);
  const { convoys } = useConvoys();

  // Build initial selection from query params
  const initialShipId = searchParams.get("shipId");
  const initialConvoyId = searchParams.get("convoyId");
  const initialSelection = initialShipId
    ? `ship:${initialShipId}`
    : initialConvoyId
      ? `convoy:${initialConvoyId}`
      : "";

  const [selectedValue, setSelectedValue] = useState(initialSelection);
  const [selectedGoodId, setSelectedGoodId] = useState<string | undefined>();
  const [tradeError, setTradeError] = useState<string | null>(null);

  const selection = parseSelection(selectedValue);

  // Ships and convoys docked at this system
  const shipsHere = useMemo(
    () => fleet.ships.filter((s) => s.status === "docked" && s.systemId === systemId && !s.convoyId),
    [fleet, systemId],
  );

  const convoysHere = useMemo(
    () => convoys.filter((c) => c.status === "docked" && c.systemId === systemId),
    [convoys, systemId],
  );

  // Resolve the selected trading unit's cargo info
  const tradingUnit = useMemo(() => {
    if (!selection) return null;

    if (selection.kind === "ship") {
      const ship = shipsHere.find((s) => s.id === selection.id);
      if (!ship) return null;
      return {
        kind: "ship" as const,
        id: ship.id,
        name: ship.name,
        cargoMax: ship.cargoMax,
        cargo: ship.cargo,
      };
    }

    const convoy = convoysHere.find((c) => c.id === selection.id);
    if (!convoy) return null;

    // Aggregate cargo across all member ships
    const combinedCargo: CargoItemState[] = [];
    const cargoMap = new Map<string, CargoItemState>();
    for (const member of convoy.members) {
      for (const item of member.cargo) {
        const existing = cargoMap.get(item.goodId);
        if (existing) {
          existing.quantity += item.quantity;
        } else {
          const entry = { goodId: item.goodId, goodName: item.goodName, quantity: item.quantity };
          cargoMap.set(item.goodId, entry);
          combinedCargo.push(entry);
        }
      }
    }

    return {
      kind: "convoy" as const,
      id: convoy.id,
      name: convoy.name ?? "Convoy",
      cargoMax: convoy.combinedCargoMax,
      cargo: combinedCargo,
    };
  }, [selection, shipsHere, convoysHere]);

  // Mutation hooks (one for ships, one for convoys — only the active one fires)
  const shipTrade = useTradeMutation({
    shipId: tradingUnit?.kind === "ship" ? tradingUnit.id : null,
    stationId,
    systemId,
  });

  const convoyTrade = useConvoyTradeMutation({
    convoyId: tradingUnit?.kind === "convoy" ? tradingUnit.id : null,
    stationId,
    systemId,
  });

  const cargoUsed = useMemo(
    () => tradingUnit ? getCargoUsed(tradingUnit.cargo) : 0,
    [tradingUnit],
  );

  const cargoByGoodId = useMemo(
    () => new Map(tradingUnit?.cargo.map((c) => [c.goodId, c.quantity]) ?? []),
    [tradingUnit],
  );

  const currentCargoQuantity = useMemo(
    () => selectedGoodId && tradingUnit
      ? tradingUnit.cargo.find((c) => c.goodId === selectedGoodId)?.quantity ?? 0
      : 0,
    [tradingUnit, selectedGoodId],
  );

  const selectedGood = selectedGoodId
    ? market.find((e) => e.goodId === selectedGoodId)
    : undefined;

  const priceHistory = useMemo(() => {
    if (!selectedGoodId) return [];
    const goodHistory = history.find((h) => h.goodId === selectedGoodId);
    if (!goodHistory) return [];
    return goodHistory.points.map((p) => ({
      time: `T${p.tick}`,
      price: p.price,
    }));
  }, [history, selectedGoodId]);

  const handleTrade = useCallback(
    async (request: { goodId: string; quantity: number; type: TradeType }) => {
      setTradeError(null);
      try {
        if (tradingUnit?.kind === "convoy") {
          await convoyTrade.mutateAsync(request);
        } else {
          await shipTrade.mutateAsync(request);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Trade failed.";
        setTradeError(message);
        throw err;
      }
    },
    [tradingUnit, shipTrade, convoyTrade],
  );

  // Build dropdown options
  const dropdownOptions = useMemo(() => {
    const options: { value: string; label: string }[] = [
      { value: "", label: "Browse only" },
    ];

    for (const convoy of convoysHere) {
      const name = convoy.name ?? "Convoy";
      options.push({
        value: `convoy:${convoy.id}`,
        label: `${name} (${convoy.members.length} ships, ${convoy.combinedCargoMax} cargo)`,
      });
    }

    for (const ship of shipsHere) {
      options.push({
        value: `ship:${ship.id}`,
        label: `${ship.name} (${ship.cargoMax} cargo)`,
      });
    }

    return options;
  }, [shipsHere, convoysHere]);

  const hasTraders = shipsHere.length > 0 || convoysHere.length > 0;

  return (
    <>
      {/* Ship / convoy selector */}
      {hasTraders && (
        <div className="mb-6 max-w-sm">
          <SelectInput
            label="Trade with"
            size="md"
            options={dropdownOptions}
            value={selectedValue}
            onChange={(v) => {
              setSelectedValue(v);
              setTradeError(null);
            }}
            isSearchable={false}
          />
        </div>
      )}

      {/* Trade error banner */}
      <div className="mb-6">
        <FormError message={tradeError} variant="banner" onDismiss={() => setTradeError(null)} />
      </div>

      {/* Market table + Trade form */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className={tradingUnit && selectedGood ? "lg:col-span-2" : "lg:col-span-3"}>
          <div className="rounded-xl bg-white/5 backdrop-blur border border-white/10 overflow-hidden">
            <MarketTable
              entries={market}
              onSelectGood={setSelectedGoodId}
              selectedGoodId={selectedGoodId}
              cargoByGoodId={tradingUnit ? cargoByGoodId : undefined}
            />
          </div>
        </div>

        {tradingUnit && selectedGood && (
          <TradeForm
            good={selectedGood}
            playerCredits={fleet.credits}
            cargoUsed={cargoUsed}
            cargoMax={tradingUnit.cargoMax}
            currentCargoQuantity={currentCargoQuantity}
            shipName={tradingUnit.name}
            onTrade={handleTrade}
          />
        )}
      </div>

      {/* Price chart */}
      {selectedGood && priceHistory.length > 0 && (
        <div className="mt-8">
          <PriceChart data={priceHistory} goodName={selectedGood.goodName} cargoQuantity={currentCargoQuantity} />
        </div>
      )}

      {/* Supply/demand chart */}
      <div className="mt-8">
        <SupplyDemandChart entries={market} />
      </div>
    </>
  );
}

export default function SystemMarketPage({
  params,
}: {
  params: Promise<{ systemId: string }>;
}) {
  const { systemId } = use(params);

  return (
    <QueryBoundary>
      <MarketContent systemId={systemId} />
    </QueryBoundary>
  );
}
