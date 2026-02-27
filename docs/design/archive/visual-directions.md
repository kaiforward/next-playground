# Stellar Trader — Visual Direction Options

Three distinctive directions for the UI overhaul. Each targets the sci-fi trading/industrial/war theme from a different angle.

---

## Option A: FOUNDRY — Industrial Brutalism

**Vibe**: Steel foundry command deck. EVE Online meets industrial forge. Raw, structural, warm.

### Palette

| Token            | Value                  | Description          |
|------------------|------------------------|----------------------|
| Background       | `#0e1117`              | Charcoal steel       |
| Surface          | `#161b22`              | Gunmetal panel       |
| Surface hover    | `#1c2129`              | Heated steel         |
| Accent           | `#c75b39`              | Burnt copper         |
| Accent muted     | `#a04428`              | Aged copper          |
| Secondary        | `#d4a04a`              | Forge amber          |
| Text primary     | `#c9d1d9`              | Cool steel white     |
| Text secondary   | `#8b949e`              | Brushed steel        |
| Text muted       | `#6e7681`              | Worn steel           |
| Border           | `rgba(139,148,158,0.15)` | Steel hairline     |
| Border strong    | `rgba(139,148,158,0.30)` | Welded seam        |
| Danger           | `#da3633`              | Molten red           |
| Success          | `#3fb950`              | Reactor green        |

### Typography

| Role     | Font               | Notes                                    |
|----------|--------------------|------------------------------------------|
| Headings | **Chakra Petch**   | Angular, tech-industrial, distinctive    |
| Body     | **Geist Sans**     | Clean, modern, slightly geometric        |
| Data     | **Geist Mono**     | Monospace for numbers, prices, stats     |

### Card & Border Treatment

- **No border-radius** — all corners sharp (0px). Panels feel machined/stamped.
- **2px left accent bar** in burnt copper on cards — like a structural beam indicator.
- Thin steel hairline borders elsewhere.
- No backdrop-blur — opaque gunmetal surfaces.

### Background & Atmosphere

- Faint diagonal grid overlay (CSS repeating-linear-gradient) at ~3% opacity — suggests blueprints/schematics.
- Subtle warm vignette at edges (radial-gradient).

### Mockup — System Overview Card

```
┃━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┃
┃ SYSTEM SUMMARY                                        Arcturus-10 ┃
┃───────────────────────────────────────────────────────────────────┃
┃                                                                   ┃
┃  Region ............... Arcturus        PRODUCES                   ┃
┃  Economy .............. ■ CORE          ┌──────────────────────┐   ┃
┃  Government ........... Frontier        │ Luxuries (1/t)       │   ┃
┃  Population ........... Populated       └──────────────────────┘   ┃
┃  Traits ............... 2                                         ┃
┃  Connections .......... 12              CONSUMES                   ┃
┃  Danger ............... ▰▰▱▱▱ Mod.     ┌──────────────────────┐   ┃
┃                                         │ Food  Textiles  Elec │   ┃
┃  (copper 2px left bar runs              │ Medicine  Water  Wpn │   ┃
┃   the full height of the card)          └──────────────────────┘   ┃
┃                                                                   ┃
┃  Trade contracts .................. 8 avail                       ┃
┃  Operations ....................... 0 avail                       ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛
```

### Nav Bar

```
┌─────────────────────────────────────────────────────────────────────┐
│ STELLAR TRADER   ● Tick 14721   97,164 CR    Cmd Center  Map  ...  │
│─────────────────────────────────────────────────────────────────────│
  ↑ thin bottom border in copper, no bg blur, solid #0e1117
```

---

## Option B: MERIDIAN — Cartographic Navigation

**Vibe**: Antique star charts meet deep space exploration. Age of Discovery in space. Refined, elegant, warm-cool.

### Palette

| Token            | Value                  | Description          |
|------------------|------------------------|----------------------|
| Background       | `#080c18`              | Deep navy void       |
| Surface          | `#0f1528`              | Midnight panel       |
| Surface hover    | `#141c35`              | Twilight panel       |
| Accent           | `#d4a853`              | Navigator's gold     |
| Accent muted     | `#b08a3a`              | Aged brass           |
| Secondary        | `#4a9e8e`              | Astral teal          |
| Text primary     | `#d4cfc4`              | Warm parchment       |
| Text secondary   | `#9e9789`              | Faded ink            |
| Text muted       | `#6b6560`              | Aged brass           |
| Border           | `rgba(212,168,83,0.15)` | Gold hairline       |
| Border strong    | `rgba(212,168,83,0.30)` | Gold wire           |
| Danger           | `#c44540`              | Signal red           |
| Success          | `#4a9e6e`              | Verdant              |

### Typography

| Role     | Font                | Notes                                       |
|----------|---------------------|---------------------------------------------|
| Headings | **Crimson Pro**     | Elegant serif — maps, ledgers, navigation   |
| Body     | **Crimson Pro 400** | Light serif for readable body text          |
| Data     | **Source Code Pro**  | Crisp monospace for numbers and data        |

### Card & Border Treatment

- **Subtle rounding** (4px) — not sharp, not soft. Feels crafted.
- Thin gold hairline borders (`1px solid rgba(212,168,83,0.15)`).
- **Corner tick-marks** — tiny 6px lines at card corners (CSS ::before/::after), like coordinate markers on a chart.
- Double-line dividers inside cards (thin gold + gap + thin gold).

### Background & Atmosphere

- Subtle radial gradient: dark navy center → slightly warmer edges.
- Very faint dot-star pattern at 2% opacity (CSS radial-gradient dots).

### Mockup — System Overview Card

```
╔═══════════════════════════════════════════════════════════════════════╗
║  System Summary                                        Arcturus-10  ║
╟───────────────────────────────────────────────────────────────────────╢
║                                                                     ║
║   Region ............... Arcturus         Produces                   ║
║   Economy .............. ◆ CORE           ┌─────────────────────┐   ║
║   Government ........... Frontier         │  Luxuries (1/t)     │   ║
║   Population ........... Populated        └─────────────────────┘   ║
║   Traits ............... 2                                          ║
║   Connections .......... 12               Consumes                  ║
║   Danger ............... ◈◈◇◇◇ Mod.      ┌─────────────────────┐   ║
║                                           │  Food · Textiles    │   ║
║   (gold hairline border, corner           │  Electronics · Med  │   ║
║    tick-marks at all four corners,        │  Water · Weapons    │   ║
║    serif headings, mono data)             └─────────────────────┘   ║
║                                                                     ║
║   Trade contracts ................... 8 avail                       ║
║   Operations ........................ 0 avail                       ║
╚═══════════════════════════════════════════════════════════════════════╝
```

### Nav Bar

```
╔═════════════════════════════════════════════════════════════════════════╗
║  Stellar Trader    ● Tick 14721    97,164 CR     Cmd Center  Map  ... ║
╚═════════════════════════════════════════════════════════════════════════╝
  ↑ thin gold bottom border, serif "Stellar Trader" wordmark
```

---

## Option C: SIGNAL — Phosphor Terminal

**Vibe**: Nostromo ship computer. Retro CRT terminal with modern UX polish. Austere, data-dense, retro-future.

### Palette

| Token            | Value                  | Description          |
|------------------|------------------------|----------------------|
| Background       | `#030303`              | CRT black            |
| Surface          | `#0a0f0a`              | Dark phosphor        |
| Surface hover    | `#0f170f`              | Lit phosphor         |
| Accent           | `#33ff00`              | Phosphor green       |
| Accent muted     | `#1a8800`              | Dim phosphor         |
| Secondary        | `#ffaa00`              | Amber warning        |
| Text primary     | `rgba(51,255,0,0.90)`  | Bright phosphor      |
| Text secondary   | `rgba(51,255,0,0.60)`  | Medium phosphor      |
| Text muted       | `rgba(51,255,0,0.35)`  | Dim phosphor         |
| Border           | `rgba(51,255,0,0.12)`  | Green hairline       |
| Border strong    | `rgba(51,255,0,0.25)`  | Green wire           |
| Danger           | `#ff3b30`              | Alert red            |
| Success          | `#33ff00`              | Same as accent       |

### Typography

| Role     | Font               | Notes                                         |
|----------|--------------------|-----------------------------------------------|
| Headings | **IBM Plex Mono**  | Bold weight, all-caps, terminal authority      |
| Body     | **IBM Plex Mono**  | Light weight, uniform monospace throughout     |
| Data     | **IBM Plex Mono**  | Same family — everything is the terminal       |

### Card & Border Treatment

- **No border-radius** — perfectly rectangular, like terminal windows.
- 1px phosphor green hairline borders.
- **Section headers prefixed with `>_`** — terminal prompt style.
- Dot-leader lines between labels and values (like `Region .......... Arcturus`).

### Background & Atmosphere

- **CRT scanline overlay** — horizontal lines via repeating-linear-gradient at ~5% opacity.
- Subtle green vignette glow from center (radial-gradient of phosphor green at 2-3%).
- Optional: very subtle text-shadow glow on accent-colored elements.

### Mockup — System Overview Card

```
┌──────────────────────────────────────────────────────────────────────┐
│ >_ SYSTEM SUMMARY                                     Arcturus-10  │
│──────────────────────────────────────────────────────────────────────│
│                                                                     │
│  Region .................. Arcturus       >_ PRODUCES               │
│  Economy ................. CORE           ┌────────────────────┐    │
│  Government .............. Frontier       │ Luxuries (1/t)     │    │
│  Population .............. Populated      └────────────────────┘    │
│  Traits .................. 2                                        │
│  Connections ............. 12             >_ CONSUMES               │
│  Danger .................. ██░░░ Mod.     ┌────────────────────┐    │
│                                           │ Food · Textiles    │    │
│  (all text in phosphor green,             │ Electronics · Med  │    │
│   scanline overlay across entire          │ Water · Weapons    │    │
│   viewport, monospace everything)         └────────────────────┘    │
│                                                                     │
│  Trade contracts ...................... 8 avail                     │
│  Operations .......................... 0 avail                     │
└──────────────────────────────────────────────────────────────────────┘
```

### Nav Bar

```
┌────────────────────────────────────────────────────────────────────────┐
│ >_ STELLAR TRADER   ● Tick 14721   97,164 CR   CMD CENTER  MAP  ...  │
└────────────────────────────────────────────────────────────────────────┘
  ↑ 1px green border, all-caps monospace, green text on black
```

---

## Quick Comparison

| Aspect         | Foundry                  | Meridian                 | Signal                    |
|----------------|--------------------------|--------------------------|---------------------------|
| Mood           | Industrial, warm, raw    | Elegant, exploratory     | Austere, retro, data-dense|
| Accent color   | Burnt copper `#c75b39`   | Gold `#d4a853`           | Phosphor green `#33ff00`  |
| Card corners   | Sharp (0px)              | Subtle (4px)             | Sharp (0px)               |
| Card signature | 2px left copper bar      | Corner tick-marks        | `>_` prefix headers       |
| Font family    | Chakra Petch + Geist     | Crimson Pro + Source Code | IBM Plex Mono (all)       |
| Font character | Angular tech             | Serif cartographic       | Uniform terminal          |
| Background FX  | Diagonal grid overlay    | Star-dot pattern + glow  | CRT scanlines + glow      |
| War/combat feel| Strong (forge, molten)   | Moderate (naval charts)  | Strong (military terminal)|
| Trade feel     | Strong (industrial)      | Strong (navigation)      | Moderate (data readout)   |
