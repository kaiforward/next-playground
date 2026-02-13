"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useFleet } from "@/lib/hooks/use-fleet";
import { useMarket } from "@/lib/hooks/use-market";
import { usePriceHistory } from "@/lib/hooks/use-price-history";
import { useTradeMutation } from "@/lib/hooks/use-trade-mutation";
import { MarketTable } from "@/components/trade/market-table";
import { TradeForm } from "@/components/trade/trade-form";
import { PriceChart } from "@/components/trade/price-chart";
import { SupplyDemandChart } from "@/components/trade/supply-demand-chart";
import type { TradeType } from "@/lib/types/game";
import { getCargoUsed } from "@/lib/utils/cargo";
import { FormError } from "@/components/form/form-error";
import { PageContainer } from "@/components/ui/page-container";
import { Button } from "@/components/ui/button";
import Link from "next/link";

export default function TradePage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const shipId = searchParams.get("shipId");
  const systemId = searchParams.get("systemId");

  const { fleet, loading: fleetLoading } = useFleet();
  const { market, stationId, loading: marketLoading } = useMarket(systemId);
  const { history } = usePriceHistory(systemId);
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

  const cargoByGoodId = useMemo(
    () => new Map(ship?.cargo.map((c) => [c.goodId, c.quantity]) ?? []),
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
      <p className="text-white/60 mb-1">
        Trading at{" "}
        <Link href={`/system/${systemId}`} className="text-white/80 hover:text-white underline underline-offset-2 transition-colors">
          {ship.system.name}
        </Link>{" "}
        with{" "}
        <Link href={`/ship/${shipId}`} className="text-white hover:text-blue-300 underline underline-offset-2 transition-colors">
          {ship.name}
        </Link>
      </p>
      <div className="mb-6">
        <Button href={`/map?systemId=${systemId}`} variant="pill" color="cyan" size="xs">
          View on Map
        </Button>
      </div>

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
              cargoByGoodId={cargoByGoodId}
            />
          </div>
        </div>

        {selectedGood && (
          <TradeForm
            good={selectedGood}
            playerCredits={fleet.credits}
            cargoUsed={cargoUsed}
            cargoMax={ship.cargoMax}
            currentCargoQuantity={currentCargoQuantity}
            shipName={ship.name}
            onTrade={handleTrade}
          />
        )}
      </div>

      {selectedGood && priceHistory.length > 0 && (
        <div className="mt-8">
          <PriceChart data={priceHistory} goodName={selectedGood.goodName} cargoQuantity={currentCargoQuantity} />
        </div>
      )}

      <div className="mt-8">
        <SupplyDemandChart entries={market} />
      </div>
    </PageContainer>
  );
}
