"use client";

import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { NumberInput } from "@/components/form/number-input";
import { SelectInput } from "@/components/form/select-input";
import { useSpawnEventMutation } from "@/lib/hooks/use-dev-tools";
import { useUniverse } from "@/lib/hooks/use-universe";
import { EVENT_DEFINITIONS } from "@/lib/constants/events";

const eventTypes = Object.keys(EVENT_DEFINITIONS);

export function EventSpawnerSection() {
  const { data: universe } = useUniverse();
  const [systemId, setSystemId] = useState("");
  const [eventType, setEventType] = useState(eventTypes[0]);
  const [severity, setSeverity] = useState(1.0);
  const spawnMutation = useSpawnEventMutation();

  const systems = universe?.systems ?? [];

  const systemOptions = useMemo(
    () => systems.map((s) => ({ value: s.id, label: `${s.name} (${s.economyType})` })),
    [systems],
  );

  const eventTypeOptions = useMemo(
    () => eventTypes.map((t) => ({ value: t, label: EVENT_DEFINITIONS[t].name })),
    [],
  );

  return (
    <div className="space-y-3">
      <SelectInput
        label="System"
        options={systemOptions}
        value={systemId}
        onChange={setSystemId}
        placeholder="Select system..."
      />

      <SelectInput
        label="Event Type"
        options={eventTypeOptions}
        value={eventType}
        onChange={setEventType}
        isSearchable={false}
      />

      <NumberInput
        label="Severity"
        value={severity}
        onChange={(e) => setSeverity(Number(e.target.value))}
        min={0.1}
        max={3.0}
        step={0.1}
      />

      <Button
        variant="action"
        color="indigo"
        size="xs"
        fullWidth
        onClick={() => {
          if (systemId) {
            spawnMutation.mutate({ systemId, eventType, severity });
          }
        }}
        disabled={!systemId || spawnMutation.isPending}
      >
        {spawnMutation.isPending ? "Spawning..." : "Spawn Event"}
      </Button>

      {spawnMutation.data && (
        <p className="text-xs text-green-400">
          Spawned {spawnMutation.data.type} ({spawnMutation.data.phase})
        </p>
      )}

      {spawnMutation.error && (
        <p className="text-xs text-red-400">{spawnMutation.error.message}</p>
      )}
    </div>
  );
}
