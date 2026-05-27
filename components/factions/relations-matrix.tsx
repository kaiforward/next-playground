"use client";

import Link from "next/link";
import { tv } from "tailwind-variants";
import type { RelationTier } from "@/lib/constants/relations";
import type {
  RelationsMatrixData,
  RelationsMatrixFaction,
  RelationsMatrixPair,
} from "@/lib/services/factions";

const cell = tv({
  base: [
    "h-9 w-9 text-center font-mono text-xs tabular-nums",
    "border border-border",
  ],
  variants: {
    tier: {
      allied: "bg-status-green/30 text-status-green-light",
      friendly: "bg-status-cyan/25 text-status-cyan-light",
      neutral: "bg-status-slate/15 text-text-secondary",
      unfriendly: "bg-status-amber/25 text-status-amber-light",
      hostile: "bg-status-red/30 text-status-red-light",
    },
    interactive: {
      true: "hover:brightness-125",
      false: "",
    },
  },
  defaultVariants: { interactive: true },
});

interface RelationsMatrixProps {
  data: RelationsMatrixData;
}

interface CellLookup {
  score: number;
  tier: RelationTier;
  hasAlliance: boolean;
}

function buildPairMap(pairs: RelationsMatrixPair[]): Map<string, CellLookup> {
  const map = new Map<string, CellLookup>();
  for (const p of pairs) {
    const key = pairKey(p.factionAId, p.factionBId);
    map.set(key, {
      score: p.score,
      tier: p.tier,
      hasAlliance: p.hasAlliance,
    });
  }
  return map;
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export function RelationsMatrix({ data }: RelationsMatrixProps) {
  const lookup = buildPairMap(data.pairs);

  return (
    <div className="overflow-auto">
      <table className="border-collapse">
        <thead>
          <tr>
            <th aria-hidden className="h-9 w-56" />
            {data.factions.map((f) => (
              <ColumnHeader key={f.id} faction={f} />
            ))}
          </tr>
        </thead>
        <tbody>
          {data.factions.map((row) => (
            <tr key={row.id}>
              <RowHeader faction={row} />
              {data.factions.map((col) => {
                if (col.id === row.id) {
                  return (
                    <td
                      key={col.id}
                      className="h-9 w-9 border border-border bg-surface-hover/30"
                      aria-hidden
                    />
                  );
                }
                const entry = lookup.get(pairKey(row.id, col.id));
                if (!entry) {
                  return (
                    <td
                      key={col.id}
                      className="h-9 w-9 border border-border text-center font-mono text-xs text-text-tertiary"
                      title={`${row.name} ↔ ${col.name} — no relation row`}
                    >
                      —
                    </td>
                  );
                }
                return (
                  <td
                    key={col.id}
                    className={cell({ tier: entry.tier })}
                    title={`${row.name} ↔ ${col.name}: ${formatScore(entry.score)}${
                      entry.hasAlliance ? " (allied)" : ""
                    }`}
                  >
                    {Math.round(entry.score)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ColumnHeader({ faction }: { faction: RelationsMatrixFaction }) {
  return (
    <th scope="col" className="h-32 w-9 border border-border bg-surface-hover/30 align-bottom">
      <Link
        href={`/factions/${faction.id}`}
        title={`${faction.name} — ${faction.governmentType}`}
        className="flex flex-col items-center gap-1.5 py-2 hover:text-text-accent transition-colors"
      >
        <span
          className="h-3 w-3 shrink-0 border border-border"
          style={{ backgroundColor: faction.color }}
          aria-hidden
        />
        <span
          className="text-[10px] font-display uppercase tracking-wider text-text-secondary whitespace-nowrap"
          style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
        >
          {faction.name}
        </span>
      </Link>
    </th>
  );
}

function RowHeader({ faction }: { faction: RelationsMatrixFaction }) {
  return (
    <th scope="row" className="h-9 w-56 border border-border bg-surface-hover/30 text-left">
      <Link
        href={`/factions/${faction.id}`}
        className="flex items-center gap-2 px-3 py-1.5 hover:text-text-accent transition-colors"
      >
        <span
          className="h-3 w-3 shrink-0 border border-border"
          style={{ backgroundColor: faction.color }}
          aria-hidden
        />
        <span className="font-display text-xs text-text-primary truncate">
          {faction.name}
        </span>
      </Link>
    </th>
  );
}

function formatScore(score: number): string {
  const rounded = Math.round(score);
  return rounded >= 0 ? `+${rounded}` : `${rounded}`;
}
