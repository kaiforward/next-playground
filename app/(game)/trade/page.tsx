"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useFleet } from "@/lib/hooks/use-fleet";
import { useMarket } from "@/lib/hooks/use-market";
import { useTradeHistory } from "@/lib/hooks/use-trade-history";
import { useTradeMutation } from "@/lib/hooks/use-trade-mutation";
import { MarketTable } from "@/components/trade/market-table";
import { TradeForm } from "@/components/trade/trade-form";
import { PriceChart } from "@/components/trade/price-chart";
import { SupplyDemandChart } from "@/components/trade/supply-demand-chart";
import type { TradeType } from "@/lib/types/game";
import { getCargoUsed } from "@/lib/utils/cargo";
import { FormError } from "@/components/form/form-error";
import { PageContainer } from "@/components/ui/page-container";

export default function TradePage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const shipId = searchParams.get("shipId");
  const systemId = searchParams.get("systemId");

  const { fleet, loading: fleetLoading } = useFleet();
  const { market, stationId, loading: marketLoading } = useMarket(systemId);
  const { history } = useTradeHistory(systemId);
  const { mutateAsync: tradeAsync } = useTradeMutation({ shipId, stationId, systemId });
  const [selectedGoodId, setSelectedGoodId] = useState<string | undefined>();
  const [tradeError, setTradeError] = useState<string | null>(null);

  // Redirect if missing params
  useEffect(() => {
    if (!shipId || !systemId) {
      router.replace("/dashboard");
    }
  }, [shipId, systemId, router]);

  const ship = fleet?.ships.find((s) => s.id === shipId);

  const selectedGood = selectedGoodId
    ? market.find((e) => e.goodId === selectedGoodId)
    : undefined;

  const cargoUsed = useMemo(
    () => ship ? getCargoUsed(ship.cargo) : 0,
    [ship],
  );

  const currentCargoQuantity = useMemo(
    () => selectedGoodId && ship
      ? ship.cargo.find((c) => c.goodId === selectedGoodId)?.quantity ?? 0
      : 0,
    [ship, selectedGoodId],
  );

  const priceHistory = useMemo(() => {
    if (!selectedGoodId) return [];
    return history
      .filter((h) => h.goodId === selectedGoodId)
      .slice(-10)
      .map((h, i) => ({
        time: `T-${10 - i}`,
        price: h.price,
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

  if (!shipId || !systemId) return null;

  if (fleetLoading || marketLoading || !fleet) {
    return (
      <PageContainer>
        <h1 className="text-2xl font-bold mb-2">Station Market</h1>
        <p className="text-white/60">Loading market data...</p>
      </PageContainer>
    );
  }

  if (!ship) {
    return (
      <PageContainer>
        <h1 className="text-2xl font-bold mb-2">Station Market</h1>
        <p className="text-red-400">Ship not found.</p>
      </PageContainer>
    );
  }

  if (ship.status !== "docked") {
    return (
      <PageContainer>
        <h1 className="text-2xl font-bold mb-2">Station Market</h1>
        <p className="text-amber-400">This ship is currently in transit and cannot trade.</p>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <h1 className="text-2xl font-bold mb-2">Station Market</h1>
      <p className="text-white/60 mb-6">
        Trading at {ship.system.name} with <span className="text-white">{ship.name}</span>
      </p>

      <div className="mb-6">
        <FormError message={tradeError} variant="banner" onDismiss={() => setTradeError(null)} />
      </div>

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
    </PageContainer>
  );
}
