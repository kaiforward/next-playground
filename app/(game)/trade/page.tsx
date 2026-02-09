"use client";

import { useState, useCallback, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useFleet } from "@/lib/hooks/use-fleet";
import { MarketTable } from "@/components/trade/market-table";
import { TradeForm } from "@/components/trade/trade-form";
import { PriceChart } from "@/components/trade/price-chart";
import { SupplyDemandChart } from "@/components/trade/supply-demand-chart";
import type { MarketEntry, TradeType } from "@/lib/types/game";

export default function TradePage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const shipId = searchParams.get("shipId");
  const systemId = searchParams.get("systemId");

  const { fleet, loading: fleetLoading, refresh: refreshFleet } = useFleet();
  const [market, setMarket] = useState<MarketEntry[]>([]);
  const [stationId, setStationId] = useState<string | null>(null);
  const [marketLoading, setMarketLoading] = useState(true);
  const [selectedGoodId, setSelectedGoodId] = useState<string | undefined>();
  const [priceHistory, setPriceHistory] = useState<{ time: string; price: number }[]>([]);
  const [tradeError, setTradeError] = useState<string | null>(null);

  // Redirect if missing params
  useEffect(() => {
    if (!shipId || !systemId) {
      router.replace("/dashboard");
    }
  }, [shipId, systemId, router]);

  const ship = fleet?.ships.find((s) => s.id === shipId);

  // Fetch market data for the system
  useEffect(() => {
    if (!systemId) return;
    setMarketLoading(true);
    fetch(`/api/game/market/${systemId}`)
      .then((res) => res.json())
      .then((json) => {
        if (json.data) {
          setMarket(json.data.entries);
          setStationId(json.data.stationId);
        }
      })
      .catch(console.error)
      .finally(() => setMarketLoading(false));
  }, [systemId]);

  // Fetch price history when a good is selected
  useEffect(() => {
    if (!systemId || !selectedGoodId) return;
    fetch(`/api/game/history/${systemId}`)
      .then((res) => res.json())
      .then((json) => {
        if (json.data) {
          const goodHistory = (json.data as Array<{ goodId: string; price: number; createdAt: string }>)
            .filter((h) => h.goodId === selectedGoodId)
            .slice(-10)
            .map((h, i) => ({
              time: `T-${10 - i}`,
              price: h.price,
            }));
          setPriceHistory(goodHistory);
        }
      })
      .catch(console.error);
  }, [systemId, selectedGoodId]);

  const selectedGood = selectedGoodId
    ? market.find((e) => e.goodId === selectedGoodId)
    : undefined;

  const cargoUsed = ship
    ? ship.cargo.reduce((sum, item) => sum + item.quantity, 0)
    : 0;

  const currentCargoQuantity = selectedGoodId && ship
    ? ship.cargo.find((c) => c.goodId === selectedGoodId)?.quantity ?? 0
    : 0;

  const handleTrade = useCallback(
    async (request: { goodId: string; quantity: number; type: TradeType }) => {
      if (!shipId || !stationId) return;
      setTradeError(null);
      const res = await fetch(`/api/game/ship/${shipId}/trade`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...request, stationId }),
      });
      const json = await res.json();
      if (json.error) {
        setTradeError(json.error);
        throw new Error(json.error);
      } else {
        refreshFleet();
        if (json.data?.updatedMarket) {
          setMarket((prev) =>
            prev.map((e) =>
              e.goodId === json.data.updatedMarket.goodId
                ? json.data.updatedMarket
                : e
            )
          );
        }
      }
    },
    [shipId, stationId, refreshFleet]
  );

  if (!shipId || !systemId) return null;

  if (fleetLoading || marketLoading || !fleet) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-8">
        <h1 className="text-2xl font-bold mb-2">Station Market</h1>
        <p className="text-white/60">Loading market data...</p>
      </div>
    );
  }

  if (!ship) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-8">
        <h1 className="text-2xl font-bold mb-2">Station Market</h1>
        <p className="text-red-400">Ship not found.</p>
      </div>
    );
  }

  if (ship.status !== "docked") {
    return (
      <div className="max-w-7xl mx-auto px-4 py-8">
        <h1 className="text-2xl font-bold mb-2">Station Market</h1>
        <p className="text-amber-400">This ship is currently in transit and cannot trade.</p>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold mb-2">Station Market</h1>
      <p className="text-white/60 mb-6">
        Trading at {ship.system.name} with <span className="text-white">{ship.name}</span>
      </p>

      {tradeError && (
        <div className="mb-6 bg-red-900/40 border border-red-500/30 text-red-200 text-sm px-4 py-3 rounded-lg flex items-center justify-between">
          <span>{tradeError}</span>
          <button onClick={() => setTradeError(null)} className="text-red-400 hover:text-white text-xs font-medium ml-4">Dismiss</button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className={selectedGood ? "lg:col-span-2" : "lg:col-span-3"}>
          <div className="rounded-xl bg-white/5 backdrop-blur border border-white/10 overflow-hidden">
            <MarketTable
              entries={market}
              onSelectGood={setSelectedGoodId}
              selectedGoodId={selectedGoodId}
            />
          </div>
        </div>

        {selectedGood && (
          <div className="space-y-6">
            <TradeForm
              good={selectedGood}
              playerCredits={fleet.credits}
              cargoUsed={cargoUsed}
              cargoMax={ship.cargoMax}
              currentCargoQuantity={currentCargoQuantity}
              shipName={ship.name}
              onTrade={handleTrade}
            />
            {priceHistory.length > 0 && (
              <PriceChart data={priceHistory} goodName={selectedGood.goodName} />
            )}
          </div>
        )}
      </div>

      <div className="mt-8">
        <SupplyDemandChart entries={market} />
      </div>
    </div>
  );
}
