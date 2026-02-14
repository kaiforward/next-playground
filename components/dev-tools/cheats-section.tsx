"use client";

import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { NumberInput } from "@/components/form/number-input";
import { SelectInput } from "@/components/form/select-input";
import {
  useGiveCreditsMutation,
  useTeleportShipMutation,
} from "@/lib/hooks/use-dev-tools";
import { useFleet } from "@/lib/hooks/use-fleet";
import { useUniverse } from "@/lib/hooks/use-universe";

export function CheatsSection() {
  const { fleet } = useFleet();
  const { data: universe } = useUniverse();

  const [creditAmount, setCreditAmount] = useState(10000);
  const [teleportShipId, setTeleportShipId] = useState("");
  const [teleportSystemId, setTeleportSystemId] = useState("");

  const giveCreditsMutation = useGiveCreditsMutation();
  const teleportMutation = useTeleportShipMutation();

  const playerId = fleet?.id ?? "";
  const ships = fleet?.ships ?? [];
  const systems = universe?.systems ?? [];

  const shipOptions = useMemo(
    () => ships.map((s) => ({ value: s.id, label: `${s.name} (${s.system.name})` })),
    [ships],
  );

  const systemOptions = useMemo(
    () => systems.map((s) => ({ value: s.id, label: `${s.name} (${s.economyType})` })),
    [systems],
  );

  return (
    <div className="space-y-4">
      {/* Give credits */}
      <div className="space-y-2">
        <h4 className="text-xs text-white/50 uppercase tracking-wider">Credits</h4>
        <div className="flex gap-2 items-end">
          <div className="flex-1">
            <NumberInput
              value={creditAmount}
              onChange={(e) => setCreditAmount(Number(e.target.value))}
              min={-999999}
              max={999999}
              step={1000}
            />
          </div>
          <Button
            variant="action"
            color="green"
            size="xs"
            onClick={() => {
              if (playerId) {
                giveCreditsMutation.mutate({ playerId, amount: creditAmount });
              }
            }}
            disabled={!playerId || giveCreditsMutation.isPending}
          >
            Give
          </Button>
        </div>
        {giveCreditsMutation.data && (
          <p className="text-xs text-green-400">
            Credits: {giveCreditsMutation.data.credits.toLocaleString()}
          </p>
        )}
      </div>

      {/* Teleport ship */}
      <div className="space-y-2">
        <h4 className="text-xs text-white/50 uppercase tracking-wider">Teleport</h4>

        <SelectInput
          options={shipOptions}
          value={teleportShipId}
          onChange={setTeleportShipId}
          placeholder="Select ship..."
          isSearchable={false}
        />

        <SelectInput
          options={systemOptions}
          value={teleportSystemId}
          onChange={setTeleportSystemId}
          placeholder="Select destination..."
        />

        <Button
          variant="action"
          color="indigo"
          size="xs"
          fullWidth
          onClick={() => {
            if (teleportShipId && teleportSystemId) {
              teleportMutation.mutate({
                shipId: teleportShipId,
                systemId: teleportSystemId,
              });
            }
          }}
          disabled={!teleportShipId || !teleportSystemId || teleportMutation.isPending}
        >
          {teleportMutation.isPending ? "Teleporting..." : "Teleport"}
        </Button>

        {teleportMutation.error && (
          <p className="text-xs text-red-400">{teleportMutation.error.message}</p>
        )}
      </div>
    </div>
  );
}
