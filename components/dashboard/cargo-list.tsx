"use client";

import type { CargoItemState } from "@/lib/types/game";
import { Card, CardHeader, CardContent } from "@/components/ui/card";

interface CargoListProps {
  cargo: CargoItemState[];
  cargoMax: number;
}

export function CargoList({ cargo, cargoMax }: CargoListProps) {
  const totalUsed = cargo.reduce((sum, item) => sum + item.quantity, 0);
  const usagePercent = cargoMax > 0 ? (totalUsed / cargoMax) * 100 : 0;

  return (
    <Card variant="bordered" padding="md">
      <CardHeader
        title="Cargo Hold"
        subtitle={`${totalUsed} / ${cargoMax} units`}
      />
      <CardContent className="space-y-4">
        {/* Progress bar */}
        <div>
          <div className="flex justify-between text-xs text-white/50 mb-1">
            <span>Capacity</span>
            <span>{usagePercent.toFixed(0)}%</span>
          </div>
          <div className="h-2 rounded-full bg-white/10 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                usagePercent > 80
                  ? "bg-red-500"
                  : usagePercent > 50
                    ? "bg-amber-500"
                    : "bg-amber-400"
              }`}
              style={{ width: `${Math.min(usagePercent, 100)}%` }}
            />
          </div>
        </div>

        {/* Cargo items */}
        {cargo.length === 0 ? (
          <div className="text-center py-6">
            <p className="text-white/30 text-sm">Cargo hold is empty</p>
            <p className="text-white/20 text-xs mt-1">
              Visit a station market to buy goods
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {cargo.map((item) => (
              <li
                key={item.goodId}
                className="flex items-center justify-between py-2 px-3 rounded-lg bg-white/5"
              >
                <span className="text-sm font-medium text-white">
                  {item.goodName}
                </span>
                <span className="text-sm text-white/60">
                  x{item.quantity}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
