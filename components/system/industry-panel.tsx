"use client";

import { Fragment } from "react";
import { useSystemIndustry } from "@/lib/hooks/use-system-industry";
import { useSystemInfo } from "@/lib/hooks/use-system-info";
import { useSystemConstruction } from "@/lib/hooks/use-system-construction";
import { useSystemBuildOptions } from "@/lib/hooks/use-build-options";
import { useCancelOrder } from "@/lib/hooks/use-construction-orders";
import { GOODS } from "@/lib/constants/goods";
import {
  BUILDING_TYPES,
  HOUSING_TYPE,
  ACADEMY_TYPES,
  VOCATIONAL_SCHOOL_TYPE,
  RESEARCH_INSTITUTE_TYPE,
  CONSTRUCTION_CENTRE_TYPE,
  COMPLEX_TYPES,
  COMPLEX_BY_TYPE,
  SUPPORT_TYPES,
} from "@/lib/constants/industry";
import { GOOD_RECIPES } from "@/lib/constants/recipes";
import { INFRASTRUCTURE_DECAY_PARAMS } from "@/lib/constants/infrastructure";
import { QUALITY_BAND_TEXT, QUALITY_BAND_LABEL, GRADE } from "@/lib/constants/ui";
import { describeBuilding, TIER_LABELS } from "@/lib/constants/building-descriptions";
import { buildingHealth, familyAnchorBuff, industryHealth, perGradeStaffing, skillLicensing } from "@/lib/engine/industry";
import type { IndustryHealth, SystemIndustryReadout, SystemLabour, LabourPool, LabourAllocation, SkillBasketEntry } from "@/lib/engine/industry";
import type { GoodTier } from "@/lib/types/game";
import type { BuildOptionData } from "@/lib/types/api";
import { formatMagnitude, formatPeople, formatUnitsShort } from "@/lib/utils/format";
import { formatEta } from "@/lib/utils/construction-format";
import { Card } from "@/components/ui/card";
import { Badge, type BadgeColor } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { InfoIcon } from "@/components/ui/icons";
import { Tooltip, TooltipTrigger, TooltipTriggerLabel, TooltipContent } from "@/components/ui/tooltip";
import { useDialog } from "@/components/ui/dialog";
import { depositRows, generalLand, type DepositRow, type GeneralLand } from "@/components/system/industry-rows";
import { classifyGhosts, type GhostGroup, type GhostRow } from "@/components/system/industry-ghosts";
import { QuickAddButton } from "@/components/construction/quick-add-button";
import { BuildDialog } from "@/components/construction/build-dialog";

const THRESHOLD = INFRASTRUCTURE_DECAY_PARAMS.unrestThreshold;

/**
 * Health → label / badge colour / text colour / glyph, in one place so the badge, tally, row
 * indicators and legend agree. Grounded in the decay engine (see industryHealth): a shape-first
 * glyph keeps it colourblind-safe. Stable holds, contracting slowly sheds idle levels, collapsing
 * is unrest teardown.
 */
const HEALTH: Record<IndustryHealth, { label: string; badge: BadgeColor; text: string; glyph: string }> = {
  stable:      { label: "Stable",      badge: "green", text: "text-status-green-light", glyph: "●" },
  contracting: { label: "Contracting", badge: "amber", text: "text-status-amber-light", glyph: "▽" },
  collapsing:  { label: "Collapsing",  badge: "red",   text: "text-status-red-light",   glyph: "▼" },
};

// Faint light hatch = idle labour capacity; red hatch = skill jobs no academy can license; copper
// hatch = free habitable land (housing can still grow here).
const IDLE_HATCH = "repeating-linear-gradient(135deg, transparent 0 4px, rgba(201,209,217,0.06) 4px 8px)";
const GAP_HATCH = "repeating-linear-gradient(135deg, rgba(240,97,109,0.45) 0 4px, transparent 4px 8px)";
const COPPER_HATCH = "repeating-linear-gradient(135deg, rgba(208,106,66,0.45) 0 2px, transparent 2px 6px)";

/**
 * The at-a-glance health signal: a shape coloured by health, carrying the health word as its
 * accessible name unless `decorative` (set where the word is already adjacent, so screen readers
 * don't say it twice).
 */
function HealthGlyph({ health, className = "", decorative = false }: { health: IndustryHealth; className?: string; decorative?: boolean }) {
  return (
    <span
      aria-label={decorative ? undefined : HEALTH[health].label}
      aria-hidden={decorative || undefined}
      title={HEALTH[health].label}
      className={`font-mono leading-none ${HEALTH[health].text} ${className}`}
    >
      {HEALTH[health].glyph}
    </span>
  );
}

type BuildingEntry = SystemIndustryReadout["buildings"][number];

/** Narrow a readout building's tier (GoodTier | -1, housing = -1) to a GoodTier for the producer-only staffing helpers. */
function producerTier(b: BuildingEntry): GoodTier {
  return b.tier === 1 ? 1 : b.tier === 2 ? 2 : 0;
}

/** Non-good building types aren't in GOODS — name them explicitly. */
const NON_GOOD_LABELS: Record<string, string> = {
  [VOCATIONAL_SCHOOL_TYPE]: "Vocational School",
  [RESEARCH_INSTITUTE_TYPE]: "Research Institute",
  [CONSTRUCTION_CENTRE_TYPE]: "Construction Centre",
};

/** Complex building types aren't in GOODS either — name them from the family catalog. */
const COMPLEX_LABELS: Record<string, string> = Object.fromEntries(
  COMPLEX_TYPES.map((t) => [t, COMPLEX_BY_TYPE[t].label]),
);

/** Human-readable label for a building type or good id. */
function label(id: string): string {
  if (id === HOUSING_TYPE) return "Housing";
  return NON_GOOD_LABELS[id] ?? COMPLEX_LABELS[id] ?? GOODS[id]?.name ?? id;
}

// ── Small shared pieces ──────────────────────────────────────────────────────

/** Pool header: title · sub · right-aligned metric. */
function PoolHead({ title, sub, right }: { title: string; sub?: string; right: React.ReactNode }) {
  return (
    <div className="mb-2 flex items-baseline gap-2">
      <span className="font-display text-[11px] font-semibold uppercase tracking-wider text-text-primary">{title}</span>
      {sub && <span className="font-mono text-[10px] text-text-tertiary">{sub}</span>}
      <span className="ml-auto whitespace-nowrap font-mono text-[11px] text-text-secondary">{right}</span>
    </div>
  );
}

/** Gold-when-rich yield tag — reused by deposit name + tooltip. */
function YieldTag({ mult, band }: { mult: number; band: DepositRow["band"] }) {
  return <span className={`font-mono text-[9.5px] ${QUALITY_BAND_TEXT[band]}`}>×{mult.toFixed(2)}</span>;
}

/**
 * `fill/capacity`, coloured by health when not stable. The fill keeps one decimal (the fractional
 * working level is the signal); the capacity reads as a whole count of slots / built levels.
 */
function Worked({ worked, total, health }: { worked: number; total: number; health: IndustryHealth }) {
  return (
    <>
      <span className={health === "stable" ? "text-text-primary" : HEALTH[health].text}>{worked.toFixed(1)}</span>/{Math.round(total)}
    </>
  );
}

/** Foundry table head cell — tight, uppercase, right-alignable. */
function Th({ children, right = false }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th className={`border-b border-border-strong px-1.5 py-1 font-display text-[10px] font-semibold uppercase tracking-wider text-text-tertiary ${right ? "text-right" : "text-left"}`}>
      {children}
    </th>
  );
}

// ── Tooltips ─────────────────────────────────────────────────────────────────

/** Deposit tooltip: resource · yield band · built/slots · worked · the goods extracted from it. */
function DepositTooltipBody({ row, contributors }: { row: DepositRow; contributors: BuildingEntry[] }) {
  return (
    <div className="space-y-1">
      <p className="font-display text-[12px] font-semibold capitalize text-text-primary">{row.resource}</p>
      <p className="font-mono text-[10px] text-text-tertiary">
        yield ×{row.yieldMult.toFixed(2)} · {QUALITY_BAND_LABEL[row.band]} · {row.built}/{row.slotCap} slots built · {row.worked.toFixed(1)} worked
      </p>
      {contributors.length > 0 && (
        <div className="space-y-0.5 border-t border-border/60 pt-1.5">
          <p className="font-mono text-[9px] uppercase tracking-wider text-text-tertiary/80">extracted goods</p>
          {contributors.map((b) => (
            <div key={b.buildingType} className="flex items-center justify-between gap-3 text-[11px]">
              <span className="text-text-primary">{label(b.buildingType)}</span>
              <span className="font-mono text-text-secondary">{b.output !== undefined ? formatUnitsShort(b.output) : "0"}/cyc</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Rich per-building tooltip: header · description · per-grade filled/needed · footer. Producers get the grade split. */
function BuildingTooltipBody({ b, labour }: { b: BuildingEntry; labour: SystemLabour }) {
  const isAcademy = ACADEMY_TYPES.includes(b.buildingType);
  const isComplex = COMPLEX_TYPES.includes(b.buildingType);
  const isSupport = SUPPORT_TYPES.includes(b.buildingType);
  const isProducer = b.outputGood !== undefined && !isAcademy && b.tier >= 0;
  const goodTier = producerTier(b);
  const grades = isProducer
    ? perGradeStaffing(BUILDING_TYPES[b.buildingType]?.labour ?? { unskilled: 0, skill1: 0, skill2: 0 }, b.count, goodTier, {
        labourFulfil: labour.workforce.fulfil,
        skill1Fulfil: labour.skill1.fulfil,
        skill2Fulfil: labour.skill2.fulfil,
      })
    : [];
  const wall = grades.find((g) => g.wall);
  const tierLabel = b.tier >= 0 ? TIER_LABELS[goodTier] : undefined;
  const complexFamily = isComplex ? COMPLEX_BY_TYPE[b.buildingType] : undefined;
  const familyBuff = complexFamily ? familyAnchorBuff({ [b.buildingType]: b.count }, complexFamily.goods[0] ?? "") : 1;

  return (
    <div className="space-y-1.5">
      <p className="font-display text-[12px] font-semibold text-text-primary">{label(b.buildingType)}</p>
      {(tierLabel || b.count > 0) && (
        <p className="font-mono text-[10px] text-text-tertiary">
          {tierLabel && !isAcademy && !isComplex && !isSupport ? `tier ${b.tier} · ${tierLabel} · ` : ""}×{formatMagnitude(b.count)} built
        </p>
      )}
      <p className="text-[11px] leading-snug text-text-secondary">{describeBuilding(b.buildingType)}</p>

      {complexFamily && (
        <div className="space-y-0.5 border-t border-border/60 pt-1.5">
          <p className="font-mono text-[9px] uppercase tracking-wider text-text-tertiary/80">
            family yield — <span className="text-text-secondary">×{Number(familyBuff.toFixed(2))}</span>
            {b.count < 1 ? ` of ×${complexFamily.buffMult} at full strength` : ""}
          </p>
          <p className="text-[11px] leading-snug text-text-secondary">
            {complexFamily.goods.map((g) => GOODS[g]?.name ?? g).join(" · ")}
          </p>
        </div>
      )}

      {isProducer && grades.length > 0 && (
        <div className="space-y-0.5 border-t border-border/60 pt-1.5">
          <p className="font-mono text-[9px] uppercase tracking-wider text-text-tertiary/80">staffing — filled / needed</p>
          {grades.map((g) => (
            <div key={g.grade} className="flex items-center gap-1.5">
              <span aria-hidden className={`w-3 font-mono text-[9px] ${GRADE[g.grade].text}`}>{GRADE[g.grade].tag}</span>
              <div className="relative h-1.5 flex-1 overflow-hidden border border-border bg-surface-active">
                <div className={`absolute inset-y-0 left-0 ${GRADE[g.grade].bar}`} style={{ width: `${Math.max(0, Math.min(100, g.fulfil * 100))}%` }} />
              </div>
              <span className={`w-[70px] text-right font-mono text-[10px] ${g.wall ? "text-status-red-light" : "text-text-secondary"}`}>
                {formatMagnitude(g.filled)}/{formatMagnitude(g.needed)}{g.wall ? " ◄" : ""}
              </span>
            </div>
          ))}
        </div>
      )}

      {isProducer && (
        <p className="border-t border-border/60 pt-1.5 text-[11px] leading-snug text-text-tertiary">
          Output <span className="font-mono text-text-secondary">{b.output !== undefined ? formatUnitsShort(b.output) : "0"}</span>/cyc — staffing{" "}
          <span className="font-mono text-text-secondary">{Math.round(b.staffedFraction * 100)}%</span>
          {wall && wall.fulfil < 1 ? (
            <>
              , {GRADE[wall.grade].tag === "U" ? "unskilled workers" : GRADE[wall.grade].tag === "T" ? "technicians" : "engineers"} are the wall.
              {wall.grade === "skill1" ? " Build a vocational school to license technician-grade work." : ""}
              {wall.grade === "skill2" ? " Build a research institute to license engineer-grade work." : ""}
            </>
          ) : "."}
        </p>
      )}
    </div>
  );
}

// ── Ghost rows (in-flight builds surfaced inline in the ledger) ──────────────

/** Ledger group titles the buildings table renders headings for — the deposit table owns "deposit". */
type BuildingGroupTitle = Exclude<GhostGroup, "deposit">;

/** Ghost row's name cell: ◇ marker · label · +levels · ORDERED badge · cancel (player rows, when cancellable). */
function GhostNameCell({ ghost, canCancel, onCancel }: { ghost: GhostRow; canCancel: boolean; onCancel: (projectId: string) => void }) {
  return (
    <td className="px-1.5 py-1 text-[12px] text-text-tertiary">
      <span className="flex items-center gap-1.5">
        <span aria-hidden className="font-mono text-[9px] text-status-amber-light">◇</span>
        {ghost.label} <span className="font-mono">+{ghost.levels}</span>
        {ghost.origin === "player" && <Badge color="amber">ORDERED</Badge>}
        {ghost.origin === "player" && canCancel && (
          <button
            type="button"
            aria-label={`Cancel ${ghost.label} order`}
            onClick={() => onCancel(ghost.projectId)}
            className="px-1 text-[11px] text-status-red-light transition-colors hover:text-status-red"
          >
            ✕
          </button>
        )}
      </span>
      <span className="mt-0.5 block h-1 max-w-[180px] bg-surface-active">
        <span aria-hidden className="block h-full bg-status-amber/75" style={{ width: `${Math.round(ghost.progress * 100)}%` }} />
      </span>
    </td>
  );
}

/** In-flight extractor in the deposit ledger: name cell, then progress% / — / ETA under Worked / Yield / Out-cyc. */
function DepositGhostRow({
  ghost, canCancel, onCancel, showActionColumn,
}: { ghost: GhostRow; canCancel: boolean; onCancel: (projectId: string) => void; showActionColumn: boolean }) {
  return (
    <tr className="border-b border-border/40 last:border-b-0">
      <GhostNameCell ghost={ghost} canCancel={canCancel} onCancel={onCancel} />
      <td className="px-1.5 py-1 text-right font-mono text-[11px] text-status-amber-light">{Math.round(ghost.progress * 100)}%</td>
      <td />
      <td className="px-1.5 py-1 text-right font-mono text-[11px] text-text-tertiary">{formatEta(ghost.etaPulses)}</td>
      {showActionColumn && <td />}
    </tr>
  );
}

/** In-flight building in the general-land ledger: name cell, then progress% / ETA under Worked / Out-cyc. */
function BuildingGhostRow({
  ghost, canCancel, onCancel, showActionColumn,
}: { ghost: GhostRow; canCancel: boolean; onCancel: (projectId: string) => void; showActionColumn: boolean }) {
  return (
    <tr className="border-b border-border/40 last:border-b-0">
      <GhostNameCell ghost={ghost} canCancel={canCancel} onCancel={onCancel} />
      <td className="px-1.5 py-1 text-right font-mono text-[11px] text-status-amber-light">{Math.round(ghost.progress * 100)}%</td>
      <td className="px-1.5 py-1 text-right font-mono text-[11px] text-text-tertiary">{formatEta(ghost.etaPulses)}</td>
      {showActionColumn && <td />}
    </tr>
  );
}

// ── Tables ───────────────────────────────────────────────────────────────────

/**
 * Deposit table: per-resource slot fill — health glyph · resource · worked/slots · yield · output. On the
 * player's own systems, a trailing quick-add column offers +1 level on the resource's sole extractor type
 * (ambiguous resources — more than one catalog extractor — defer to the New-industry dialog), and in-flight
 * extractor orders render as ghost rows under their matching deposit.
 */
function DepositTable({
  rows, contributorsFor, systemId, canOrder, optionByType, ghosts, onCancel,
}: {
  rows: DepositRow[];
  contributorsFor: (r: DepositRow["resource"]) => BuildingEntry[];
  systemId: string;
  canOrder: boolean;
  optionByType: Map<string, BuildOptionData>;
  ghosts: GhostRow[];
  onCancel: (projectId: string) => void;
}) {
  return (
    <table className="w-full border-collapse">
      <thead>
        <tr>
          <Th>Deposit</Th><Th right>Worked</Th><Th right>Yield</Th><Th right>Out/cyc</Th>
          {canOrder && <Th right> </Th>}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const extractorTypes = Object.keys(BUILDING_TYPES).filter((t) => BUILDING_TYPES[t].resource === row.resource);
          const quickAddOption = canOrder && extractorTypes.length === 1 ? optionByType.get(extractorTypes[0]) : undefined;
          return (
            <Fragment key={row.resource}>
              <tr className="border-b border-border/40 last:border-b-0">
                <td className="px-1.5 py-1 text-[12px] text-text-primary">
                  <span className="flex items-center gap-1.5">
                    <HealthGlyph health={row.health} className="text-[9px]" />
                    <Tooltip>
                      <TooltipTriggerLabel className="capitalize">{row.resource}</TooltipTriggerLabel>
                      <TooltipContent className="w-56"><DepositTooltipBody row={row} contributors={contributorsFor(row.resource)} /></TooltipContent>
                    </Tooltip>
                  </span>
                </td>
                <td className="px-1.5 py-1 text-right font-mono text-[12px] text-text-secondary"><Worked worked={row.worked} total={row.slotCap} health={row.health} /></td>
                <td className="px-1.5 py-1 text-right"><YieldTag mult={row.yieldMult} band={row.band} /></td>
                <td className="px-1.5 py-1 text-right font-mono text-[12px] text-text-primary">{row.output > 0 ? formatUnitsShort(row.output) : "—"}</td>
                {canOrder && (
                  <td className="px-1.5 py-1 text-right">
                    {quickAddOption && <QuickAddButton systemId={systemId} option={quickAddOption} />}
                  </td>
                )}
              </tr>
              {ghosts.filter((g) => g.resource === row.resource).map((g) => (
                <DepositGhostRow key={g.projectId} ghost={g} canCancel={canOrder} onCancel={onCancel} showActionColumn={canOrder} />
              ))}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}

/** Supply-chain "needs" line: each recipe input, green ✓ or red ⚠ with the throttle %. */
function NeedsLine({ supply }: { supply: SystemIndustryReadout["supplyChain"][number] }) {
  const inputs = Object.keys(GOOD_RECIPES[supply.goodId] ?? {});
  if (inputs.length === 0) return null;
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 pl-4 text-[11px]">
      <span className="font-mono uppercase tracking-wide text-text-tertiary/80">needs</span>
      {inputs.map((input) => {
        const short = supply.throttledBy.includes(input);
        return (
          <span key={input} className={`font-mono ${short ? "text-status-red-light" : "text-status-green-light"}`}>
            {short ? "⚠" : "✓"} {label(input)}{short ? ` ${Math.round(supply.inputGate * 100)}%` : ""}
          </span>
        );
      })}
    </span>
  );
}

/** One general-land building row — health glyph · name (tooltip) · worked/built · output, with a needs sub-row.
 *  On the player's own systems, a trailing quick-add column offers +1 level when a feasibility option exists. */
function BuildingRow({
  b,
  labour,
  unrest,
  supply,
  systemId,
  canOrder,
  option,
}: {
  b: BuildingEntry;
  labour: SystemLabour;
  unrest: number;
  supply?: SystemIndustryReadout["supplyChain"][number];
  systemId: string;
  canOrder: boolean;
  option?: BuildOptionData;
}) {
  const health = buildingHealth({ used: b.used, built: b.count, unrest, unrestDecayThreshold: THRESHOLD });
  const hasNeeds = supply && Object.keys(GOOD_RECIPES[supply.goodId] ?? {}).length > 0;
  return (
    <tr className={hasNeeds ? "" : "border-b border-border/40"}>
      <td className={`px-1.5 pt-1 text-[12px] text-text-primary ${hasNeeds ? "pb-0.5" : "pb-1"}`}>
        <span className="flex items-center gap-1.5">
          <HealthGlyph health={health} className="text-[9px]" />
          <Tooltip>
            <TooltipTriggerLabel>{label(b.buildingType)}</TooltipTriggerLabel>
            <TooltipContent className="w-64"><BuildingTooltipBody b={b} labour={labour} /></TooltipContent>
          </Tooltip>
        </span>
        {hasNeeds && supply && <NeedsLine supply={supply} />}
      </td>
      <td className="px-1.5 py-1 align-top text-right font-mono text-[12px] text-text-secondary"><Worked worked={b.used} total={b.count} health={health} /></td>
      <td className="px-1.5 py-1 align-top text-right font-mono text-[12px] text-text-primary">{b.output !== undefined ? formatUnitsShort(b.output) : "—"}</td>
      {canOrder && (
        <td className="px-1.5 py-1 align-top text-right">
          {option && <QuickAddButton systemId={systemId} option={option} />}
        </td>
      )}
    </tr>
  );
}

/**
 * General-land buildings, grouped under Housing / Production / Specialisation / Support subheadings. A group
 * with no built rows but in-flight ghosts still renders its heading — that's the only content telling the
 * player something is coming. Player systems get a trailing quick-add column.
 */
function BuildingsTable({
  groups,
  labour,
  unrest,
  supplyByGood,
  systemId,
  canOrder,
  optionByType,
  ghostsByGroup,
  onCancel,
}: {
  groups: Array<{ title: BuildingGroupTitle; buildings: BuildingEntry[] }>;
  labour: SystemLabour;
  unrest: number;
  supplyByGood: Map<string, SystemIndustryReadout["supplyChain"][number]>;
  systemId: string;
  canOrder: boolean;
  optionByType: Map<string, BuildOptionData>;
  ghostsByGroup: Map<GhostGroup, GhostRow[]>;
  onCancel: (projectId: string) => void;
}) {
  const active = groups.filter((g) => g.buildings.length > 0 || (ghostsByGroup.get(g.title)?.length ?? 0) > 0);
  if (active.length === 0) return null;
  const columns = canOrder ? 4 : 3;
  return (
    <table className="mt-3 w-full border-collapse">
      <thead>
        <tr>
          <Th>Building</Th><Th right>Worked</Th><Th right>Out/cyc</Th>
          {canOrder && <Th right> </Th>}
        </tr>
      </thead>
      <tbody>
        {active.map((group) => (
          <Fragment key={group.title}>
            <tr>
              <td colSpan={columns} className="px-1.5 pb-0.5 pt-2.5 font-display text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">
                {group.title}
              </td>
            </tr>
            {group.buildings.map((b) => (
              <BuildingRow
                key={b.buildingType}
                b={b}
                labour={labour}
                unrest={unrest}
                supply={b.outputGood ? supplyByGood.get(b.outputGood) : undefined}
                systemId={systemId}
                canOrder={canOrder}
                option={optionByType.get(b.buildingType)}
              />
            ))}
            {(ghostsByGroup.get(group.title) ?? []).map((g) => (
              <BuildingGhostRow key={g.projectId} ghost={g} canCancel={canOrder} onCancel={onCancel} showActionColumn={canOrder} />
            ))}
          </Fragment>
        ))}
      </tbody>
    </table>
  );
}

/** General-land magnitude bar: housing / factory / habitable-free (hatched) / factory-only free. */
function MagBar({ land }: { land: GeneralLand }) {
  const total = land.general > 0 ? land.general : 1;
  const w = (v: number) => `${(v / total) * 100}%`;
  return (
    <div className="flex h-3.5 overflow-hidden border border-border bg-surface-active">
      <div className="border-r-2 border-surface bg-accent" style={{ width: w(land.housing) }} />
      <div className="border-r-2 border-surface bg-accent-muted" style={{ width: w(land.factory) }} />
      <div className="border-r-2 border-surface" style={{ width: w(land.habitableFree), backgroundImage: COPPER_HATCH }} />
      <div style={{ width: w(land.factoryFree) }} />
    </div>
  );
}

// ── Labour card (preserved) ──────────────────────────────────────────────────

function LegendTooltip() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" aria-label="Legend" className="text-text-tertiary transition-colors hover:text-text-secondary">
          <InfoIcon className="h-3.5 w-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent className="w-64 space-y-2">
        <div>
          <p className="mb-1 font-display text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">Health — mirrors what decays</p>
          <ul className="space-y-0.5 text-[11px] text-text-secondary">
            <li><HealthGlyph health="stable" className="mr-1 text-[9px]" decorative /> stable — understaffed by under a whole unit; nothing sheds</li>
            <li><HealthGlyph health="contracting" className="mr-1 text-[9px]" decorative /> contracting — a whole level sits idle; the marginal level sheds after a buffer</li>
            <li><HealthGlyph health="collapsing" className="mr-1 text-[9px]" decorative /> collapsing — unrest teardown; levels tear down immediately</li>
          </ul>
        </div>
        <div>
          <p className="mb-1 font-display text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">Columns</p>
          <p className="text-[11px] text-text-secondary"><span className="font-mono">worked/slots</span> is units in use of the deposit&apos;s slots (staffed &amp; selling); <span className="font-mono">out/cyc</span> is real output after input gates.</p>
        </div>
        <div>
          <p className="mb-1 font-display text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">Labour grades</p>
          <p className="text-[11px] text-text-secondary">
            <span aria-hidden className="mr-1 inline-block h-2 w-2 bg-status-blue align-middle" />U unskilled &nbsp;
            <span aria-hidden className="mr-1 inline-block h-2 w-2 bg-status-cyan align-middle" />T technician &nbsp;
            <span aria-hidden className="mr-1 inline-block h-2 w-2 bg-status-purple align-middle" />E engineer
          </p>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * One skilled grade's licensing row: tag · name · a bar whose full width is max(licensed, jobs) —
 * the filled part is working, the tail is faint idle seats or a red unlicensed-jobs gap.
 */
function LicensingRow({ grade, pool, buildHint }: { grade: "skill1" | "skill2"; pool: LabourPool; buildHint: string }) {
  const l = skillLicensing(pool.have, pool.need);
  const meta = GRADE[grade];
  const bottleneck = l.unlicensedJobs > 0;
  const workingPct = l.full > 0 ? (l.working / l.full) * 100 : 0;
  const tailPct = l.full > 0 ? (Math.max(l.idleSeats, l.unlicensedJobs) / l.full) * 100 : 0;
  return (
    <div className="py-1">
      <div className="flex items-center gap-2.5">
        <span aria-hidden className={`inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center border border-border font-mono text-[9px] ${meta.text}`}>{meta.tag}</span>
        <span className="w-[88px] shrink-0 text-sm text-text-primary">{meta.name}</span>
        <div
          role="img"
          aria-label={`${meta.name}: ${formatPeople(l.working)} working of ${bottleneck ? `${formatPeople(l.jobs)} jobs, ${formatPeople(l.licensed)} licensed` : `${formatPeople(l.licensed)} licensed`}`}
          className="flex h-3.5 flex-1 overflow-hidden border border-border bg-surface-active"
        >
          <div className={meta.bar} style={{ width: `${workingPct}%` }} />
          <div className="border-l border-background" style={{ width: `${tailPct}%`, backgroundImage: bottleneck ? GAP_HATCH : IDLE_HATCH }} />
        </div>
        <span className="w-32 shrink-0 whitespace-nowrap text-right font-mono text-[11px] text-text-secondary">
          <span className="text-text-primary">{formatPeople(l.working)}</span>
          {bottleneck ? <> / {formatPeople(l.jobs)} jobs</> : <> / {formatPeople(l.licensed)} lic.</>}
        </span>
      </div>
      {(bottleneck || l.idleSeats > 0) && (
        <p className={`mt-0.5 ml-[26px] text-[11px] ${bottleneck ? "text-status-red-light" : "text-text-tertiary"}`}>
          {bottleneck
            ? `${formatPeople(l.unlicensedJobs)} jobs unlicensed — ${buildHint}`
            : `${formatPeople(l.idleSeats)} idle licence seats`}
        </p>
      )}
    </div>
  );
}

/** Skilled-grade basket tooltip body: lead-in line + per-good per-head rate, richest first. */
function BasketTooltipBody({ grade, basket }: { grade: "skill1" | "skill2"; basket: SkillBasketEntry[] }) {
  const noun = grade === "skill1" ? "technician" : "engineer";
  return (
    <div className="space-y-1">
      <p className="text-[11px] leading-snug text-text-secondary">Each {noun} adds demand for:</p>
      <div className="space-y-0.5">
        {basket.map((entry) => (
          <div key={entry.goodId} className="flex items-center justify-between gap-3">
            <span className="text-[11px] text-text-primary">{label(entry.goodId)}</span>
            {/* Fixed decimals — per-head rates sit below formatMagnitude's 0.1 cutoff at ECONOMY_SCALE=1. */}
            <span className="font-mono text-[10px] text-text-secondary">{entry.perHead.toFixed(3)}/cyc</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * System-wide labour: population decomposed into disjoint role buckets (unskilled / technicians /
 * engineers) + unemployed, one bar summing to the population — then per-skill academy licensing.
 */
function LabourCard({
  labour,
  allocation,
  skillBaskets,
}: {
  labour: SystemLabour;
  allocation: LabourAllocation;
  skillBaskets: SystemIndustryReadout["skillBaskets"];
}) {
  const pop = Math.max(0, allocation.population);
  const jobs = allocation.unskilled + allocation.technicians + allocation.engineers;
  const pct = (v: number) => (pop > 0 ? (v / pop) * 100 : 0);
  const working = [
    { key: "unskilled", label: "Unskilled", bar: GRADE.unskilled.bar, value: allocation.unskilled, basket: undefined },
    { key: "skill1", label: "Technicians", bar: GRADE.skill1.bar, value: allocation.technicians, basket: skillBaskets.technicians },
    { key: "skill2", label: "Engineers", bar: GRADE.skill2.bar, value: allocation.engineers, basket: skillBaskets.engineers },
  ] as const;
  const hasSkill = labour.skill1.have > 0 || labour.skill1.need > 0 || labour.skill2.have > 0 || labour.skill2.need > 0;

  return (
    <Card variant="bordered" padding="sm">
      <div className="mb-2 flex items-baseline gap-2">
        <p className="font-display text-[11px] font-semibold uppercase tracking-wider text-text-primary">Labour</p>
        <span className="ml-auto font-mono text-[10px] text-text-tertiary">
          <span className="text-text-secondary">{formatPeople(pop)}</span> pop · {formatPeople(jobs)} jobs ·{" "}
          <span className="text-accent">{formatPeople(allocation.unemployed)} unemployed</span>
        </span>
      </div>

      <div
        role="img"
        aria-label={`Population ${formatPeople(pop)}: ${working.map((w) => `${formatPeople(w.value)} ${w.label.toLowerCase()}`).join(", ")}, ${formatPeople(allocation.unemployed)} unemployed`}
        className="flex h-4 overflow-hidden border border-border bg-surface-active"
      >
        {working.map((w) => <div key={w.key} className={w.bar} style={{ width: `${pct(w.value)}%` }} />)}
        <div className="border-l border-background" style={{ width: `${pct(allocation.unemployed)}%`, backgroundImage: IDLE_HATCH }} />
      </div>

      <div className="mt-2 flex flex-wrap gap-x-3.5 gap-y-1 font-mono text-[10px] text-text-secondary">
        {working.map((w) => {
          const chip = (
            <>
              <span aria-hidden className={`inline-block h-2 w-2 ${w.bar}`} />
              <span>{w.label} <span className="text-text-primary">{formatPeople(w.value)}</span></span>
            </>
          );
          if (!w.basket) {
            return <span key={w.key} className="inline-flex items-center gap-1.5">{chip}</span>;
          }
          return (
            <Tooltip key={w.key}>
              <TooltipTriggerLabel className="inline-flex items-center gap-1.5">{chip}</TooltipTriggerLabel>
              <TooltipContent className="w-56"><BasketTooltipBody grade={w.key} basket={w.basket} /></TooltipContent>
            </Tooltip>
          );
        })}
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="inline-block h-2 w-2 border border-border" style={{ backgroundImage: IDLE_HATCH }} />
          Unemployed <span className="text-text-primary">{formatPeople(allocation.unemployed)}</span>
        </span>
      </div>

      {hasSkill && (
        <>
          <div className="my-2.5 h-px bg-border" />
          <p className="mb-1 font-mono text-[9px] uppercase tracking-wider text-text-tertiary/80">Skill licensing — working / licensed seats</p>
          <LicensingRow grade="skill1" pool={labour.skill1} buildHint="build a vocational school" />
          <LicensingRow grade="skill2" pool={labour.skill2} buildHint="build a research institute" />
        </>
      )}
    </Card>
  );
}

export function IndustryPanel({ systemId }: { systemId: string }) {
  const data = useSystemIndustry(systemId);
  const { systemInfo } = useSystemInfo(systemId);
  const construction = useSystemConstruction(systemId);
  const buildSurface = useSystemBuildOptions(systemId);
  const cancelOrder = useCancelOrder();
  const newIndustryDialog = useDialog();

  if (data.visibility === "unknown") {
    return <EmptyState message="This system isn't developed yet — no industry to survey." />;
  }

  const { space, deposits, labour, labourAllocation, labourFulfillment, buildings, supplyChain, unrest, skillBaskets } = data;

  if (buildings.length === 0) {
    return <EmptyState message="Undeveloped — no industry established. Charted deposits await development." />;
  }

  // System health + per-building tally, grounded in the decay engine: a level sheds only under
  // unrest teardown or when a WHOLE level is idle (floor(built − used) ≥ 1).
  const totalIdleLevels = buildings.reduce((s, b) => s + Math.max(0, Math.floor(b.count - b.used)), 0);
  const sysHealth = industryHealth({ unrest, idleLevels: totalIdleLevels, unrestDecayThreshold: THRESHOLD });
  const tally: Record<IndustryHealth, number> = { stable: 0, contracting: 0, collapsing: 0 };
  for (const b of buildings) {
    tally[buildingHealth({ used: b.used, built: b.count, unrest, unrestDecayThreshold: THRESHOLD })]++;
  }

  // Extractors sit on deposit slots; factories/complexes/support buildings on general land (housing
  // folds into the magbar; academies into the Labour card's licensing rows; support buildings — e.g.
  // the Construction Centre — get their own group below).
  const extractors = buildings.filter(
    (b) =>
      b.tier === 0 &&
      !ACADEMY_TYPES.includes(b.buildingType) &&
      !COMPLEX_TYPES.includes(b.buildingType) &&
      !SUPPORT_TYPES.includes(b.buildingType),
  );
  // General-land building groups (housing folds into the magbar too; academies live in the Labour card).
  // Specialisation sits above Production — the complexes buff the families beneath them. Support sits
  // last — enabling infrastructure (construction throughput), not manufacturing.
  const buildingGroups: Array<{ title: BuildingGroupTitle; buildings: BuildingEntry[] }> = [
    { title: "Housing", buildings: buildings.filter((b) => b.tier === -1) },
    { title: "Specialisation", buildings: buildings.filter((b) => COMPLEX_TYPES.includes(b.buildingType)) },
    { title: "Production", buildings: buildings.filter((b) => b.tier >= 1) },
    { title: "Support", buildings: buildings.filter((b) => SUPPORT_TYPES.includes(b.buildingType)) },
  ];

  const supplyByGood = new Map(supplyChain.map((s) => [s.goodId, s]));
  const depRows = depositRows(deposits, extractors, unrest, THRESHOLD);
  const contributorsFor = (resource: DepositRow["resource"]) =>
    extractors.filter((b) => BUILDING_TYPES[b.buildingType]?.resource === resource);

  const depWorked = depRows.reduce((s, r) => s + r.worked, 0);
  const depSlots = depRows.reduce((s, r) => s + r.slotCap, 0);
  const land = generalLand(space);
  const generalUsed = land.housing + land.factory;
  const generalFree = land.habitableFree + land.factoryFree;

  // The construction surface: only the player's own systems get order verbs (quick-add, cancel, the
  // New-industry dialog) — AI/rival systems render the same ghost rows read-only, no extra column.
  const canOrder = buildSurface.mode === "build";
  const buildOptions = buildSurface.mode === "build" ? buildSurface.options : [];
  const optionByType = new Map(buildOptions.map((o) => [o.buildingType, o]));
  const currentTypes = new Set(buildings.map((b) => b.buildingType));
  const dialogOptions = buildOptions.filter((o) => !currentTypes.has(o.buildingType) && o.maxLevels > 0);
  const ghostRows = classifyGhosts(construction.visibility === "visible" ? construction.projects : []);
  const onCancelOrder = (projectId: string) => cancelOrder.mutate({ projectId });

  return (
    <div className="space-y-4">
      {/* System health strip */}
      <Card variant="bordered" padding="sm">
        <div className="flex items-center gap-2.5">
          <Badge color={HEALTH[sysHealth].badge}>
            <HealthGlyph health={sysHealth} className="mr-1 text-xs" decorative />
            {HEALTH[sysHealth].label}
          </Badge>
          <span className="ml-auto flex items-center gap-3.5 font-mono text-xs text-text-secondary">
            <span>unrest <span className="text-text-primary">{unrest.toFixed(2)}</span></span>
            <span>labour <span className="text-text-primary">{Math.round(labourFulfillment * 100)}%</span></span>
            <LegendTooltip />
            {canOrder && (
              <Button variant="outline" size="xs" type="button" onClick={newIndustryDialog.onOpen}>
                + New industry
              </Button>
            )}
          </span>
        </div>
        <p className="mt-1.5 flex gap-3 font-mono text-[11px]">
          <span className="text-status-green-light">{tally.stable} stable</span>
          <span className="text-status-amber-light">{tally.contracting} contracting</span>
          <span className="text-status-red-light">{tally.collapsing} collapsing</span>
        </p>
      </Card>

      {canOrder && (
        <BuildDialog
          systemId={systemId}
          systemName={systemInfo?.name ?? systemId}
          options={dialogOptions}
          open={newIndustryDialog.open}
          onClose={newIndustryDialog.onClose}
        />
      )}

      <LabourCard labour={labour} allocation={labourAllocation} skillBaskets={skillBaskets} />

      {/* Deposit land */}
      {depRows.length > 0 && (
        <Card variant="bordered" padding="xs">
          <PoolHead
            title="Deposit land"
            sub="extractors"
            right={<><span className="text-text-primary">{depWorked.toFixed(1)}</span>/{depSlots} worked</>}
          />
          <DepositTable
            rows={depRows}
            contributorsFor={contributorsFor}
            systemId={systemId}
            canOrder={canOrder}
            optionByType={optionByType}
            ghosts={ghostRows.get("deposit") ?? []}
            onCancel={onCancelOrder}
          />
        </Card>
      )}

      {/* General land — aggregate capacity */}
      <Card variant="bordered" padding="xs">
        <PoolHead
          title="General land"
          sub="housing + factories"
          right={<><span className="text-text-primary">{formatMagnitude(generalUsed)}</span>/{formatMagnitude(land.general)} · <span className="text-accent">{formatMagnitude(generalFree)} free</span></>}
        />
        <MagBar land={land} />
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-text-secondary">
          <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 bg-accent" /> Housing {formatMagnitude(land.housing)}</span>
          <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 bg-accent-muted" /> Factories {formatMagnitude(land.factory)}</span>
          <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 border border-border" style={{ backgroundImage: COPPER_HATCH }} /> Habitable {formatMagnitude(land.habitable)}</span>
          <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 border border-border bg-surface-active" /> Free {formatMagnitude(generalFree)}</span>
        </div>
        <BuildingsTable
          groups={buildingGroups}
          labour={labour}
          unrest={unrest}
          supplyByGood={supplyByGood}
          systemId={systemId}
          canOrder={canOrder}
          optionByType={optionByType}
          ghostsByGroup={ghostRows}
          onCancel={onCancelOrder}
        />
      </Card>
    </div>
  );
}
