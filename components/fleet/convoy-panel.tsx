"use client";

import { useState } from "react";
import type { ShipState, ConvoyState } from "@/lib/types/game";
import {
  useCreateConvoyMutation,
  useDisbandConvoyMutation,
  useConvoyMemberMutations,
} from "@/lib/hooks/use-convoy";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ProgressBar } from "@/components/ui/progress-bar";

interface ConvoyPanelProps {
  convoys: ConvoyState[];
  ships: ShipState[];
  playerCredits: number;
}

export function ConvoyPanel({ convoys, ships, playerCredits }: ConvoyPanelProps) {
  return (
    <div className="space-y-6">
      {convoys.length === 0 && (
        <p className="text-sm text-white/40 text-center py-4">
          No active convoys. Select ships to form a convoy.
        </p>
      )}

      {convoys.map((convoy) => (
        <ConvoyCard key={convoy.id} convoy={convoy} />
      ))}

      <CreateConvoySection ships={ships} />
    </div>
  );
}

function ConvoyCard({ convoy }: { convoy: ConvoyState }) {
  const disbandMutation = useDisbandConvoyMutation();
  const { removeMember } = useConvoyMemberMutations(convoy.id);
  const isDocked = convoy.status === "docked";

  return (
    <Card variant="bordered" padding="md">
      <CardHeader
        title={convoy.name ?? `Convoy`}
        subtitle={
          <span className="inline-flex items-center gap-2">
            <Badge color={isDocked ? "green" : "amber"}>
              {isDocked ? "Docked" : "In Transit"}
            </Badge>
            <span className="text-white/40">{convoy.system.name}</span>
          </span>
        }
      />
      <CardContent className="space-y-3">
        <ProgressBar
          label="Combined Cargo"
          value={convoy.combinedCargoUsed}
          max={convoy.combinedCargoMax}
          color="amber"
        />

        <div className="space-y-1.5">
          <p className="text-xs text-white/40">Members ({convoy.members.length})</p>
          {convoy.members.map((ship) => (
            <div key={ship.id} className="flex items-center justify-between py-1.5 px-3 rounded bg-white/5">
              <span className="text-sm text-white">{ship.name}</span>
              <div className="flex items-center gap-2">
                <Badge color="slate">{ship.role}</Badge>
                {isDocked && (
                  <Button
                    variant="ghost"
                    size="xs"
                    className="text-red-400 hover:text-red-300"
                    disabled={removeMember.isPending}
                    onClick={() => removeMember.mutate(ship.id)}
                  >
                    Remove
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>

        {removeMember.error && (
          <p className="text-sm text-red-400">{removeMember.error.message}</p>
        )}

        {isDocked && (
          <div className="flex gap-2 pt-1">
            <Button
              href={`/map?convoyId=${convoy.id}`}
              variant="action"
              color="indigo"
              size="sm"
              className="flex-1"
            >
              Navigate
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-red-400 hover:text-red-300"
              disabled={disbandMutation.isPending}
              onClick={() => disbandMutation.mutate(convoy.id)}
            >
              {disbandMutation.isPending ? "Disbanding..." : "Disband"}
            </Button>
          </div>
        )}

        {disbandMutation.error && (
          <p className="text-sm text-red-400">{disbandMutation.error.message}</p>
        )}
      </CardContent>
    </Card>
  );
}

function CreateConvoySection({ ships }: { ships: ShipState[] }) {
  const [selectedShips, setSelectedShips] = useState<Set<string>>(new Set());
  const createMutation = useCreateConvoyMutation();

  // Only show docked ships not in a convoy and not disabled
  const availableShips = ships.filter(
    (s) => s.status === "docked" && !s.convoyId && !s.disabled,
  );

  if (availableShips.length < 2) return null;

  const toggleShip = (shipId: string) => {
    setSelectedShips((prev) => {
      const next = new Set(prev);
      if (next.has(shipId)) {
        next.delete(shipId);
      } else {
        next.add(shipId);
      }
      return next;
    });
  };

  // All selected ships must be at the same system
  const selectedArr = availableShips.filter((s) => selectedShips.has(s.id));
  const systemIds = new Set(selectedArr.map((s) => s.systemId));
  const sameSystem = systemIds.size <= 1;
  const canCreate = selectedArr.length >= 2 && sameSystem;

  const handleCreate = async () => {
    await createMutation.mutateAsync({ shipIds: selectedArr.map((s) => s.id) });
    setSelectedShips(new Set());
  };

  return (
    <Card variant="bordered" padding="md">
      <CardHeader title="Form Convoy" subtitle="Select 2+ ships at the same station" />
      <CardContent className="space-y-3">
        <div className="space-y-1.5">
          {availableShips.map((ship) => (
            <label
              key={ship.id}
              className="flex items-center gap-3 py-1.5 px-3 rounded bg-white/5 cursor-pointer hover:bg-white/10 transition-colors"
            >
              <input
                type="checkbox"
                checked={selectedShips.has(ship.id)}
                onChange={() => toggleShip(ship.id)}
                className="accent-blue-500"
              />
              <span className="text-sm text-white flex-1">{ship.name}</span>
              <span className="text-xs text-white/40">{ship.system.name}</span>
            </label>
          ))}
        </div>

        {selectedArr.length >= 2 && !sameSystem && (
          <p className="text-xs text-amber-400">Selected ships must be at the same station.</p>
        )}

        {createMutation.error && (
          <p className="text-sm text-red-400">{createMutation.error.message}</p>
        )}

        <Button
          variant="action"
          color="blue"
          size="sm"
          fullWidth
          disabled={!canCreate || createMutation.isPending}
          onClick={handleCreate}
        >
          {createMutation.isPending ? "Forming..." : `Form Convoy (${selectedArr.length} ships)`}
        </Button>
      </CardContent>
    </Card>
  );
}
