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
import { SelectInput, type SelectOption } from "@/components/form/select-input";
import { QueryBoundary } from "@/components/ui/query-boundary";
import type { TradeType } from "@/lib/types/game";
import type { FleetUnitRef } from "@/lib/types/tradable";
import { shipToTradableUnit, convoyToTradableUnit } from "@/lib/types/tradable";
import { getCargoUsed } from "@/lib/utils/cargo";
import { getDockedShips, getDockedConvoys } from "@/lib/utils/fleet";

const fleetUnitRefKey = (ref: FleetUnitRef | null): string =>
  ref ? `${ref.kind}:${ref.id}` : "";

function MarketContent({ systemId }: { systemId: string }) {
  const searchParams = useSearchParams();

  const { fleet } = useFleet();
  const { market, stationId } = useMarket(systemId);
  const { history } = usePriceHistory(systemId);
  const { convoys } = useConvoys();

  // Build initial selection from query params
  const initialShipId = searchParams.get("shipId");
  const initialConvoyId = searchParams.get("convoyId");
  const initialRef: FleetUnitRef | null = initialShipId
    ? { kind: "ship", id: initialShipId }
    : initialConvoyId
      ? { kind: "convoy", id: initialConvoyId }
      : null;

  const [selectedRef, setSelectedRef] = useState<FleetUnitRef | null>(initialRef);
  const [selectedGoodId, setSelectedGoodId] = useState<string | undefined>();
  const [tradeError, setTradeError] = useState<string | null>(null);

  // Ships and convoys docked at this system
  const shipsHere = useMemo(
    () => getDockedShips(fleet.ships, systemId),
    [fleet, systemId],
  );

  const convoysHere = useMemo(
    () => getDockedConvoys(convoys, systemId),
    [convoys, systemId],
  );

  // Resolve the selected trading unit's cargo info
  const tradingUnit = useMemo(() => {
    if (!selectedRef) return null;

    if (selectedRef.kind === "ship") {
      const ship = shipsHere.find((s) => s.id === selectedRef.id);
      return ship ? shipToTradableUnit(ship) : null;
    }

    const convoy = convoysHere.find((c) => c.id === selectedRef.id);
    return convoy ? convoyToTradableUnit(convoy) : null;
  }, [selectedRef, shipsHere, convoysHere]);

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
  const dropdownOptions = useMemo<SelectOption<FleetUnitRef | null>[]>(() => [
    { value: null, label: "Browse only" },
    ...convoysHere.map((c) => ({
      value: { kind: "convoy" as const, id: c.id },
      label: `${c.name ?? "Convoy"} (${c.members.length} ships, ${c.combinedCargoMax} cargo)`,
    })),
    ...shipsHere.map((s) => ({
      value: { kind: "ship" as const, id: s.id },
      label: `${s.name} (${s.cargoMax} cargo)`,
    })),
  ], [shipsHere, convoysHere]);

  const hasTraders = shipsHere.length > 0 || convoysHere.length > 0;

  return (
    <>
      {/* Ship / convoy selector */}
      {hasTraders && (
        <div className="mb-6 max-w-sm">
          <SelectInput<FleetUnitRef | null>
            label="Trade with"
            size="md"
            options={dropdownOptions}
            value={selectedRef}
            onChange={(ref) => {
              setSelectedRef(ref);
              setTradeError(null);
            }}
            valueKey={fleetUnitRefKey}
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
