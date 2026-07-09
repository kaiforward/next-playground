"use client";

import type { CSSProperties } from "react";
import { useSystemIndustry } from "@/lib/hooks/use-system-industry";
import { GOODS } from "@/lib/constants/goods";
import {
  BUILDING_TYPES,
  HOUSING_TYPE,
  ACADEMY_TYPES,
  VOCATIONAL_SCHOOL_TYPE,
  RESEARCH_INSTITUTE_TYPE,
  COMPLEX_TYPES,
  COMPLEX_BY_TYPE,
} from "@/lib/constants/industry";
import { GOOD_RECIPES } from "@/lib/constants/recipes";
import { INFRASTRUCTURE_DECAY_PARAMS } from "@/lib/constants/infrastructure";
import { QUALITY_BAND_TEXT } from "@/lib/constants/ui";
import { describeBuilding, TIER_LABELS } from "@/lib/constants/building-descriptions";
import { buildingHealth, familyAnchorBuff, industryHealth, perGradeStaffing, skillLicensing } from "@/lib/engine/industry";
import type { IndustryHealth, IdleReason, SystemIndustryReadout, SystemLabour, LabourPool, LabourAllocation, SkillBasketEntry } from "@/lib/engine/industry";
import type { GoodTier, QualityBandId } from "@/lib/types/game";
import { formatMagnitude, formatPeople } from "@/lib/utils/format";
import { Card } from "@/components/ui/card";
import { Badge, type BadgeColor } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { InfoIcon } from "@/components/ui/icons";
import { Tooltip, TooltipTrigger, TooltipTriggerLabel, TooltipContent } from "@/components/ui/tooltip";
import { SegmentedControl } from "@/components/form/segmented-control";
import { useIndustryDensity, type IndustryDensity } from "@/lib/hooks/use-industry-density";

const THRESHOLD = INFRASTRUCTURE_DECAY_PARAMS.unrestThreshold;

/** Health → the labels/colours one place so the badge, dots, bars and tally agree. */
const HEALTH: Record<IndustryHealth, { sys: string; row: string; badge: BadgeColor; dot: string; fill: string; text: string }> = {
  thriving:  { sys: "Thriving",  row: "stable",     badge: "green", dot: "bg-status-green", fill: "bg-status-green", text: "text-status-green-light" },
  coasting:  { sys: "Coasting",  row: "idle",       badge: "amber", dot: "bg-status-amber", fill: "bg-status-amber", text: "text-status-amber-light" },
  declining: { sys: "Declining", row: "collapsing", badge: "red",   dot: "bg-status-red",   fill: "bg-status-red",   text: "text-status-red-light" },
};

const IDLE_CAUSE: Record<IdleReason, string> = {
  occupancy: "low occupancy",
  labour: "labour short",
  skill1: "needs vocational school",
  skill2: "needs research institute",
  selling: "output not selling",
};

/** Trend glyph per health — shape-first (colourblind-safe), colour reinforces. */
const HEALTH_GLYPH: Record<IndustryHealth, string> = {
  thriving: "▲",
  coasting: "▬",
  declining: "▼",
};

/**
 * The one at-a-glance state signal: a trend glyph coloured by health. Carries the health
 * word as its accessible name, unless `decorative` — set that where the word is already
 * adjacent visible text (e.g. the system Badge) so screen readers don't announce it twice.
 */
function HealthGlyph({ health, className = "", decorative = false }: { health: IndustryHealth; className?: string; decorative?: boolean }) {
  return (
    <span
      aria-label={decorative ? undefined : HEALTH[health].sys}
      aria-hidden={decorative || undefined}
      title={HEALTH[health].sys}
      className={`font-mono leading-none ${HEALTH[health].text} ${className}`}
    >
      {HEALTH_GLYPH[health]}
    </span>
  );
}

/** Labour-grade hues + names — distinct from health and from land (copper). Redundant U/T/E label at call sites. */
const GRADE = {
  unskilled: { bar: "bg-status-blue", text: "text-status-blue-light", tag: "U", name: "Unskilled" },
  skill1: { bar: "bg-status-cyan", text: "text-status-cyan-light", tag: "T", name: "Technicians" },
  skill2: { bar: "bg-status-purple", text: "text-status-purple-light", tag: "E", name: "Engineers" },
} as const;

// Faded-copper hatch = "housing can still grow here"; faint light hatch = idle capacity.
const COPPER_HATCH = "repeating-linear-gradient(135deg, rgba(208,106,66,0.45) 0 2px, transparent 2px 6px)";
const IDLE_HATCH = "repeating-linear-gradient(135deg, transparent 0 4px, rgba(201,209,217,0.06) 4px 8px)";
// Red hatch = skill jobs no academy can license (the licensing wall) — distinct from faint idle-seat hatch.
const GAP_HATCH = "repeating-linear-gradient(135deg, rgba(240,97,109,0.45) 0 4px, transparent 4px 8px)";

type BuildingEntry = SystemIndustryReadout["buildings"][number];

/** Narrow a readout building's tier (GoodTier | -1, housing = -1) to a GoodTier for the producer-only staffing helpers. */
function producerTier(b: BuildingEntry): GoodTier {
  return b.tier === 1 ? 1 : b.tier === 2 ? 2 : 0;
}

/** Academy building types don't produce a good, so they're not in GOODS — name them explicitly. */
const ACADEMY_LABELS: Record<string, string> = {
  [VOCATIONAL_SCHOOL_TYPE]: "Vocational School",
  [RESEARCH_INSTITUTE_TYPE]: "Research Institute",
};

/** Complex building types aren't in GOODS either — name them from the family catalog. */
const COMPLEX_LABELS: Record<string, string> = Object.fromEntries(
  COMPLEX_TYPES.map((t) => [t, COMPLEX_BY_TYPE[t].label]),
);

/** Human-readable label for a building type or good id. */
function label(id: string): string {
  if (id === HOUSING_TYPE) return "Housing";
  return ACADEMY_LABELS[id] ?? COMPLEX_LABELS[id] ?? GOODS[id]?.name ?? id;
}

function pct(value: number, total: number): number {
  return total > 0 ? (value / total) * 100 : 0;
}

/** A stacked land bar — structural slices (who holds the ground) + free tail. */
function LandBar({ segments }: { segments: Array<{ key: string; width: number; className?: string; style?: CSSProperties }> }) {
  return (
    <div className="flex h-3.5 overflow-hidden border border-border bg-surface-active">
      {segments.map((s) => (
        <div key={s.key} className={s.className} style={{ width: `${s.width}%`, ...s.style }} />
      ))}
    </div>
  );
}

/** Trailing numeric cluster widths — shared by the header and every row so they align as a table. */
const COL = { staff: "w-10", used: "w-16", out: "w-14" };

/** Column header labelling the trailing numbers so the block reads like a table. */
function RowHeader({ showOutput }: { showOutput: boolean }) {
  return (
    <div className="flex items-center gap-2.5 px-3 pb-1 pt-2 font-mono text-[9px] uppercase tracking-wider text-text-tertiary/70">
      <span className="w-3 shrink-0" aria-hidden />
      <span className="w-40 shrink-0" aria-hidden />
      <span className="flex-1" aria-hidden />
      <span className={`${COL.staff} text-right`}>staff</span>
      <span className={`${COL.used} text-right`}>used/built</span>
      {showOutput && <span className={`${COL.out} text-right`}>out/cyc</span>}
    </div>
  );
}

/** Rich per-building tooltip: header · description · per-grade filled/needed · footer. Producers get the grade split; housing/academies a lighter body. */
function BuildingTooltipBody({ b, labour }: { b: BuildingEntry; labour: SystemLabour }) {
  const isAcademy = ACADEMY_TYPES.includes(b.buildingType);
  const isComplex = COMPLEX_TYPES.includes(b.buildingType);
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
  // The buff depends only on this complex's own count (linear below one full complex), so a
  // single-entry record reads the same strength the production engine applies.
  const familyBuff = complexFamily ? familyAnchorBuff({ [b.buildingType]: b.count }, complexFamily.goods[0] ?? "") : 1;

  return (
    <div className="space-y-1.5">
      <p className="font-display text-[12px] font-semibold text-text-primary">{label(b.buildingType)}</p>
      {(tierLabel || b.count > 0) && (
        <p className="font-mono text-[10px] text-text-tertiary">
          {tierLabel && !isAcademy && !isComplex ? `tier ${b.tier} · ${tierLabel} · ` : ""}×{formatMagnitude(b.count)} built
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
          Output <span className="font-mono text-text-secondary">{b.output !== undefined ? formatMagnitude(b.output) : "0"}</span>/cyc — staffing{" "}
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

/** One building line: glyph · name (+yield) · staffing bar · staff% · used/built · output/cyc, with cause/needs lines. */
function ProductionRow({
  b,
  unrest,
  labour,
  yieldMult,
  yieldBand,
  supply,
  density = "compact",
  showOutput = false,
}: {
  b: BuildingEntry;
  unrest: number;
  labour: SystemLabour;
  yieldMult?: number;
  yieldBand?: QualityBandId;
  supply?: SystemIndustryReadout["supplyChain"][number];
  density?: IndustryDensity;
  showOutput?: boolean;
}) {
  const health = buildingHealth({ used: b.used, built: b.count, unrest, unrestDecayThreshold: THRESHOLD });
  const meta = HEALTH[health];
  const staffPct = Math.max(0, Math.min(100, b.staffedFraction * 100));
  const usedDisplay = formatMagnitude(b.staffedFraction * b.count);
  const isAcademy = ACADEMY_TYPES.includes(b.buildingType);

  // Cause line — only for rows that aren't stable. Priority: over-capacity, unrest, then the idle constraint.
  let cause: string | undefined;
  if (health !== "thriving") {
    if (b.used > b.count) cause = "over capacity";
    else if (unrest >= THRESHOLD) cause = "high unrest";
    else if (b.idleReason) cause = IDLE_CAUSE[b.idleReason];
  }

  const inputs = supply ? Object.keys(GOOD_RECIPES[supply.goodId] ?? {}) : [];

  // Detailed density swaps the single health bar for per-grade micro-bars. Only producers/
  // extractors reach the grade split (housing/academies/complexes are excluded by the guard),
  // so producerTier narrows the readout's tier sentinel to a real GoodTier here.
  const goodTier = producerTier(b);
  const grades =
    density === "detailed" && !isAcademy && !COMPLEX_TYPES.includes(b.buildingType) && b.tier >= 0
      ? perGradeStaffing(BUILDING_TYPES[b.buildingType]?.labour ?? { unskilled: 0, skill1: 0, skill2: 0 }, b.count, goodTier, {
          labourFulfil: labour.workforce.fulfil,
          skill1Fulfil: labour.skill1.fulfil,
          skill2Fulfil: labour.skill2.fulfil,
        })
      : null;

  return (
    <div className="border-b border-border/40 px-3 py-1.5 last:border-b-0">
      <div className="flex items-center gap-2.5">
        <HealthGlyph health={health} className="w-3 shrink-0 text-center text-[10px]" />
        <Tooltip>
          <TooltipTriggerLabel className="flex w-40 shrink-0 items-center gap-1.5 text-sm text-text-primary">
            {label(b.buildingType)}
            {yieldMult !== undefined && (
              <span className={`font-mono text-[10px] ${yieldBand ? QUALITY_BAND_TEXT[yieldBand] : "text-text-tertiary"}`}>
                ×{yieldMult.toFixed(2)}
              </span>
            )}
          </TooltipTriggerLabel>
          <TooltipContent className="w-64">
            <BuildingTooltipBody b={b} labour={labour} />
          </TooltipContent>
        </Tooltip>

        {grades ? (
          <div className="flex flex-1 flex-col gap-0.5">
            {grades.map((g) => (
              <div key={g.grade} className="flex items-center gap-1.5">
                <span aria-hidden className={`w-3 font-mono text-[9px] ${GRADE[g.grade].text}`}>{GRADE[g.grade].tag}</span>
                <div
                  role="progressbar"
                  aria-valuenow={Math.round(g.fulfil * 100)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`${GRADE[g.grade].name}: ${Math.round(g.fulfil * 100)}% staffed`}
                  className="relative h-2 flex-1 overflow-hidden border border-border bg-surface-active"
                >
                  <div className={`absolute inset-y-0 left-0 ${GRADE[g.grade].bar}`} style={{ width: `${Math.max(0, Math.min(100, g.fulfil * 100))}%` }} />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div
            role="progressbar"
            aria-valuenow={Math.round(staffPct)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`${label(b.buildingType)}: ${Math.round(staffPct)}% staffed`}
            className="relative h-3.5 flex-1 overflow-hidden border border-border bg-surface-active"
            style={{ backgroundImage: IDLE_HATCH }}
          >
            <div className={`absolute inset-y-0 left-0 ${meta.fill}`} style={{ width: `${staffPct}%` }} />
          </div>
        )}

        <span className={`${COL.staff} text-right font-mono text-xs ${meta.text}`}>{Math.round(staffPct)}%</span>
        <span className={`${COL.used} text-right font-mono text-[11px] text-text-secondary`}>
          <span className="text-text-primary">{usedDisplay}</span>/{formatMagnitude(b.count)}
        </span>
        {showOutput && (
          <span className={`${COL.out} text-right font-mono text-[11px] text-text-secondary`}>
            {b.output !== undefined ? formatMagnitude(b.output) : "—"}
          </span>
        )}
      </div>

      {cause && (
        <p className="mt-1 ml-[26px] text-[11px] text-text-tertiary">
          <span className="font-mono uppercase tracking-wide text-text-tertiary/80">cause</span> {cause}
        </p>
      )}
      {supply && inputs.length > 0 && (
        <p className="mt-1 ml-[26px] flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
          <span className="font-mono uppercase tracking-wide text-text-tertiary/80">needs</span>
          {inputs.map((input) => {
            const short = supply.throttledBy.includes(input);
            return (
              <span key={input} className={`font-mono ${short ? "text-status-red-light" : "text-status-green-light"}`}>
                {short ? "⚠" : "✓"} {label(input)}{short ? ` ${Math.round(supply.inputGate * 100)}%` : ""}
              </span>
            );
          })}
        </p>
      )}
    </div>
  );
}

/** Pool header: title · sub · used / total · free. */
function PoolHeader({ title, sub, used, total }: { title: string; sub: string; used: number; total: number }) {
  return (
    <div className="mb-1.5 flex items-baseline gap-2">
      <span className="font-display text-[11px] font-semibold uppercase tracking-wider text-text-primary">{title}</span>
      <span className="font-mono text-[10px] text-text-tertiary">{sub}</span>
      <span className="ml-auto font-mono text-[11px] text-text-secondary">
        <span className="text-text-primary">{formatMagnitude(used)}</span> / {formatMagnitude(total)} used ·{" "}
        <span className="text-accent">{formatMagnitude(Math.max(0, total - used))} free</span>
      </span>
    </div>
  );
}

function RoleLabel({ children }: { children: string }) {
  return <p className="px-3 pb-0.5 pt-2 font-display text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">{children}</p>;
}

/** A labelled group of simple building rows (no output column) — housing, academies, complexes. */
function BuildingGroup({
  title,
  buildings,
  unrest,
  labour,
  density,
}: {
  title: string;
  buildings: BuildingEntry[];
  unrest: number;
  labour: SystemLabour;
  density: IndustryDensity;
}) {
  if (buildings.length === 0) return null;
  return (
    <>
      <RoleLabel>{title}</RoleLabel>
      <div>
        {buildings.map((b) => <ProductionRow key={b.buildingType} b={b} unrest={unrest} labour={labour} density={density} />)}
      </div>
    </>
  );
}

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
          <p className="mb-1 font-display text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">Health — the glyph</p>
          <ul className="space-y-0.5 text-[11px] text-text-secondary">
            <li><span aria-hidden className="mr-1.5 font-mono text-status-green-light">▲</span> thriving — in use, holding</li>
            <li><span aria-hidden className="mr-1.5 font-mono text-status-amber-light">▬</span> coasting — slack past the deadband, slowly shrinking</li>
            <li><span aria-hidden className="mr-1.5 font-mono text-status-red-light">▼</span> declining — unrest teardown, over-capacity, or can't sell</li>
          </ul>
        </div>
        <div>
          <p className="mb-1 font-display text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">Staffing bar</p>
          <p className="text-[11px] text-text-secondary">Length = how staffed (the % beside it); hue = health. <span className="font-mono">used/built</span> is the staffed operating count; <span className="font-mono">out/cyc</span> is real output after input gates.</p>
        </div>
        <div>
          <p className="mb-1 font-display text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">Labour grades</p>
          <p className="text-[11px] text-text-secondary">
            <span aria-hidden className="mr-1 inline-block h-2 w-2 bg-status-blue align-middle" />U unskilled &nbsp;
            <span aria-hidden className="mr-1 inline-block h-2 w-2 bg-status-cyan align-middle" />T technician &nbsp;
            <span aria-hidden className="mr-1 inline-block h-2 w-2 bg-status-purple align-middle" />E engineer
          </p>
        </div>
        <div>
          <p className="mb-1 font-display text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">Land bar</p>
          <ul className="space-y-0.5 text-[11px] text-text-secondary">
            <li><span aria-hidden className="mr-1.5 inline-block h-2 w-3 bg-accent align-middle" /> housing &nbsp;<span aria-hidden className="mr-1.5 inline-block h-2 w-3 bg-accent-muted align-middle" /> factories</li>
            <li><span aria-hidden className="mr-1.5 inline-block h-2 w-3 border border-border align-middle" style={{ backgroundImage: COPPER_HATCH }} /> housing can still grow here</li>
            <li><span aria-hidden className="mr-1.5 inline-block h-2 w-3 border border-border bg-surface-active align-middle" /> factories only (beyond habitable)</li>
          </ul>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * One skilled grade's licensing row: tag · name · a bar whose full width is max(licensed, jobs) —
 * the filled part is `working = min(licensed, jobs)`, the tail is faint idle seats (over-provisioned)
 * or a red unlicensed-jobs gap (the academy is the wall). Numbers read working / licensed, or
 * working / jobs when the academy is short. Mirrors the per-building "needs …" caption.
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
            {/* Fixed decimals, not formatMagnitude — per-head rates sit below its 0.1 cutoff at
                ECONOMY_SCALE=1, which would collapse every row to "<0.1". */}
            <span className="font-mono text-[10px] text-text-secondary">{entry.perHead.toFixed(3)}/cyc</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * System-wide labour: the population decomposed into what it is actually doing — disjoint
 * role buckets (unskilled / technicians / engineers) + unemployed, one bar summing to the
 * population — then per-skill academy licensing (working vs licensed seats). The old three
 * overlapping supply/demand bars double-counted skilled heads inside a grand "workforce" total
 * and pinned skill rows at 100% (hiding idle licensing); this reads honestly instead.
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
    <Card variant="bordered" padding="md">
      <div className="mb-2 flex items-baseline gap-2">
        <p className="font-display text-[11px] font-semibold uppercase tracking-wider text-text-primary">Labour</p>
        <span className="ml-auto font-mono text-[10px] text-text-tertiary">
          <span className="text-text-secondary">{formatPeople(pop)}</span> pop · {formatPeople(jobs)} jobs ·{" "}
          <span className="text-accent">{formatPeople(allocation.unemployed)} unemployed</span>
        </span>
      </div>

      {/* Population decomposition — one bar, disjoint buckets, sums to population. */}
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
          // Chip layout classes sit on the trigger itself: an underline on a
          // wrapper never paints inside an atomic inline-flex child, and the
          // inline-block swatch is skipped so only the text gets the dots.
          const chip = (
            <>
              <span aria-hidden className={`inline-block h-2 w-2 ${w.bar}`} />
              <span>
                {w.label} <span className="text-text-primary">{formatPeople(w.value)}</span>
              </span>
            </>
          );
          if (!w.basket) {
            return (
              <span key={w.key} className="inline-flex items-center gap-1.5">{chip}</span>
            );
          }
          return (
            <Tooltip key={w.key}>
              <TooltipTriggerLabel className="inline-flex items-center gap-1.5">{chip}</TooltipTriggerLabel>
              <TooltipContent className="w-56">
                <BasketTooltipBody grade={w.key} basket={w.basket} />
              </TooltipContent>
            </Tooltip>
          );
        })}
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="inline-block h-2 w-2 border border-border" style={{ backgroundImage: IDLE_HATCH }} />
          Unemployed <span className="text-text-primary">{formatPeople(allocation.unemployed)}</span>
        </span>
      </div>

      {/* Skill licensing — only when the system draws on (or has licensed) skilled labour. */}
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
  const { density, setDensity } = useIndustryDensity();

  if (data.visibility === "unknown") {
    return <EmptyState message="This system isn't developed yet — no industry to survey." />;
  }

  const { space, deposits, labour, labourAllocation, labourFulfillment, buildings, supplyChain, unrest, skillBaskets } = data;

  if (buildings.length === 0) {
    return <EmptyState message="Undeveloped — no industry established. Charted deposits await development." />;
  }

  // System health from the per-building used totals (the idle gap the decay loop runs on).
  const totalBuilt = buildings.reduce((s, b) => s + b.count, 0);
  const totalUsed = buildings.reduce((s, b) => s + b.used, 0);
  const idleFraction = totalBuilt > 0 ? Math.max(0, (totalBuilt - totalUsed) / totalBuilt) : 0;
  const sysHealth = industryHealth({ labourFulfillment, unrest, idleFraction, unrestDecayThreshold: THRESHOLD });

  // Per-building health for the tally (rows recompute it themselves — cheap, keeps them self-contained).
  const tally: Record<IndustryHealth, number> = { thriving: 0, coasting: 0, declining: 0 };
  for (const b of buildings) {
    tally[buildingHealth({ used: b.used, built: b.count, unrest, unrestDecayThreshold: THRESHOLD })]++;
  }

  // Group by land pool: deposit (tier-0 extractors, excluding academies and complexes —
  // they're tier 0 by data-model default but bill to general space, not a deposit slot)
  // vs general (housing tier -1 + factories tier 1+ + academies + complexes).
  const extractors = buildings.filter(
    (b) => b.tier === 0 && !ACADEMY_TYPES.includes(b.buildingType) && !COMPLEX_TYPES.includes(b.buildingType),
  );
  const housing = buildings.filter((b) => b.tier === -1);
  const factories = buildings.filter((b) => b.tier >= 1);
  const academies = buildings.filter((b) => ACADEMY_TYPES.includes(b.buildingType));
  const complexes = buildings.filter((b) => COMPLEX_TYPES.includes(b.buildingType));

  const depositByResource = new Map(deposits.map((d) => [d.resource, d]));
  const supplyByGood = new Map(supplyChain.map((s) => [s.goodId, s]));

  // General-pool slices: housing footprint, factory footprint, then free split by the habitable cap.
  const generalFree = Math.max(0, space.general - space.generalUsed);
  const factoryFootprint = Math.max(0, space.generalUsed - space.habitableUsed);
  const habitableHeadroom = Math.max(0, space.habitable - space.habitableUsed);
  const habFree = Math.min(generalFree, habitableHeadroom);
  const factoryOnlyFree = Math.max(0, generalFree - habFree);

  const yieldFor = (b: BuildingEntry) => {
    const resource = BUILDING_TYPES[b.buildingType]?.resource;
    return resource ? depositByResource.get(resource) : undefined;
  };

  return (
    <div className="space-y-4">
      {/* System health strip */}
      <Card variant="bordered" padding="md">
        <div className="flex items-center gap-2.5">
          <Badge color={HEALTH[sysHealth].badge}>
            <HealthGlyph health={sysHealth} className="mr-1 text-xs" decorative />
            {HEALTH[sysHealth].sys}
          </Badge>
          <span className="ml-auto flex items-center gap-3.5 font-mono text-xs text-text-secondary">
            <span>unrest <span className="text-text-primary">{unrest.toFixed(2)}</span></span>
            <span>labour <span className="text-text-primary">{Math.round(labourFulfillment * 100)}%</span></span>
            <SegmentedControl<IndustryDensity>
              ariaLabel="Row density"
              name="industryDensity"
              value={density}
              onChange={setDensity}
              options={[
                { value: "compact", label: "Compact" },
                { value: "detailed", label: "Detailed" },
              ]}
            />
            <LegendTooltip />
          </span>
        </div>
        <p className="mt-1.5 flex gap-3 font-mono text-[11px]">
          <span className="text-status-green-light">{tally.thriving} stable</span>
          <span className="text-status-amber-light">{tally.coasting} idle</span>
          <span className="text-status-red-light">{tally.declining} collapsing</span>
        </p>
      </Card>

      <LabourCard labour={labour} allocation={labourAllocation} skillBaskets={skillBaskets} />

      {/* Deposit land — extractors */}
      {extractors.length > 0 && (
        <Card variant="bordered" padding="md">
          <PoolHeader title="Deposit land" sub="extractors" used={space.depositWorked} total={space.deposit} />
          <LandBar
            segments={[
              { key: "worked", width: pct(space.depositWorked, space.deposit), className: "bg-accent-muted" },
            ]}
          />
          <RowHeader showOutput />
          <div className="mt-2.5">
            {extractors.map((b) => {
              const dep = yieldFor(b);
              return <ProductionRow key={b.buildingType} b={b} unrest={unrest} labour={labour} yieldMult={dep?.yieldMult} yieldBand={dep?.band} density={density} showOutput />;
            })}
          </div>
        </Card>
      )}

      {/* General land — housing + factories share the pool */}
      <Card variant="bordered" padding="md">
        <PoolHeader title="General land" sub="housing + factories + academies + complexes" used={space.generalUsed} total={space.general} />
        <LandBar
          segments={[
            { key: "housing", width: pct(space.habitableUsed, space.general), className: "bg-accent" },
            { key: "factory", width: pct(factoryFootprint, space.general), className: "bg-accent-muted" },
            { key: "habfree", width: pct(habFree, space.general), className: "border-l border-background", style: { backgroundImage: COPPER_HATCH } },
            { key: "facfree", width: pct(factoryOnlyFree, space.general), className: "border-l border-background" },
          ]}
        />

        <BuildingGroup title="Housing" buildings={housing} unrest={unrest} labour={labour} density={density} />
        <BuildingGroup title="Academies" buildings={academies} unrest={unrest} labour={labour} density={density} />
        <BuildingGroup title="Specialisation" buildings={complexes} unrest={unrest} labour={labour} density={density} />
        {factories.length > 0 && (
          <>
            <RoleLabel>Production</RoleLabel>
            <RowHeader showOutput />
            <div>
              {factories.map((b) => (
                <ProductionRow key={b.buildingType} b={b} unrest={unrest} labour={labour} density={density} showOutput supply={b.outputGood ? supplyByGood.get(b.outputGood) : undefined} />
              ))}
            </div>
          </>
        )}
      </Card>

    </div>
  );
}
