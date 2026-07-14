"use client";

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
import { QUALITY_BAND_TEXT, QUALITY_BAND_LABEL, GRADE } from "@/lib/constants/ui";
import { describeBuilding, TIER_LABELS } from "@/lib/constants/building-descriptions";
import { buildingHealth, familyAnchorBuff, industryHealth, perGradeStaffing, skillLicensing } from "@/lib/engine/industry";
import type { IndustryHealth, SystemIndustryReadout, SystemLabour, LabourPool, LabourAllocation, SkillBasketEntry, SubstrateSpace } from "@/lib/engine/industry";
import type { GoodTier } from "@/lib/types/game";
import { formatMagnitude, formatPeople } from "@/lib/utils/format";
import { Card } from "@/components/ui/card";
import { Badge, type BadgeColor } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { InfoIcon } from "@/components/ui/icons";
import { Tooltip, TooltipTrigger, TooltipTriggerLabel, TooltipContent } from "@/components/ui/tooltip";
import { SegmentedControl } from "@/components/form/segmented-control";
import { useIndustryView, type IndustryView } from "@/lib/hooks/use-industry-view";
import { chipStates, depositChipRows, generalLandSegments, type Chip, type DepositChipRow } from "@/components/system/industry-chips";

const THRESHOLD = INFRASTRUCTURE_DECAY_PARAMS.unrestThreshold;

/** Health → the labels/colours in one place so the badge, tally and text agree. */
const HEALTH: Record<IndustryHealth, { sys: string; badge: BadgeColor; text: string }> = {
  thriving:  { sys: "Thriving",  badge: "green", text: "text-status-green-light" },
  coasting:  { sys: "Coasting",  badge: "amber", text: "text-status-amber-light" },
  declining: { sys: "Declining", badge: "red",   text: "text-status-red-light" },
};

/** Trend glyph per health — shape-first (colourblind-safe), colour reinforces. */
const HEALTH_GLYPH: Record<IndustryHealth, string> = {
  thriving: "▲",
  coasting: "▬",
  declining: "▼",
};

// Faint light hatch = idle capacity; red hatch = skill jobs no academy can license (the licensing wall).
const IDLE_HATCH = "repeating-linear-gradient(135deg, transparent 0 4px, rgba(201,209,217,0.06) 4px 8px)";
const GAP_HATCH = "repeating-linear-gradient(135deg, rgba(240,97,109,0.45) 0 4px, transparent 4px 8px)";

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

// ── Chip grammar primitives ──────────────────────────────────────────────────

/** One 14px chip. Copper fill = working level; red = built-idle; dashed = unbuilt. `housing` recolours the fill. */
function ChipSquare({ chip, housing = false }: { chip: Chip; housing?: boolean }) {
  if (chip.kind === "unbuilt") {
    return <span className="h-3.5 w-3.5 shrink-0 border border-dashed border-accent" />;
  }
  if (chip.kind === "idle") {
    return <span className="h-3.5 w-3.5 shrink-0 border border-status-red/70 bg-status-red/25" />;
  }
  return (
    <span className="relative h-3.5 w-3.5 shrink-0 overflow-hidden border border-border-strong">
      <span
        className={`absolute inset-y-0 left-0 ${housing ? "bg-accent" : "bg-accent-muted"}`}
        style={{ width: `${Math.round(chip.fill * 100)}%` }}
      />
    </span>
  );
}

/** A wrapping chip bar — grows to fill the row, wraps gracefully on double-figure deposits. */
function ChipBar({ chips }: { chips: Chip[] }) {
  return (
    <span className="flex flex-1 flex-wrap content-start items-center gap-[3px]">
      {chips.map((c, i) => (
        <ChipSquare key={i} chip={c} />
      ))}
    </span>
  );
}

/** Shared chip-row layout: name (top-anchored) · wrapping chips · qty · out, with an optional line below. */
function ChipRow({
  name,
  chips,
  qty,
  out,
  below,
}: {
  name: React.ReactNode;
  chips: Chip[];
  qty: React.ReactNode;
  out: React.ReactNode;
  below?: React.ReactNode;
}) {
  return (
    <div className="py-[3px]">
      {/* items-start so a wrapped multi-line chip bar keeps name/qty/out anchored to the top line */}
      <div className="flex items-start gap-2.5">
        <div className="w-[92px] shrink-0 pt-px text-xs leading-tight text-text-primary">{name}</div>
        <ChipBar chips={chips} />
        <span className="w-[52px] shrink-0 pt-px text-right font-mono text-[10.5px] text-text-secondary">{qty}</span>
        <span className="w-11 shrink-0 pt-px text-right font-mono text-[11px] text-text-secondary">{out}</span>
      </div>
      {below}
    </div>
  );
}

/** Legend swatch (11px) keyed to the chip states, so the legend can't drift from the chips it documents. */
function LegendSquare({ kind, housing = false }: { kind: Chip["kind"]; housing?: boolean }) {
  if (kind === "unbuilt") return <span className="inline-block h-2.5 w-2.5 border border-dashed border-accent align-middle" />;
  if (kind === "idle") return <span className="inline-block h-2.5 w-2.5 border border-status-red/70 bg-status-red/25 align-middle" />;
  return <span className={`inline-block h-2.5 w-2.5 align-middle ${housing ? "bg-accent" : "bg-accent-muted"}`} />;
}

/** Per-pool chip legend — the four states in words, plus what a partial fill means. */
function ChipLegend({ workedLabel, partialLabel }: { workedLabel: string; partialLabel: string }) {
  return (
    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-text-secondary">
      <span className="inline-flex items-center gap-1"><LegendSquare kind="staffed" /> {workedLabel}</span>
      <span className="inline-flex items-center gap-1"><LegendSquare kind="idle" /> Built · idle</span>
      <span className="inline-flex items-center gap-1"><LegendSquare kind="unbuilt" /> {workedLabel === "Worked" ? "Unbuilt slot" : "Room to build"}</span>
      <span className="text-text-tertiary">partial = {partialLabel}</span>
    </div>
  );
}

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

/** A gold-when-rich yield tag reused by chip name + table cell. */
function YieldTag({ mult, band }: { mult: number; band: DepositChipRow["band"] }) {
  return <span className={`font-mono text-[9.5px] ${QUALITY_BAND_TEXT[band]}`}>×{mult.toFixed(2)}</span>;
}

// ── Tooltips ─────────────────────────────────────────────────────────────────

/** Deposit row tooltip: resource · yield band · working/slots · the goods extracted from it. */
function DepositTooltipBody({ row, contributors }: { row: DepositChipRow; contributors: BuildingEntry[] }) {
  return (
    <div className="space-y-1">
      <p className="font-display text-[12px] font-semibold capitalize text-text-primary">{row.resource}</p>
      <p className="font-mono text-[10px] text-text-tertiary">
        yield ×{row.yieldMult.toFixed(2)} · {QUALITY_BAND_LABEL[row.band]} · {row.worked.toFixed(1)}/{row.slotCap} worked
      </p>
      {contributors.length > 0 && (
        <div className="space-y-0.5 border-t border-border/60 pt-1.5">
          <p className="font-mono text-[9px] uppercase tracking-wider text-text-tertiary/80">extracted goods</p>
          {contributors.map((b) => (
            <div key={b.buildingType} className="flex items-center justify-between gap-3 text-[11px]">
              <span className="text-text-primary">{label(b.buildingType)}</span>
              <span className="font-mono text-text-secondary">{b.output !== undefined ? formatMagnitude(b.output) : "0"}/cyc</span>
            </div>
          ))}
        </div>
      )}
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

// ── Chipped view ─────────────────────────────────────────────────────────────

/** Supply-chain "needs" line under a production row: each input, green ✓ or red ⚠ with the throttle %. */
function NeedsLine({ supply }: { supply: SystemIndustryReadout["supplyChain"][number] }) {
  const inputs = Object.keys(GOOD_RECIPES[supply.goodId] ?? {});
  if (inputs.length === 0) return null;
  return (
    <p className="mt-1 ml-[102px] flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]">
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
  );
}

/** One deposit chip row — resource + ×yield · bounded slot chips · working/slots · out. */
function DepositRow({ row, contributors }: { row: DepositChipRow; contributors: BuildingEntry[] }) {
  return (
    <ChipRow
      name={
        <Tooltip>
          <TooltipTriggerLabel className="inline-flex items-center gap-1 capitalize">
            {row.resource} <YieldTag mult={row.yieldMult} band={row.band} />
          </TooltipTriggerLabel>
          <TooltipContent className="w-56">
            <DepositTooltipBody row={row} contributors={contributors} />
          </TooltipContent>
        </Tooltip>
      }
      chips={row.chips}
      qty={<><span className="text-text-primary">{row.worked.toFixed(1)}</span>/{row.slotCap}</>}
      out={row.output > 0 ? row.output.toFixed(1) : "—"}
    />
  );
}

/** One production/specialisation chip row — built-quantity chips (+ room chip) · staffed/built · out. */
function BuildingChipRow({
  b,
  labour,
  hasRoom,
  supply,
}: {
  b: BuildingEntry;
  labour: SystemLabour;
  hasRoom: boolean;
  supply?: SystemIndustryReadout["supplyChain"][number];
}) {
  const staffed = b.count * b.staffedFraction;
  return (
    <ChipRow
      name={
        <Tooltip>
          <TooltipTriggerLabel className="text-text-primary">{label(b.buildingType)}</TooltipTriggerLabel>
          <TooltipContent className="w-64">
            <BuildingTooltipBody b={b} labour={labour} />
          </TooltipContent>
        </Tooltip>
      }
      chips={chipStates(b.count, b.count, staffed, hasRoom)}
      qty={<><span className="text-text-primary">{formatMagnitude(staffed)}</span>/{formatMagnitude(b.count)}</>}
      out={b.output !== undefined ? formatMagnitude(b.output) : "—"}
      below={supply ? <NeedsLine supply={supply} /> : undefined}
    />
  );
}

/** The general-land housing/factory/free magnitude bar (continuous capacity — not slot-like). */
function MagBar({ space }: { space: SubstrateSpace }) {
  const segments = generalLandSegments(space);
  const seg: Record<string, string> = { housing: "bg-accent", factory: "bg-accent-muted", free: "bg-transparent" };
  return (
    <div className="flex h-3.5 overflow-hidden border border-border bg-surface-active">
      {segments.map((s) => (
        <div key={s.key} className={`${seg[s.key]} border-r-2 border-surface last:border-r-0`} style={{ width: `${s.fraction * 100}%` }} />
      ))}
    </div>
  );
}

// ── Table view ───────────────────────────────────────────────────────────────

type Align = "l" | "r";

/** A tight, right-aligned-numeric Foundry table — the precise alternative to the chips. */
function MiniTable({ head, align, rows }: { head: string[]; align: Align[]; rows: React.ReactNode[][] }) {
  return (
    <table className="w-full border-collapse">
      <thead>
        <tr>
          {head.map((h, i) => (
            <th
              key={i}
              className={`border-b border-border-strong px-1.5 py-1 font-display text-[10px] font-semibold uppercase tracking-wider text-text-tertiary ${align[i] === "r" ? "text-right" : "text-left"}`}
            >
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, ri) => (
          <tr key={ri} className="border-b border-border/40 last:border-b-0">
            {r.map((cell, ci) => (
              <td key={ci} className={`px-1.5 py-1 text-[12px] ${align[ci] === "r" ? "text-right font-mono text-text-secondary" : "text-text-primary"}`}>
                {cell}
              </td>
            ))}
          </tr>
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
          <p className="mb-1 font-display text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">Chips — one per slot / unit</p>
          <ul className="space-y-0.5 text-[11px] text-text-secondary">
            <li><LegendSquare kind="staffed" /> <span className="ml-1">built &amp; working — partial fill = fractional working / staffing</span></li>
            <li><LegendSquare kind="idle" /> <span className="ml-1">built but wholly idle — wasted, decaying capacity</span></li>
            <li><LegendSquare kind="unbuilt" /> <span className="ml-1">buildable — a free deposit slot, or room to build more</span></li>
          </ul>
        </div>
        <div>
          <p className="mb-1 font-display text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">General land bar</p>
          <p className="text-[11px] text-text-secondary">
            <span aria-hidden className="mr-1 inline-block h-2 w-3 bg-accent align-middle" /> housing &nbsp;
            <span aria-hidden className="mr-1 inline-block h-2 w-3 bg-accent-muted align-middle" /> factories &nbsp;
            <span aria-hidden className="mr-1 inline-block h-2 w-3 border border-border bg-surface-active align-middle" /> free
          </p>
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
 * population — then per-skill academy licensing (working vs licensed seats).
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
  const { view, setView } = useIndustryView();

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

  // Group by land pool. Extractors sit on deposit slots; factories/complexes on general land
  // (housing folds into the magbar; academies into the Labour card's licensing rows).
  const extractors = buildings.filter(
    (b) => b.tier === 0 && !ACADEMY_TYPES.includes(b.buildingType) && !COMPLEX_TYPES.includes(b.buildingType),
  );
  const factories = buildings.filter((b) => b.tier >= 1);
  const complexes = buildings.filter((b) => COMPLEX_TYPES.includes(b.buildingType));

  const supplyByGood = new Map(supplyChain.map((s) => [s.goodId, s]));
  const depositRows = depositChipRows(deposits, extractors);
  const contributorsFor = (resource: DepositChipRow["resource"]) =>
    extractors.filter((b) => BUILDING_TYPES[b.buildingType]?.resource === resource);

  const depositWorked = depositRows.reduce((s, r) => s + r.worked, 0);
  const depositSlots = depositRows.reduce((s, r) => s + r.slotCap, 0);
  const generalFree = Math.max(0, space.general - space.generalUsed);
  const hasRoom = generalFree > 0.01;
  const genSegments = generalLandSegments(space);

  const staffedOf = (b: BuildingEntry) => b.count * b.staffedFraction;

  return (
    <div className="space-y-4">
      {/* System health strip */}
      <Card variant="bordered" padding="sm">
        <div className="flex items-center gap-2.5">
          <Badge color={HEALTH[sysHealth].badge}>
            <HealthGlyph health={sysHealth} className="mr-1 text-xs" decorative />
            {HEALTH[sysHealth].sys}
          </Badge>
          <span className="ml-auto flex items-center gap-3 font-mono text-xs text-text-secondary">
            <span>unrest <span className="text-text-primary">{unrest.toFixed(2)}</span></span>
            <span>labour <span className="text-text-primary">{Math.round(labourFulfillment * 100)}%</span></span>
            <SegmentedControl<IndustryView>
              ariaLabel="Industry view"
              name="industryView"
              value={view}
              onChange={setView}
              options={[
                { value: "chipped", label: "Chipped" },
                { value: "table", label: "Table" },
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

      {view === "chipped" ? (
        <>
          {/* Deposit land — per-resource slot chips */}
          {depositRows.length > 0 && (
            <Card variant="bordered" padding="xs">
              <PoolHead
                title="Deposit land"
                sub="extractors · full slot count"
                right={<><span className="text-text-primary">{depositWorked.toFixed(1)}</span>/{depositSlots} worked</>}
              />
              <div className="space-y-px">
                {depositRows.map((row) => (
                  <DepositRow key={row.resource} row={row} contributors={contributorsFor(row.resource)} />
                ))}
              </div>
              <ChipLegend workedLabel="Worked" partialLabel="fractional working" />
            </Card>
          )}

          {/* General land — housing/factory/free aggregate + production chips */}
          <Card variant="bordered" padding="xs">
            <PoolHead
              title="General land"
              sub="aggregate capacity"
              right={<><span className="text-text-primary">{formatMagnitude(space.generalUsed)}</span>/{formatMagnitude(space.general)} · <span className="text-accent">{formatMagnitude(generalFree)} free</span></>}
            />
            <MagBar space={space} />
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-text-secondary">
              <span className="inline-flex items-center gap-1"><LegendSquare kind="staffed" housing /> Housing {formatMagnitude(genSegments[0].value)}</span>
              <span className="inline-flex items-center gap-1"><LegendSquare kind="staffed" /> Factories {formatMagnitude(genSegments[1].value)}</span>
              <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 border border-border bg-surface-active align-middle" /> Free {formatMagnitude(genSegments[2].value)}</span>
            </div>

            {factories.length > 0 && (
              <>
                <p className="mb-0.5 mt-3 font-display text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">Production — quantity built</p>
                <div className="space-y-px">
                  {factories.map((b) => (
                    <BuildingChipRow key={b.buildingType} b={b} labour={labour} hasRoom={hasRoom} supply={b.outputGood ? supplyByGood.get(b.outputGood) : undefined} />
                  ))}
                </div>
                <ChipLegend workedLabel="Built & staffed" partialLabel="staffing" />
              </>
            )}

            {complexes.length > 0 && (
              <>
                <p className="mb-0.5 mt-3 font-display text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">Specialisation</p>
                <div className="space-y-px">
                  {complexes.map((b) => (
                    <BuildingChipRow key={b.buildingType} b={b} labour={labour} hasRoom={hasRoom} />
                  ))}
                </div>
              </>
            )}
          </Card>
        </>
      ) : (
        <>
          {/* Table view — the precise alternative */}
          {depositRows.length > 0 && (
            <Card variant="bordered" padding="xs">
              <PoolHead title="Deposit land" right={<><span className="text-text-primary">{depositWorked.toFixed(1)}</span>/{depositSlots} slots worked</>} />
              <MiniTable
                head={["Deposit", "Worked", "Yield", "Out/cyc"]}
                align={["l", "r", "r", "r"]}
                rows={depositRows.map((row) => [
                  <span key="n" className="capitalize">{row.resource}</span>,
                  <span key="w" className={row.worked / row.slotCap < 0.5 ? "text-status-amber-light" : undefined}>
                    <span className="text-text-primary">{row.worked.toFixed(1)}</span>/{row.slotCap}
                  </span>,
                  <YieldTag key="y" mult={row.yieldMult} band={row.band} />,
                  <span key="o" className="text-text-primary">{row.output > 0 ? row.output.toFixed(1) : "—"}</span>,
                ])}
              />
            </Card>
          )}

          <Card variant="bordered" padding="xs">
            <PoolHead title="General land" right={<><span className="text-text-primary">{formatMagnitude(space.generalUsed)}</span>/{formatMagnitude(space.general)} used</>} />
            <MiniTable
              head={["Use", "Units", "Share"]}
              align={["l", "r", "r"]}
              rows={genSegments.map((s) => [
                <span key="u" className="capitalize">{s.key === "free" ? "Free" : s.key === "factory" ? "Factories" : "Housing"}</span>,
                <span key="n" className="text-text-primary">{formatMagnitude(s.value)}</span>,
                `${Math.round(s.fraction * 100)}%`,
              ])}
            />
          </Card>

          {(factories.length > 0 || complexes.length > 0) && (
            <Card variant="bordered" padding="xs">
              <PoolHead title="Production" right={hasRoom ? <span className="text-accent">room to build</span> : `${factories.length + complexes.length} built`} />
              <MiniTable
                head={["Building", "Staffed", "Out/cyc"]}
                align={["l", "r", "r"]}
                rows={[...factories, ...complexes].map((b) => [
                  label(b.buildingType),
                  <span key="s"><span className="text-text-primary">{formatMagnitude(staffedOf(b))}</span>/{formatMagnitude(b.count)}</span>,
                  <span key="o" className="text-text-primary">{b.output !== undefined ? formatMagnitude(b.output) : "—"}</span>,
                ])}
              />
            </Card>
          )}
        </>
      )}
    </div>
  );
}
