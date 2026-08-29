"use client";

import { Fragment, useMemo } from "react";
import { tv } from "tailwind-variants";
import { useSystemIndustry } from "@/lib/hooks/use-system-industry";
import { useSystemInfo } from "@/lib/hooks/use-system-info";
import { useSystemConstruction } from "@/lib/hooks/use-system-construction";
import { useSystemBuildOptions } from "@/lib/hooks/use-build-options";
import { useCancelOrder } from "@/lib/hooks/use-construction-orders";
import { GOODS } from "@/lib/constants/goods";
import { BODY_ARCHETYPES } from "@/lib/constants/bodies";
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
import type { BodyArchetypeId, GoodTier } from "@/lib/types/game";
import type { BuildOptionData, PopNeedData } from "@/lib/types/api";
import { formatMagnitude, formatPeople, formatUnitsShort } from "@/lib/utils/format";
import { formatEta } from "@/lib/utils/construction-format";
import { barWidthPct } from "@/lib/utils/math";
import { Card } from "@/components/ui/card";
import { Badge, type BadgeColor } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { InfoIcon } from "@/components/ui/icons";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { PopoverTriggerLabel } from "@/components/ui/popover-trigger-label";
import { PopoverHeader } from "@/components/ui/popover";
import { TermLabel } from "@/components/ui/term-label";
import { useDialog } from "@/components/ui/dialog";
import { CompositionBar } from "@/components/ui/composition-bar";
import { depositRows, depositRowProblems, depositTypeProblems, idleLevelSplit, staffedLevels, type DepositRow, type DepositTypeRow } from "@/components/system/industry-rows";
import { classifyGhosts, type GhostGroup, type GhostRow } from "@/components/system/industry-ghosts";
import { buildProblems, needSeverity, problemGlyph, SEVERITY_GLYPH, SEVERITY_TEXT, type ProblemItem } from "@/components/system/needs-view";
import { NeedCells, NeedsTable } from "@/components/system/needs-table";
import { NeedPopoverBody } from "@/components/system/need-popover-body";
import { QuickAddButton } from "@/components/construction/quick-add-button";
import { BuildDialog } from "@/components/construction/build-dialog";

const THRESHOLD = INFRASTRUCTURE_DECAY_PARAMS.unrestThreshold;

const problemRowVariants = tv({
  slots: {
    row: "",
    cell: "px-1.5 pt-1 text-[12px]",
  },
  variants: {
    hasProblems: {
      true: { cell: "pb-0.5" },
      false: { row: "border-b border-border/40", cell: "pb-1" },
    },
    trimLastBorder: {
      true: { row: "last:border-b-0" },
      false: {},
    },
  },
});

/**
 * Health → label / badge colour / text colour / glyph, in one place so the badge, tally, row
 * indicators and legend agree. Grounded in the decay engine (see industryHealth): a shape-first
 * glyph keeps it colourblind-safe. Stable holds, idle sits on a whole idle level decay can't see (a
 * recipe input, not a shrink), contracting slowly sheds idle levels, collapsing is unrest teardown.
 * Idle reads status-blue — informational rather than a point on the stable→collapsing danger ramp —
 * and a square glyph (■, per Foundry's square-corner motif) rather than a triangle, since it isn't
 * shrinking the way contracting/collapsing's triangles are.
 */
const HEALTH: Record<IndustryHealth, { label: string; badge: BadgeColor; text: string; glyph: string }> = {
  stable:      { label: "Stable",      badge: "green", text: "text-status-green-light", glyph: "●" },
  idle:        { label: "Idle",        badge: "blue",  text: "text-status-blue-light",  glyph: "■" },
  contracting: { label: "Contracting", badge: "amber", text: "text-status-amber-light", glyph: "▽" },
  collapsing:  { label: "Collapsing",  badge: "red",   text: "text-status-red-light",   glyph: "▼" },
};

// Faint light hatch = idle labour capacity; red hatch = skill jobs no academy can license; copper
// hatch = free habitable land (housing can still grow here); dim grey hatch = free deposit slots —
// its own, dimmer tone (distinct from the copper land hatch) so the two budget bars read as separate
// stories at a glance, per the approved prototype (variant A).
const IDLE_HATCH = "repeating-linear-gradient(135deg, transparent 0 4px, rgba(201,209,217,0.06) 4px 8px)";
const GAP_HATCH = "repeating-linear-gradient(135deg, rgba(240,97,109,0.45) 0 4px, transparent 4px 8px)";
const COPPER_HATCH = "repeating-linear-gradient(135deg, rgba(208,106,66,0.45) 0 2px, transparent 2px 6px)";
const DEPOSIT_FREE_HATCH = "repeating-linear-gradient(135deg, rgba(139,148,158,0.25) 0 2px, transparent 2px 6px)";

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

/** Human-readable label for a body archetype — the deposit yield popover's per-body breakdown. */
function bodyLabel(bodyType: BodyArchetypeId): string {
  return BODY_ARCHETYPES[bodyType].name;
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

/**
 * The deposit row's yield read: the worked-prefix mean ground value alone, band-coloured, one
 * stat-register figure and nothing else in the cell (owner decision, Kai 2026-08-25 — a clean cell,
 * the marginal/per-body story moved entirely into the popover below). The popover is the
 * explanation surface: the same combined figure repeated as a labelled line, then which bodies are
 * actually contributing worked ground and at what value each, then what the next extractor built
 * here would realise (or that there is nothing left to build on).
 */
function YieldTag({ row }: { row: DepositRow }) {
  const pct = Math.round(row.yieldMult * 100);
  return (
    <PopoverTriggerLabel className="block w-full text-right" content={<YieldPopoverBody row={row} />}>
      <span className={`block font-mono text-[11px] ${QUALITY_BAND_TEXT[row.band]}`}>{pct}%</span>
    </PopoverTriggerLabel>
  );
}

/** The yield tag's popover body: combined figure · per-body worked breakdown · next slot. The
 *  panel's first real chain — "Combined yield", each body archetype, "slot"/"slots" and the
 *  quality-band percentages all open their own glossary definition. */
export function YieldPopoverBody({ row }: { row: DepositRow }) {
  return (
    <div className="space-y-1">
      <p className="font-mono text-text-primary">
        <TermLabel id="realisedYield">Combined yield</TermLabel>: {Math.round(row.yieldMult * 100)}%
      </p>
      {row.workedByBody.length > 0 && (
        <div className="space-y-0.5 border-t border-border/60 pt-1">
          {row.workedByBody.map((b, i) => (
            <p key={`${b.bodyType}-${i}`} className="font-mono text-text-secondary">
              <TermLabel id="archetype">{bodyLabel(b.bodyType)}</TermLabel>: {b.worked}{" "}
              <TermLabel id="resourceSlot">{b.worked === 1 ? "slot" : "slots"}</TermLabel> ·{" "}
              <TermLabel id="qualityBand">{Math.round(b.groundValue * 100)}%</TermLabel>
            </p>
          ))}
        </div>
      )}
      <p className="border-t border-border/60 pt-1 text-text-tertiary">
        {row.marginal ? (
          <>
            Next <TermLabel id="resourceSlot">slot</TermLabel>:{" "}
            <TermLabel id="qualityBand">{Math.round(row.marginal.groundValue * 100)}%</TermLabel> on{" "}
            <TermLabel id="archetype">{bodyLabel(row.marginal.bodyType)}</TermLabel>
          </>
        ) : (
          <>All deposit <TermLabel id="resourceSlot">slots</TermLabel> worked</>
        )}
      </p>
    </div>
  );
}

/**
 * `fill/capacity`, coloured by health when not stable. The fill keeps one decimal (the fractional
 * figure is the signal); the capacity reads as a whole count of slots / built levels. The fill is
 * `staffedLevels` — pure labour for producers/extractors, occupancy for housing, licence/family draw
 * for academies/complexes/support (see that helper's docstring). Health is driven separately by
 * `used` (staffed AND selling for producers/extractors), so a producer or extractor row can read
 * fully staffed while still contracting or collapsing from a stalled sell-through; the state sub-row
 * (`ProblemLine`) names that condition, on both the general-land and deposit tables.
 */
function Staffed({ staffed, total, health }: { staffed: number; total: number; health: IndustryHealth }) {
  return (
    <>
      <span className={health === "stable" ? "text-text-primary" : HEALTH[health].text}>{staffed.toFixed(1)}</span>/{Math.round(total)}
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

// ── Popover bodies ───────────────────────────────────────────────────────────

/** Deposit popover body: resource · yield band · built/slots · staffed · the goods extracted from
 *  it. The combined/next-slot yield figures live in the Yield column's own popover
 *  (`YieldPopoverBody`) — this one never repeats them. */
export function DepositPopoverBody({ row, contributors }: { row: DepositRow; contributors: BuildingEntry[] }) {
  return (
    <div className="space-y-1">
      <PopoverHeader title={<span className="capitalize">{row.resource}</span>} />
      <p className="whitespace-nowrap font-mono text-[10px] text-text-tertiary">
        {QUALITY_BAND_LABEL[row.band]} · {row.built}/{row.depositCounts} slots built · {row.staffed.toFixed(1)} staffed
      </p>
      {contributors.length > 0 && (
        <div className="space-y-0.5 overflow-x-auto border-t border-border/60 pt-1.5">
          <p className="font-mono text-[9px] uppercase tracking-wider text-text-tertiary/80">extracted goods</p>
          {contributors.map((b) => (
            <div key={b.buildingType} className="flex items-center justify-between gap-3 whitespace-nowrap text-[11px]">
              <span className="text-text-primary">{label(b.buildingType)}</span>
              <span className="font-mono text-text-secondary">{b.output !== undefined ? formatUnitsShort(b.output) : "0"}/cyc</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Rich per-building popover body: header · description · per-grade filled/needed · inputs · footer. Producers get the grade split + input gates. */
function BuildingPopoverBody({
  b,
  labour,
  supply,
}: {
  b: BuildingEntry;
  labour: SystemLabour;
  supply?: SystemIndustryReadout["supplyChain"][number];
}) {
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
  const recipeInputs = isProducer && b.outputGood ? Object.keys(GOOD_RECIPES[b.outputGood] ?? {}) : [];

  return (
    <div className="space-y-1.5">
      <PopoverHeader title={label(b.buildingType)} />
      {(tierLabel || b.count > 0) && (
        <p className="whitespace-nowrap font-mono text-[10px] text-text-tertiary">
          {tierLabel && !isAcademy && !isComplex && !isSupport ? `tier ${b.tier} · ${tierLabel} · ` : ""}×{formatMagnitude(b.count)} built
        </p>
      )}
      <p className="text-[11px] leading-snug text-text-secondary">{describeBuilding(b.buildingType)}</p>

      {complexFamily && (
        <div className="space-y-0.5 border-t border-border/60 pt-1.5">
          <p className="whitespace-nowrap font-mono text-[9px] uppercase tracking-wider text-text-tertiary/80">
            family yield — <span className="text-text-secondary">×{Number(familyBuff.toFixed(2))}</span>
            {b.count < 1 ? ` of ×${complexFamily.buffMult} at full strength` : ""}
          </p>
          <p className="text-[11px] leading-snug text-text-secondary">
            {complexFamily.goods.map((g) => GOODS[g]?.name ?? g).join(" · ")}
          </p>
        </div>
      )}

      {isProducer && grades.length > 0 && (
        <div className="space-y-0.5 overflow-x-auto border-t border-border/60 pt-1.5">
          <p className="font-mono text-[9px] uppercase tracking-wider text-text-tertiary/80">staffing — filled / needed</p>
          {grades.map((g) => (
            <div key={g.grade} className="flex items-center gap-1.5 whitespace-nowrap">
              <span aria-hidden className={`w-3 font-mono text-[9px] ${GRADE[g.grade].text}`}>{GRADE[g.grade].tag}</span>
              {/* `min-w` floors this bar's own width — under `w-max` the popover shrinks to its
                  widest row, and an empty flex-1 track has no content of its own to claim any of
                  that width from, so without a floor it could render at (near) zero width in a
                  popover with nothing wider to push the container out. */}
              <div className="relative h-1.5 min-w-16 flex-1 overflow-hidden border border-border bg-surface-active">
                <div className={`absolute inset-y-0 left-0 ${GRADE[g.grade].bar}`} style={{ width: `${barWidthPct(g.fulfil)}%` }} />
              </div>
              <span className={`w-[70px] text-right font-mono text-[10px] ${g.wall ? "text-status-red-light" : "text-text-secondary"}`}>
                {formatMagnitude(g.filled)}/{formatMagnitude(g.needed)}{g.wall ? " ◄" : ""}
              </span>
            </div>
          ))}
        </div>
      )}

      {recipeInputs.length > 0 && (
        <div className="space-y-0.5 border-t border-border/60 pt-1.5">
          <p className="font-mono text-[9px] uppercase tracking-wider text-text-tertiary/80">inputs</p>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            {recipeInputs.map((input) => {
              const short = supply?.throttledBy.includes(input) ?? false;
              return (
                <span key={input} className={`whitespace-nowrap font-mono text-[11px] ${short ? "text-status-amber-light" : "text-status-green-light"}`}>
                  {short ? "⚠" : "✓"} {label(input)}{short && supply ? ` ${Math.round(supply.inputGate * 100)}%` : ""}
                </span>
              );
            })}
          </div>
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
function GhostNameCell({
  ghost, canCancel, onCancel, cancelPending,
}: { ghost: GhostRow; canCancel: boolean; onCancel: (projectId: string) => void; cancelPending: boolean }) {
  return (
    <td className="px-1.5 py-1 text-[12px] text-text-tertiary">
      <span className="flex items-center gap-1.5">
        <span aria-hidden className="font-mono text-[9px] text-status-amber-light">◇</span>
        {ghost.label} <span className="font-mono">+{ghost.levels}</span>
        {ghost.origin === "player" && <Badge color="amber">ORDERED</Badge>}
        {ghost.origin === "player" && canCancel && (
          <Button
            type="button"
            variant="dismiss"
            size="compact"
            aria-label={`Cancel ${ghost.label} order`}
            disabled={cancelPending}
            onClick={() => onCancel(ghost.projectId)}
            className="border-transparent px-1 transition-colors hover:border-transparent hover:bg-transparent hover:text-status-red disabled:opacity-35"
          >
            ✕
          </Button>
        )}
      </span>
      <span className="mt-0.5 block h-1 max-w-[180px] bg-surface-active">
        <span aria-hidden className="block h-full bg-status-amber/75" style={{ width: `${barWidthPct(ghost.progress)}%` }} />
      </span>
    </td>
  );
}

/** In-flight extractor in the deposit ledger: name cell, then progress% / — / — / ETA under Staffed / Slots / Yield / Out-cyc. */
function DepositGhostRow({
  ghost, canCancel, onCancel, cancelPending, showActionColumn,
}: { ghost: GhostRow; canCancel: boolean; onCancel: (projectId: string) => void; cancelPending: boolean; showActionColumn: boolean }) {
  return (
    <tr className="border-b border-border/40 last:border-b-0">
      <GhostNameCell ghost={ghost} canCancel={canCancel} onCancel={onCancel} cancelPending={cancelPending} />
      <td className="px-1.5 py-1 text-right font-mono text-[11px] text-status-amber-light">{Math.round(barWidthPct(ghost.progress))}%</td>
      <td />
      <td />
      <td className="px-1.5 py-1 text-right font-mono text-[11px] text-text-tertiary">{formatEta(ghost.etaCycles)}</td>
      {showActionColumn && <td />}
    </tr>
  );
}

/** In-flight building in the general-land ledger: name cell, then progress% / ETA under Staffed / Out-cyc. */
function BuildingGhostRow({
  ghost, canCancel, onCancel, cancelPending, showActionColumn,
}: { ghost: GhostRow; canCancel: boolean; onCancel: (projectId: string) => void; cancelPending: boolean; showActionColumn: boolean }) {
  return (
    <tr className="border-b border-border/40 last:border-b-0">
      <GhostNameCell ghost={ghost} canCancel={canCancel} onCancel={onCancel} cancelPending={cancelPending} />
      <td className="px-1.5 py-1 text-right font-mono text-[11px] text-status-amber-light">{Math.round(barWidthPct(ghost.progress))}%</td>
      <td className="px-1.5 py-1 text-right font-mono text-[11px] text-text-tertiary">{formatEta(ghost.etaCycles)}</td>
      {showActionColumn && <td />}
    </tr>
  );
}

// ── Tables ───────────────────────────────────────────────────────────────────

/**
 * One extractor type's sub-row under a shared multi-type deposit (e.g. arable → food + textiles): the
 * "└" glyph ties it to the parent's aggregate above. Slots and Yield stay blank — the parent row above
 * owns those (they're the shared pool a build of either type draws down) — only Staffed and Out/cyc are
 * this type's own numbers, so quick-add here restores the one-click add the ambiguous parent row lost.
 * This is also the one place a shared deposit's per-type problem chip renders — the parent row
 * deliberately shows none for a multi-type deposit (`depositRowProblems`'s docstring).
 */
function DepositTypeSubRow({
  t, popNeed, systemId, canOrder, option,
}: {
  t: DepositTypeRow;
  popNeed?: PopNeedData;
  systemId: string;
  canOrder: boolean;
  option?: BuildOptionData;
}) {
  const items = depositTypeProblems(t, popNeed, label);
  const hasProblems = items.length > 0;
  const styles = problemRowVariants({ hasProblems, trimLastBorder: true });

  return (
    <tr className={styles.row()}>
      <td className={styles.cell({ className: "text-text-secondary" })}>
        <span className="flex items-center gap-1.5 pl-3">
          <span aria-hidden className="font-mono text-[10px] text-text-tertiary">└</span>
          {label(t.buildingType)}
        </span>
        <ProblemLine items={items} popNeed={popNeed} />
      </td>
      <td className="px-1.5 py-1 align-top text-right font-mono text-[12px] text-text-secondary"><Staffed staffed={t.staffed} total={t.built} health={t.health} /></td>
      <td />
      <td />
      <td className="px-1.5 py-1 align-top text-right font-mono text-[12px] text-text-secondary">{t.output > 0 ? formatUnitsShort(t.output) : "—"}</td>
      {canOrder && (
        <td className="px-1.5 py-1 align-top text-right">
          {option && <QuickAddButton systemId={systemId} option={option} />}
        </td>
      )}
    </tr>
  );
}

/**
 * Deposit table: per-resource slot fill — health glyph · resource · staffed/built · built/slots · yield ·
 * output. A resource worked by exactly one catalog extractor type renders as today: a single row, with a
 * trailing quick-add column on the player's own systems, and — same mechanism as the general-land table's
 * `BuildingRow` — an exception-only problem sub-row (`ProblemLine`) naming why it's idle. A resource shared
 * by several types (e.g. arable → food + textiles) renders the parent row as the shared/aggregate picture —
 * Slots is the shared pool, built either type draws it down — with no quick-add and no problem chip of its
 * own (a shared row has no single staffing/idle figure to name honestly; see `depositRowProblems`), and one
 * sub-row per type below carrying that type's own Staffed/Out, its own quick-add, and its own problem chip.
 * In-flight extractor orders render as ghost rows under their matching row: the single row for a one-type
 * resource, the matching sub-row for a shared one.
 */
function DepositTable({
  rows, contributorsFor, popNeedByGood, systemId, canOrder, optionByType, ghosts, onCancel, cancelPending,
}: {
  rows: DepositRow[];
  contributorsFor: (r: DepositRow["resource"]) => BuildingEntry[];
  popNeedByGood: Map<string, PopNeedData>;
  systemId: string;
  canOrder: boolean;
  optionByType: Map<string, BuildOptionData>;
  ghosts: GhostRow[];
  onCancel: (projectId: string) => void;
  cancelPending: boolean;
}) {
  return (
    <table className="w-full border-collapse">
      <thead>
        <tr>
          <Th>Deposit</Th><Th right>Staffed</Th><Th right>Slots</Th><Th right>Yield</Th><Th right>Out/cyc</Th>
          {canOrder && <Th right> </Th>}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const multi = row.types.length > 1;
          const quickAddOption = canOrder && row.types.length === 1 ? optionByType.get(row.types[0].buildingType) : undefined;
          const soleType = multi ? undefined : row.types[0];
          const rowPopNeed = soleType?.outputGood ? popNeedByGood.get(soleType.outputGood) : undefined;
          const items = depositRowProblems(row, rowPopNeed, label);
          const hasProblems = items.length > 0;
          const styles = problemRowVariants({ hasProblems, trimLastBorder: true });
          return (
            <Fragment key={row.resource}>
              <tr className={styles.row()}>
                <td className={styles.cell({ className: "text-text-primary" })}>
                  <span className="flex items-center gap-1.5">
                    <HealthGlyph health={row.health} className="text-[9px]" />
                    <PopoverTriggerLabel
                      className="capitalize"
                      content={<DepositPopoverBody row={row} contributors={contributorsFor(row.resource)} />}
                    >
                      {row.resource}
                    </PopoverTriggerLabel>
                  </span>
                  <ProblemLine items={items} popNeed={rowPopNeed} />
                </td>
                <td className="px-1.5 py-1 align-top text-right font-mono text-[12px] text-text-secondary"><Staffed staffed={row.staffed} total={row.built} health={row.health} /></td>
                <td className="px-1.5 py-1 align-top text-right font-mono text-[12px] text-text-secondary">{Math.round(row.built)}/{Math.round(row.depositCounts)}</td>
                <td className="px-1.5 py-1 align-top text-right">
                  <YieldTag row={row} />
                </td>
                <td className="px-1.5 py-1 align-top text-right font-mono text-[12px] text-text-primary">{row.output > 0 ? formatUnitsShort(row.output) : "—"}</td>
                {canOrder && (
                  <td className="px-1.5 py-1 align-top text-right">
                    {quickAddOption && <QuickAddButton systemId={systemId} option={quickAddOption} />}
                  </td>
                )}
              </tr>
              {!multi && ghosts.filter((g) => g.resource === row.resource).map((g) => (
                <DepositGhostRow key={g.projectId} ghost={g} canCancel={canOrder} onCancel={onCancel} cancelPending={cancelPending} showActionColumn={canOrder} />
              ))}
              {multi && row.types.map((t) => (
                <Fragment key={t.buildingType}>
                  <DepositTypeSubRow
                    t={t}
                    popNeed={t.outputGood ? popNeedByGood.get(t.outputGood) : undefined}
                    systemId={systemId}
                    canOrder={canOrder}
                    option={optionByType.get(t.buildingType)}
                  />
                  {ghosts.filter((g) => g.buildingType === t.buildingType).map((g) => (
                    <DepositGhostRow key={g.projectId} ghost={g} canCancel={canOrder} onCancel={onCancel} cancelPending={cancelPending} showActionColumn={canOrder} />
                  ))}
                </Fragment>
              ))}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}

/** Exception-only problem sub-row: one item per actual problem (input throttle or pop shortage), nothing when healthy. */
function ProblemLine({ items, popNeed }: { items: ProblemItem[]; popNeed?: PopNeedData }) {
  if (items.length === 0) return null;
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 pl-4 text-[11px]">
      {items.map((item, i) => {
        const chip = (
          <span className={`font-mono ${SEVERITY_TEXT[item.severity]}`}>
            {problemGlyph(item)} {item.label}
          </span>
        );
        return (
          <Fragment key={`${item.kind}-${item.label}`}>
            {i > 0 && <span className="text-text-tertiary">·</span>}
            {item.kind === "pops" && popNeed ? (
              <PopoverTriggerLabel content={<NeedPopoverBody need={popNeed} />}>
                {chip}
              </PopoverTriggerLabel>
            ) : (
              chip
            )}
          </Fragment>
        );
      })}
    </span>
  );
}

/** One general-land building row — health glyph · name (popover) · staffed/built · output, with an exception-only problem sub-row.
 *  On the player's own systems, a trailing quick-add column offers +1 level when a feasibility option exists. */
function BuildingRow({
  b,
  labour,
  unrest,
  supply,
  popNeed,
  systemId,
  canOrder,
  option,
}: {
  b: BuildingEntry;
  labour: SystemLabour;
  unrest: number;
  supply?: SystemIndustryReadout["supplyChain"][number];
  popNeed?: PopNeedData;
  systemId: string;
  canOrder: boolean;
  option?: BuildOptionData;
}) {
  const health = buildingHealth({ used: b.used, built: b.count, unrest, unrestDecayThreshold: THRESHOLD, idleReason: b.idleReason });
  const items = buildProblems({ staffedFraction: b.staffedFraction, idleReason: b.idleReason }, supply, popNeed, label);
  const hasProblems = items.length > 0;
  const styles = problemRowVariants({ hasProblems });
  return (
    <tr className={styles.row()}>
      <td className={styles.cell({ className: "text-text-primary" })}>
        <span className="flex items-center gap-1.5">
          <HealthGlyph health={health} className="text-[9px]" />
          <PopoverTriggerLabel content={<BuildingPopoverBody b={b} labour={labour} supply={supply} />}>
            {label(b.buildingType)}
          </PopoverTriggerLabel>
        </span>
        <ProblemLine items={items} popNeed={popNeed} />
      </td>
      <td className="px-1.5 py-1 align-top text-right font-mono text-[12px] text-text-secondary"><Staffed staffed={staffedLevels(b)} total={b.count} health={health} /></td>
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
 * The Staffed column means something different in each group — producers/support are staffing,
 * housing is occupancy, academies/complexes are licence/family draw (`capacityUsed`/`complexUsed`,
 * `industry.ts:406-415` — "drawn" because both are how much of a capacity the rest of the system is
 * pulling on, neither staffing nor occupancy). Only the groups where "Staffed" reads wrong get a
 * caption under the column; Production and Support are genuinely staffing, so they get none.
 */
const GROUP_STAFFED_CAPTION: Partial<Record<BuildingGroupTitle, string>> = {
  Housing: "occupied",
  Academies: "drawn",
  Specialisation: "drawn",
};

/**
 * General-land buildings, grouped under Housing / Production / Specialisation / Support subheadings. A group
 * with no built rows but in-flight ghosts still renders its heading — that's the only content telling the
 * player something is coming. The heading row doubles as a caption for the Staffed column where that word
 * means something other than staffing for the group below it (see `GROUP_STAFFED_CAPTION`). Player systems
 * get a trailing quick-add column.
 */
function BuildingsTable({
  groups,
  labour,
  unrest,
  supplyByGood,
  popNeedByGood,
  systemId,
  canOrder,
  optionByType,
  ghostsByGroup,
  onCancel,
  cancelPending,
}: {
  groups: Array<{ title: BuildingGroupTitle; buildings: BuildingEntry[] }>;
  labour: SystemLabour;
  unrest: number;
  supplyByGood: Map<string, SystemIndustryReadout["supplyChain"][number]>;
  popNeedByGood: Map<string, PopNeedData>;
  systemId: string;
  canOrder: boolean;
  optionByType: Map<string, BuildOptionData>;
  ghostsByGroup: Map<GhostGroup, GhostRow[]>;
  onCancel: (projectId: string) => void;
  cancelPending: boolean;
}) {
  const active = groups.filter((g) => g.buildings.length > 0 || (ghostsByGroup.get(g.title)?.length ?? 0) > 0);
  if (active.length === 0) return null;
  return (
    <table className="mt-3 w-full border-collapse">
      <thead>
        <tr>
          <Th>Building</Th><Th right>Staffed</Th><Th right>Out/cyc</Th>
          {canOrder && <Th right> </Th>}
        </tr>
      </thead>
      <tbody>
        {active.map((group) => (
          <Fragment key={group.title}>
            <tr>
              <td className="px-1.5 pb-0.5 pt-2.5 font-display text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">
                {group.title}
              </td>
              <td className="px-1.5 pb-0.5 pt-2.5 text-right font-mono text-[10px] text-text-tertiary">
                {GROUP_STAFFED_CAPTION[group.title] ?? ""}
              </td>
              <td />
              {canOrder && <td />}
            </tr>
            {group.buildings.map((b) => (
              <BuildingRow
                key={b.buildingType}
                b={b}
                labour={labour}
                unrest={unrest}
                supply={b.outputGood ? supplyByGood.get(b.outputGood) : undefined}
                popNeed={b.outputGood ? popNeedByGood.get(b.outputGood) : undefined}
                systemId={systemId}
                canOrder={canOrder}
                option={optionByType.get(b.buildingType)}
              />
            ))}
            {(ghostsByGroup.get(group.title) ?? []).map((g) => (
              <BuildingGhostRow key={g.projectId} ghost={g} canCancel={canOrder} onCancel={onCancel} cancelPending={cancelPending} showActionColumn={canOrder} />
            ))}
          </Fragment>
        ))}
      </tbody>
    </table>
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
            <li><HealthGlyph health="idle" className="mr-1 text-[9px]" decorative /> idle — a whole level idle for want of a recipe input; nothing sheds until the input arrives</li>
            <li><HealthGlyph health="contracting" className="mr-1 text-[9px]" decorative /> contracting — a whole level sits idle for a reason decay can act on; the marginal level sheds after a buffer</li>
            <li><HealthGlyph health="collapsing" className="mr-1 text-[9px]" decorative /> collapsing — unrest teardown; levels tear down immediately</li>
          </ul>
        </div>
        <div>
          <p className="mb-1 font-display text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">Columns</p>
          <p className="text-[11px] text-text-secondary"><span className="font-mono">staffed/built</span> is staffed labour on the built extractor levels — a row can read fully staffed and still show a state chip below it (understaffed, pop-short, or glut-idling — extractors have no recipe inputs, so never input-short) when it isn&apos;t selling everything it makes; <span className="font-mono">slots</span> is built levels against the deposit&apos;s max; <span className="font-mono">out/cyc</span> is real output after input gates. A deposit shared by more than one extractor type shows its state chip on each type&apos;s own sub-row rather than the shared parent row. The general-land table&apos;s Staffed column means occupancy for housing and licence/family draw for academies and complexes — captioned inline where it isn&apos;t staffing.</p>
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

/** Skilled-grade basket popover body: lead-in line + per-good per-head rate, richest first. */
function BasketPopoverBody({ grade, basket }: { grade: "skill1" | "skill2"; basket: SkillBasketEntry[] }) {
  const noun = grade === "skill1" ? "technician" : "engineer";
  return (
    <div className="space-y-1">
      <p className="text-[11px] leading-snug text-text-secondary">Each {noun} adds demand for:</p>
      <div className="space-y-0.5 overflow-x-auto">
        {basket.map((entry) => (
          <div key={entry.goodId} className="flex items-center justify-between gap-3 whitespace-nowrap">
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
            <PopoverTriggerLabel
              key={w.key}
              className="inline-flex items-center gap-1.5"
              content={<BasketPopoverBody grade={w.key} basket={w.basket} />}
            >
              {chip}
            </PopoverTriggerLabel>
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

  // The construction surface: only the player's own systems get order verbs (quick-add, cancel, the
  // New-industry dialog) — AI/rival systems render the same ghost rows read-only, no extra column.
  // Pulled out ahead of the early-return guards below (with safe fallbacks) so the memos that derive
  // from them can be called unconditionally on every render — hooks can't sit after a guard whose
  // branch varies render to render.
  const canOrder = buildSurface.mode === "build";
  const buildOptions = useMemo(
    () => (buildSurface.mode === "build" ? buildSurface.options : []),
    [buildSurface],
  );
  const buildings = useMemo(() => (data.visibility === "visible" ? data.buildings : []), [data]);

  const optionByType = useMemo(() => new Map(buildOptions.map((o) => [o.buildingType, o])), [buildOptions]);
  const currentTypes = useMemo(() => new Set(buildings.map((b) => b.buildingType)), [buildings]);
  const dialogOptions = useMemo(
    () => buildOptions.filter((o) => !currentTypes.has(o.buildingType) && (o.maxLevels === null || o.maxLevels > 0)),
    [buildOptions, currentTypes],
  );
  const ghostRows = useMemo(
    () => classifyGhosts(construction.visibility === "visible" ? construction.projects : []),
    [construction],
  );

  if (data.visibility === "unknown") {
    return <EmptyState message="This system isn't developed yet — no industry to survey." />;
  }

  const { space, deposits, labour, labourAllocation, labourFulfilment, supplyChain, unrest, skillBaskets, popNeeds } = data;

  if (buildings.length === 0) {
    return <EmptyState message="Undeveloped — no industry established. Charted deposits await development." />;
  }

  // System health + per-building tally, grounded in the decay engine: a level sheds only under
  // unrest teardown or when a WHOLE level is idle for a reason decay can see. `idleLevelSplit` owns
  // that split and returns it under `industryHealth`'s own argument names — see its docstring.
  const sysHealth = industryHealth({ unrest, ...idleLevelSplit(buildings), unrestDecayThreshold: THRESHOLD });
  const tally: Record<IndustryHealth, number> = { stable: 0, idle: 0, contracting: 0, collapsing: 0 };
  for (const b of buildings) {
    tally[buildingHealth({ used: b.used, built: b.count, unrest, unrestDecayThreshold: THRESHOLD, idleReason: b.idleReason })]++;
  }

  // Extractors sit on deposit slots; factories/complexes/support buildings on general land (housing
  // folds into the magbar; academies get their own ledger group below, alongside the Labour card's
  // licensing rows; support buildings — e.g. the Construction Centre — get their own group too).
  const extractors = buildings.filter(
    (b) =>
      b.tier === 0 &&
      !ACADEMY_TYPES.includes(b.buildingType) &&
      !COMPLEX_TYPES.includes(b.buildingType) &&
      !SUPPORT_TYPES.includes(b.buildingType),
  );
  // General-land building groups (housing folds into the magbar too; academies sit directly under it
  // as their own group, the Labour card keeps its licensing rows regardless). Specialisation sits above
  // Production — the complexes buff the families beneath them. Support sits last — enabling
  // infrastructure (construction throughput), not manufacturing.
  const buildingGroups: Array<{ title: BuildingGroupTitle; buildings: BuildingEntry[] }> = [
    { title: "Housing", buildings: buildings.filter((b) => b.tier === -1) },
    { title: "Academies", buildings: buildings.filter((b) => ACADEMY_TYPES.includes(b.buildingType)) },
    { title: "Specialisation", buildings: buildings.filter((b) => COMPLEX_TYPES.includes(b.buildingType)) },
    { title: "Production", buildings: buildings.filter((b) => b.tier >= 1) },
    { title: "Support", buildings: buildings.filter((b) => SUPPORT_TYPES.includes(b.buildingType)) },
  ];

  const supplyByGood = new Map(supplyChain.map((s) => [s.goodId, s]));
  const popNeedByGood = new Map(popNeeds.map((n) => [n.goodId, n]));
  // Already pressure-sorted (computePopNeeds) on the linear necessity-weighted share × gap — not the
  // deepest gaps — so unmet[0]/[1] are the two highest-pressure shortages.
  const unmet = popNeeds.filter((n) => needSeverity(n.satisfaction) !== "met");
  const depRows = depositRows(deposits, extractors, unrest, THRESHOLD);
  const contributorsFor = (resource: DepositRow["resource"]) =>
    extractors.filter((b) => BUILDING_TYPES[b.buildingType]?.resource === resource);

  // Two independent budgets (SubstrateSpace: people land, deposit slots) — neither is derived from
  // the other, so each gets its own worked/authored or used/free readout and bar rather than a
  // combined figure. `space.deposit` already carries built-extractor-levels-vs-authored-slots
  // (`summariseSpace`, lib/engine/industry.ts) — the SAME counts `depRows`' own built/depositCounts
  // sum to, so the deposit card reads it straight rather than re-deriving from depRows.
  const depositFree = Math.max(0, space.deposit.total - space.deposit.used);
  const peopleFree = Math.max(0, space.people.total - space.people.used);

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
            <span>labour <span className="text-text-primary">{Math.round(labourFulfilment * 100)}%</span></span>
            <LegendTooltip />
            {canOrder && (
              <Button variant="outline" size="xs" type="button" onClick={newIndustryDialog.onOpen}>
                + New industry
              </Button>
            )}
          </span>
        </div>
        {unmet.length > 0 && (
          <div className="mt-1.5">
            <PopoverTriggerLabel
              className="inline-flex items-center gap-1.5 border border-border bg-surface-active px-2 py-0.5 text-[11px]"
              content={
                <div className="space-y-1">
                  <NeedsTable density="tooltip">
                    {unmet.map((n) => (
                      <tr key={n.goodId}><NeedCells n={n} density="tooltip" /></tr>
                    ))}
                  </NeedsTable>
                  <p className="border-t border-border/60 pt-1 text-text-secondary">Doing worse than this population is used to breeds unrest — famine and critical shortages always do.</p>
                </div>
              }
            >
              <span aria-hidden className={`font-mono text-[10px] ${SEVERITY_TEXT[needSeverity(unmet[0].satisfaction)]}`}>{SEVERITY_GLYPH[needSeverity(unmet[0].satisfaction)]}</span>
              Pops short: <strong>{unmet[0].goodName}</strong>
              {unmet[1] && <> · {unmet[1].goodName}</>}
              {unmet.length > 2 && <span className="text-text-tertiary">+{unmet.length - 2}</span>}
            </PopoverTriggerLabel>
          </div>
        )}
        <p className="mt-1.5 flex gap-3 font-mono text-[11px]">
          <span className="text-status-green-light">{tally.stable} stable</span>
          <span className="text-status-blue-light">{tally.idle} idle</span>
          <span className="text-status-amber-light">{tally.contracting} contracting</span>
          <span className="text-status-red-light">{tally.collapsing} collapsing</span>
        </p>
      </Card>

      {canOrder && (
        <BuildDialog
          key={systemId}
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
            right={<><span className="text-text-primary">{formatMagnitude(space.deposit.used)}</span>/{formatMagnitude(space.deposit.total)} worked · <span className="text-accent">{formatMagnitude(depositFree)} free</span></>}
          />
          <div className="mb-1">
            <CompositionBar
              segments={[
                { label: "Worked", value: space.deposit.used, color: "var(--color-secondary)" },
                { label: "Free", value: depositFree, color: DEPOSIT_FREE_HATCH },
              ]}
            />
          </div>
          <DepositTable
            rows={depRows}
            contributorsFor={contributorsFor}
            popNeedByGood={popNeedByGood}
            systemId={systemId}
            canOrder={canOrder}
            optionByType={optionByType}
            ghosts={ghostRows.get("deposit") ?? []}
            onCancel={onCancelOrder}
            cancelPending={cancelOrder.isPending}
          />
        </Card>
      )}

      {/* Habitable land — the people-land budget housing draws on. Factories/academies/complexes/
          support buildings bill neither land budget (labour, demand and decay bound them instead —
          SubstrateSpace's own docstring), so the buildings table below is NOT a second consumer of
          this bar's total; it just happens to share the card. */}
      <Card variant="bordered" padding="xs">
        <PoolHead
          title="Habitable land"
          sub="housing"
          right={<><span className="text-text-primary">{formatMagnitude(space.people.used)}</span>/{formatMagnitude(space.people.total)} · <span className="text-accent">{formatMagnitude(peopleFree)} free</span></>}
        />
        <div className="mb-1">
          <CompositionBar
            segments={[
              { label: "Housing", value: space.people.used, color: "var(--color-accent)" },
              { label: "Free", value: peopleFree, color: COPPER_HATCH },
            ]}
          />
        </div>
        <BuildingsTable
          groups={buildingGroups}
          labour={labour}
          unrest={unrest}
          supplyByGood={supplyByGood}
          popNeedByGood={popNeedByGood}
          systemId={systemId}
          canOrder={canOrder}
          optionByType={optionByType}
          ghostsByGroup={ghostRows}
          onCancel={onCancelOrder}
          cancelPending={cancelOrder.isPending}
        />
      </Card>
    </div>
  );
}
