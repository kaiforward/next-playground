"use client";

import { useState, useCallback, useEffect } from "react";
import { usePlayer } from "@/lib/hooks/use-player";
import { MarketTable } from "@/components/trade/market-table";
import { TradeForm } from "@/components/trade/trade-form";
import { PriceChart } from "@/components/trade/price-chart";
import { SupplyDemandChart } from "@/components/trade/supply-demand-chart";
import type { MarketEntry } from "@/lib/types/game";
import type { TradeRequest } from "@/lib/types/api";

export default function TradePage() {
  const { player, loading: playerLoading, refresh: refreshPlayer } = usePlayer();
  const [market, setMarket] = useState<MarketEntry[]>([]);
  const [stationId, setStationId] = useState<string | null>(null);
  const [marketLoading, setMarketLoading] = useState(true);
  const [selectedGoodId, setSelectedGoodId] = useState<string | undefined>();
  const [priceHistory, setPriceHistory] = useState<{ time: string; price: number }[]>([]);

  // Fetch market data for the player's current system
  useEffect(() => {
    if (!player) return;
    setMarketLoading(true);
    fetch(`/api/game/market/${player.systemId}`)
      .then((res) => res.json())
      .then((json) => {
        if (json.data) {
          setMarket(json.data.entries);
          setStationId(json.data.stationId);
        }
      })
      .catch(console.error)
      .finally(() => setMarketLoading(false));
  }, [player?.systemId, player]);

  // Fetch price history when a good is selected
  useEffect(() => {
    if (!player || !selectedGoodId) return;
    fetch(`/api/game/history/${player.systemId}`)
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
  }, [player?.systemId, selectedGoodId, player]);

  const selectedGood = selectedGoodId
    ? market.find((e) => e.goodId === selectedGoodId)
    : undefined;

  const cargoUsed = player
    ? player.ship.cargo.reduce((sum, item) => sum + item.quantity, 0)
    : 0;

  const currentCargoQuantity = selectedGoodId && player
    ? player.ship.cargo.find((c) => c.goodId === selectedGoodId)?.quantity ?? 0
    : 0;

  const handleTrade = useCallback(
    async (request: TradeRequest) => {
      const res = await fetch("/api/game/trade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...request, stationId }),
      });
      const json = await res.json();
      if (json.error) {
        alert(json.error);
      } else {
        // Refresh both player state and market data
        refreshPlayer();
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
    [stationId, refreshPlayer]
  );

  if (playerLoading || marketLoading || !player) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-8">
        <h1 className="text-2xl font-bold mb-2">Station Market</h1>
        <p className="text-white/60">Loading market data...</p>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold mb-2">Station Market</h1>
      <p className="text-white/60 mb-6">
        Buy and sell goods at {player.system.name} station.
      </p>

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
              playerCredits={player.credits}
              cargoUsed={cargoUsed}
              cargoMax={player.ship.cargoMax}
              currentCargoQuantity={currentCargoQuantity}
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
