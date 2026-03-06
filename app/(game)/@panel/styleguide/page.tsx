"use client";

import { DetailPanel } from "@/components/ui/detail-panel";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ProgressBar } from "@/components/ui/progress-bar";
import { SectionHeader } from "@/components/ui/section-header";
import { StatList, StatRow } from "@/components/ui/stat-row";
import { StatDisplay } from "@/components/ui/stat-display";
import { TabList, Tab } from "@/components/ui/tabs";
import { EmptyState } from "@/components/ui/empty-state";
import { InlineAlert } from "@/components/ui/inline-alert";
import { useState } from "react";

function StyleSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-display font-bold text-text-accent uppercase tracking-wider border-b border-border pb-2">
        {title}
      </h3>
      {children}
    </div>
  );
}

function Swatch({ label, className }: { label: string; className: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className={`w-10 h-10 border border-border ${className}`} />
      <div>
        <p className="text-xs font-mono text-text-primary">{label}</p>
      </div>
    </div>
  );
}

// ── Colors ──────────────────────────────────────────────────────

function ColorsSection() {
  return (
    <StyleSection title="Colors — Foundry Palette">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="space-y-3">
          <p className="text-xs font-display text-text-secondary uppercase tracking-wider">Surfaces</p>
          <Swatch label="background" className="bg-background" />
          <Swatch label="surface" className="bg-surface" />
          <Swatch label="surface-hover" className="bg-surface-hover" />
          <Swatch label="surface-active" className="bg-surface-active" />
        </div>
        <div className="space-y-3">
          <p className="text-xs font-display text-text-secondary uppercase tracking-wider">Text</p>
          <div className="space-y-1">
            <p className="text-sm text-text-primary">text-primary</p>
            <p className="text-sm text-text-secondary">text-secondary</p>
            <p className="text-sm text-text-tertiary">text-tertiary</p>
            <p className="text-sm text-text-accent">text-accent</p>
          </div>
        </div>
        <div className="space-y-3">
          <p className="text-xs font-display text-text-secondary uppercase tracking-wider">Accent</p>
          <Swatch label="accent" className="bg-accent" />
          <Swatch label="accent-muted" className="bg-accent-muted" />
          <Swatch label="secondary" className="bg-secondary" />
        </div>
        <div className="space-y-3">
          <p className="text-xs font-display text-text-secondary uppercase tracking-wider">Borders</p>
          <Swatch label="border" className="bg-transparent border-2 !border-border" />
          <Swatch label="border-strong" className="bg-transparent border-2 !border-border-strong" />
        </div>
      </div>
    </StyleSection>
  );
}

// ── Typography ──────────────────────────────────────────────────

function TypographySection() {
  return (
    <StyleSection title="Typography">
      <div className="space-y-4">
        <div>
          <p className="text-[10px] text-text-secondary uppercase tracking-wider mb-1">font-display (Chakra Petch) — headings, titles</p>
          <p className="text-2xl font-display font-bold text-text-primary">The Foundry Burns Bright</p>
          <p className="text-lg font-display font-semibold text-text-primary">Section Title</p>
          <p className="text-xs font-display font-semibold uppercase tracking-wider text-text-secondary">SECTION HEADER</p>
        </div>
        <div>
          <p className="text-[10px] text-text-secondary uppercase tracking-wider mb-1">font-sans (Geist) — body text</p>
          <p className="text-sm text-text-primary">Body text uses Geist for clean readability across all regular content.</p>
          <p className="text-xs text-text-secondary">Supporting text at smaller sizes for descriptions and labels.</p>
        </div>
        <div>
          <p className="text-[10px] text-text-secondary uppercase tracking-wider mb-1">font-mono (Geist Mono) — numeric values</p>
          <p className="text-sm font-mono text-text-primary">1,250,000 cr · Tick 4,821 · 12.5% · (2048, 3072)</p>
        </div>
      </div>
    </StyleSection>
  );
}

// ── Cards ────────────────────────────────────────────────────────

function CardsSection() {
  return (
    <StyleSection title="Card">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader title="Default Card" subtitle="Copper left stripe, no border" />
          <CardContent>
            <p className="text-sm text-text-secondary">Used for standalone content blocks.</p>
          </CardContent>
        </Card>
        <Card variant="bordered">
          <CardHeader title="Bordered Card" subtitle="Full border + copper stripe" />
          <CardContent>
            <p className="text-sm text-text-secondary">Used for cards with rich internal content.</p>
          </CardContent>
        </Card>
        <Card padding="sm">
          <CardHeader title="Small Padding" />
          <CardContent>
            <p className="text-xs text-text-secondary">padding=&quot;sm&quot; (p-3)</p>
          </CardContent>
        </Card>
        <Card variant="bordered" padding="sm">
          <CardHeader title="Bordered + Header Action" action={<Badge color="green">Active</Badge>} />
          <CardContent>
            <p className="text-xs text-text-secondary">CardHeader with action slot.</p>
          </CardContent>
        </Card>
      </div>

      <p className="text-xs text-text-secondary mt-4">List item style (inline accent stripe):</p>
      <ul className="space-y-2">
        <li className="flex items-center justify-between py-3 px-3 bg-surface-hover/40 border-l-2 border-l-accent hover:bg-surface-hover transition-colors">
          <span className="text-sm text-text-primary">List item with accent stripe</span>
          <span className="text-xs text-text-secondary">metadata</span>
        </li>
        <li className="flex items-center justify-between py-3 px-3 bg-surface-hover/40 border-l-2 border-l-accent hover:bg-surface-hover transition-colors">
          <span className="text-sm text-text-primary">Another list item</span>
          <Badge color="amber">Status</Badge>
        </li>
      </ul>
    </StyleSection>
  );
}

// ── Buttons ──────────────────────────────────────────────────────

function ButtonsSection() {
  return (
    <StyleSection title="Button">
      <div className="space-y-4">
        <div>
          <p className="text-[10px] text-text-secondary uppercase tracking-wider mb-2">Variants</p>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary" size="md">Primary</Button>
            <Button variant="action" color="green" size="md">Action Green</Button>
            <Button variant="action" color="red" size="md">Action Red</Button>
            <Button variant="action" color="accent" size="md">Action Accent</Button>
            <Button variant="outline" size="md">Outline</Button>
            <Button variant="ghost" size="md">Ghost</Button>
            <Button variant="pill" color="cyan" size="sm">Pill Cyan</Button>
            <Button variant="pill" color="accent" size="sm">Pill Accent</Button>
            <Button variant="dismiss" size="sm">Dismiss</Button>
          </div>
        </div>
        <div>
          <p className="text-[10px] text-text-secondary uppercase tracking-wider mb-2">Sizes</p>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary" size="xs">XS</Button>
            <Button variant="primary" size="sm">SM</Button>
            <Button variant="primary" size="md">MD</Button>
            <Button variant="primary" size="lg">LG</Button>
          </div>
        </div>
        <div>
          <p className="text-[10px] text-text-secondary uppercase tracking-wider mb-2">Disabled</p>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary" size="md" disabled>Primary</Button>
            <Button variant="action" color="green" size="md" disabled>Action</Button>
            <Button variant="ghost" size="md" disabled>Ghost</Button>
          </div>
        </div>
        <div>
          <p className="text-[10px] text-text-secondary uppercase tracking-wider mb-2">Common patterns</p>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="ghost" size="xs">Details &rarr;</Button>
            <Button variant="action" color="green" size="sm">Trade</Button>
            <Button variant="action" color="accent" size="sm">Navigate</Button>
            <Button variant="action" color="red" size="sm">Abandon</Button>
          </div>
        </div>
      </div>
    </StyleSection>
  );
}

// ── Badges ───────────────────────────────────────────────────────

function BadgesSection() {
  return (
    <StyleSection title="Badge">
      <div className="flex flex-wrap items-center gap-3">
        <Badge color="green">Green</Badge>
        <Badge color="amber">Amber</Badge>
        <Badge color="blue">Blue</Badge>
        <Badge color="purple">Purple</Badge>
        <Badge color="slate">Slate</Badge>
        <Badge color="red">Red</Badge>
        <Badge color="cyan">Cyan</Badge>
      </div>
      <div className="mt-3">
        <p className="text-[10px] text-text-secondary uppercase tracking-wider mb-2">Common usage</p>
        <div className="flex flex-wrap items-center gap-3">
          <Badge color="green">Victory!</Badge>
          <Badge color="amber">In Progress</Badge>
          <Badge color="red">Defeated</Badge>
          <Badge color="purple">bounty</Badge>
          <Badge color="cyan">Import</Badge>
          <Badge color="amber">Export</Badge>
          <Badge color="slate">Docked</Badge>
        </div>
      </div>
    </StyleSection>
  );
}

// ── Progress Bars ────────────────────────────────────────────────

function ProgressBarsSection() {
  return (
    <StyleSection title="ProgressBar">
      <div className="space-y-4">
        <div>
          <p className="text-[10px] text-text-secondary uppercase tracking-wider mb-2">Colors — size=&quot;sm&quot;</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <ProgressBar label="Copper (default)" value={75} max={100} color="copper" size="sm" />
            <ProgressBar label="Blue" value={60} max={100} color="blue" size="sm" />
            <ProgressBar label="Green" value={85} max={100} color="green" size="sm" />
            <ProgressBar label="Red" value={25} max={100} color="red" size="sm" />
            <ProgressBar label="Amber" value={45} max={100} color="amber" size="sm" />
            <ProgressBar label="Purple" value={55} max={100} color="purple" size="sm" />
          </div>
        </div>
        <div>
          <p className="text-[10px] text-text-secondary uppercase tracking-wider mb-2">size=&quot;md&quot;</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <ProgressBar label="Hull" value={42} max={80} color="green" size="md" />
            <ProgressBar label="Fuel" value={15} max={100} color="red" size="md" />
          </div>
        </div>
      </div>
    </StyleSection>
  );
}

// ── Tabs ─────────────────────────────────────────────────────────

function TabsSection() {
  const [underlineTab, setUnderlineTab] = useState(0);
  const [pillTab, setPillTab] = useState(0);

  return (
    <StyleSection title="Tabs">
      <div className="space-y-4">
        <div>
          <p className="text-[10px] text-text-secondary uppercase tracking-wider mb-2">Underline (default)</p>
          <TabList aria-label="Underline tabs demo">
            <Tab active={underlineTab === 0} onClick={() => setUnderlineTab(0)}>Fleet</Tab>
            <Tab active={underlineTab === 1} onClick={() => setUnderlineTab(1)} count={3}>Missions</Tab>
            <Tab active={underlineTab === 2} onClick={() => setUnderlineTab(2)}>Events</Tab>
          </TabList>
        </div>
        <div>
          <p className="text-[10px] text-text-secondary uppercase tracking-wider mb-2">Pill</p>
          <TabList variant="pill" aria-label="Pill tabs demo">
            <Tab variant="pill" active={pillTab === 0} onClick={() => setPillTab(0)}>All</Tab>
            <Tab variant="pill" active={pillTab === 1} onClick={() => setPillTab(1)}>Active</Tab>
            <Tab variant="pill" active={pillTab === 2} onClick={() => setPillTab(2)}>Resolved</Tab>
          </TabList>
        </div>
      </div>
    </StyleSection>
  );
}

// ── Section Headers ──────────────────────────────────────────────

function SectionHeadersSection() {
  return (
    <StyleSection title="SectionHeader">
      <div className="space-y-2">
        <SectionHeader>Default Section Header</SectionHeader>
        <SectionHeader color="green">Green Section Header</SectionHeader>
        <SectionHeader color="red">Red Section Header</SectionHeader>
      </div>
    </StyleSection>
  );
}

// ── Stat Components ──────────────────────────────────────────────

function StatsSection() {
  return (
    <StyleSection title="Stats">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card variant="bordered" padding="sm">
          <CardHeader title="StatDisplay" />
          <CardContent className="space-y-3">
            <StatDisplay label="Credits" value="1,250,000" />
            <StatDisplay label="Systems Visited" value={42} trend="up" />
            <StatDisplay label="Danger Level" value="0.35" trend="down" />
          </CardContent>
        </Card>
        <Card variant="bordered" padding="sm">
          <CardHeader title="StatRow" subtitle="Wrap in StatList for semantic &lt;dl&gt;" />
          <CardContent>
            <StatList className="space-y-2">
              <StatRow label="Hull"><span>42 / 80</span></StatRow>
              <StatRow label="Shield"><span>20 / 20</span></StatRow>
              <StatRow label="Firepower"><span>18</span></StatRow>
              <StatRow label="Evasion"><span>12</span></StatRow>
            </StatList>
          </CardContent>
        </Card>
      </div>
    </StyleSection>
  );
}

// ── Feedback ─────────────────────────────────────────────────────

function FeedbackSection() {
  return (
    <StyleSection title="Feedback">
      <div className="space-y-4">
        <EmptyState message="No active battles." className="py-8" />
        <InlineAlert>Something went wrong. Please try again.</InlineAlert>
      </div>
    </StyleSection>
  );
}

// ── Page ─────────────────────────────────────────────────────────

export default function StyleguidePanelPage() {
  return (
    <DetailPanel title="Foundry Style Guide" size="xl">
      <div className="space-y-10">
        <ColorsSection />
        <TypographySection />
        <CardsSection />
        <ButtonsSection />
        <BadgesSection />
        <ProgressBarsSection />
        <TabsSection />
        <SectionHeadersSection />
        <StatsSection />
        <FeedbackSection />
      </div>
    </DetailPanel>
  );
}
