"use client";

import { use, useState, useCallback, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { useFleet } from "@/lib/hooks/use-fleet";
import { useMarket } from "@/lib/hooks/use-market";
import { usePriceHistory } from "@/lib/hooks/use-price-history";
import { useTradeMutation } from "@/lib/hooks/use-trade-mutation";
import { MarketTable } from "@/components/trade/market-table";
import { TradeForm } from "@/components/trade/trade-form";
import { PriceChart } from "@/components/trade/price-chart";
import { SupplyDemandChart } from "@/components/trade/supply-demand-chart";
import { FormError } from "@/components/form/form-error";
import type { TradeType } from "@/lib/types/game";
import { getCargoUsed } from "@/lib/utils/cargo";

export default function SystemMarketPage({
  params,
}: {
  params: Promise<{ systemId: string }>;
}) {
  const { systemId } = use(params);
  const searchParams = useSearchParams();

  const { fleet, loading: fleetLoading } = useFleet();
  const { market, stationId, loading: marketLoading } = useMarket(systemId);
  const { history } = usePriceHistory(systemId);

  // Ship selector — initialized from ?shipId search param
  const initialShipId = searchParams.get("shipId") ?? "";
  const [selectedShipId, setSelectedShipId] = useState(initialShipId);
  const [selectedGoodId, setSelectedGoodId] = useState<string | undefined>();
  const [tradeError, setTradeError] = useState<string | null>(null);

  const { mutateAsync: tradeAsync } = useTradeMutation({
    shipId: selectedShipId || null,
    stationId,
    systemId,
  });

  // Ships docked at this system
  const shipsHere = useMemo(
    () => fleet?.ships.filter((s) => s.status === "docked" && s.systemId === systemId) ?? [],
    [fleet, systemId],
  );

  const selectedShip = shipsHere.find((s) => s.id === selectedShipId) ?? null;

  const selectedGood = selectedGoodId
    ? market.find((e) => e.goodId === selectedGoodId)
    : undefined;

  const cargoUsed = useMemo(
    () => selectedShip ? getCargoUsed(selectedShip.cargo) : 0,
    [selectedShip],
  );

  const cargoByGoodId = useMemo(
    () => new Map(selectedShip?.cargo.map((c) => [c.goodId, c.quantity]) ?? []),
    [selectedShip],
  );

  const currentCargoQuantity = useMemo(
    () => selectedGoodId && selectedShip
      ? selectedShip.cargo.find((c) => c.goodId === selectedGoodId)?.quantity ?? 0
      : 0,
    [selectedShip, selectedGoodId],
  );

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
        await tradeAsync(request);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Trade failed.";
        setTradeError(message);
        throw err;
      }
    },
    [tradeAsync],
  );

  if (fleetLoading || marketLoading) {
    return <p className="text-white/60">Loading market data...</p>;
  }

  return (
    <>
      {/* Ship selector — only shown when ships are docked here */}
      {shipsHere.length > 0 && (
        <div className="mb-6">
          <label className="flex items-center gap-3">
            <span className="text-sm text-white/60">Ship:</span>
            <select
              value={selectedShipId}
              onChange={(e) => {
                setSelectedShipId(e.target.value);
                setTradeError(null);
              }}
              className="rounded-lg bg-white/5 border border-white/10 text-sm text-white px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-400"
            >
              <option value="">Browse only</option>
              {shipsHere.map((ship) => (
                <option key={ship.id} value={ship.id}>
                  {ship.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {/* Trade error banner */}
      <div className="mb-6">
        <FormError message={tradeError} variant="banner" onDismiss={() => setTradeError(null)} />
      </div>

      {/* Market table + Trade form */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className={selectedShip && selectedGood ? "lg:col-span-2" : "lg:col-span-3"}>
          <div className="rounded-xl bg-white/5 backdrop-blur border border-white/10 overflow-hidden">
            <MarketTable
              entries={market}
              onSelectGood={setSelectedGoodId}
              selectedGoodId={selectedGoodId}
              cargoByGoodId={selectedShip ? cargoByGoodId : undefined}
            />
          </div>
        </div>

        {selectedShip && selectedGood && fleet && (
          <TradeForm
            good={selectedGood}
            playerCredits={fleet.credits}
            cargoUsed={cargoUsed}
            cargoMax={selectedShip.cargoMax}
            currentCargoQuantity={currentCargoQuantity}
            shipName={selectedShip.name}
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
