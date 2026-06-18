import type {
  QualityTier,
  TraitCategory,
  TraitId,
} from "@/lib/types/game";

// ── Trait definition ──────────────────────────────────────────────

export interface TraitDefinition {
  id: TraitId;
  name: string;
  category: TraitCategory;
  /** Flavour text per quality tier. */
  descriptions: Record<QualityTier, string>;
  /** Base danger adjustment added to system danger level. Positive = more dangerous, negative = safer. */
  dangerModifier?: number;
  /** Trait has downsides (radioactive, anomalies, etc.). */
  negative?: boolean;
}

// ── Quality tiers ─────────────────────────────────────────────────

export const QUALITY_TIERS: Record<
  QualityTier,
  { label: string; modifier: number; rarity: number }
> = {
  1: { label: "Marginal", modifier: 0.15, rarity: 50 },
  2: { label: "Solid", modifier: 0.4, rarity: 35 },
  3: { label: "Exceptional", modifier: 0.8, rarity: 15 },
};

// ── Trait catalog ─────────────────────────────────────────────────
//
// The narrative feature traits across 5 categories. A feature carries only
// flavour, quality descriptions, and an optional danger modifier — a system's
// world/body type and resource abundance live on bodies + richness modifiers
// (BODY_ARCHETYPES / RICHNESS_MODIFIERS in bodies.ts), not here.

export const TRAITS: Record<TraitId, TraitDefinition> = {
  // ── Planetary Bodies ────────────────────────────────────────────

  tidally_locked_world: {
    id: "tidally_locked_world",
    name: "Tidally Locked World",
    category: "planetary",
    descriptions: {
      1: "A tidally locked world with minor crystalline formations along the terminator line. Limited research interest.",
      2: "A tidally locked world where extreme temperature gradients create unique mineral structures in the twilight zone.",
      3: "A remarkable tidally locked world — the frozen dark hemisphere harbours rare crystalline formations found nowhere else in the sector.",
    },
  },
  geothermal_vents: {
    id: "geothermal_vents",
    name: "Geothermal Vents",
    category: "planetary",
    descriptions: {
      1: "Minor geothermal vents produce modest heat for small-scale chemical processing operations.",
      2: "Extensive geothermal networks drive industrial-scale fuel synthesis and chemical refinement.",
      3: "Continent-spanning thermal networks of extraordinary output — natural energy powers refineries that process raw materials at unmatched efficiency.",
    },
  },

  // ── Orbital Features ───────────────────────────────────────────

  binary_star: {
    id: "binary_star",
    name: "Binary Star",
    category: "orbital",
    descriptions: {
      1: "A distant binary companion with modest energy output. Navigation is complicated but manageable.",
      2: "A close binary pair generating enormous energy. Industrial refining benefits from the abundant power, though navigation requires care.",
      3: "A tight binary system with staggering energy output — powers refining at industrial scale and creates unique electromagnetic phenomena prized by researchers.",
    },
    dangerModifier: 0.03,
    negative: true,
  },
  lagrange_stations: {
    id: "lagrange_stations",
    name: "Lagrange Stations",
    category: "orbital",
    dangerModifier: -0.03,
    descriptions: {
      1: "A handful of small platforms at the system's Lagrange points. Basic orbital manufacturing capabilities.",
      2: "Established station clusters at stable orbital points. Significant industrial output and growing commerce.",
      3: "A vast network of stations spanning all five Lagrange points — a major industrial and commercial hub rivalling planetary settlements.",
    },
  },
  captured_rogue_body: {
    id: "captured_rogue_body",
    name: "Captured Rogue Body",
    category: "orbital",
    descriptions: {
      1: "A small wandering planetoid trapped in an eccentric orbit. Its unusual composition draws occasional research interest.",
      2: "A substantial rogue body with exotic mineral deposits not found in native system bodies. Miners and researchers share the claim.",
      3: "A massive captured planetoid with truly alien composition — materials here defy standard classification and command premium prices.",
    },
  },
  deep_space_beacon: {
    id: "deep_space_beacon",
    name: "Deep Space Beacon",
    category: "orbital",
    descriptions: {
      1: "A small navigation relay at a stable orbital point. Provides basic communications and route data to passing ships.",
      2: "A major navigation and communications hub drawing steady traffic. Systems around it benefit from being well-connected.",
      3: "A galactic-class deep space beacon — a nexus of navigation, communications, and information exchange. Its presence makes this system a natural crossroads.",
    },
  },

  // ── Resource Deposits ──────────────────────────────────────────

  crystalline_formations: {
    id: "crystalline_formations",
    name: "Crystalline Formations",
    category: "resource",
    descriptions: {
      1: "Small crystalline deposits with basic piezoelectric properties. Minor value for electronics production.",
      2: "Substantial crystalline structures with optical and data-storage applications. Supports advanced electronics manufacturing.",
      3: "Naturally occurring crystal formations of astonishing complexity — piezoelectric, optical, and quantum properties that push the boundaries of technology.",
    },
  },
  exotic_matter_traces: {
    id: "exotic_matter_traces",
    name: "Exotic Matter Traces",
    category: "resource",
    descriptions: {
      1: "Faint traces of anomalous materials detected in deep scans. Research teams study samples with great interest.",
      2: "Measurable deposits of exotic matter outside standard physics. A major research site drawing scientists from across the galaxy.",
      3: "Significant exotic matter concentrations — materials that challenge fundamental physics. One of the most scientifically valuable locations known.",
    },
  },

  // ── Phenomena & Anomalies ──────────────────────────────────────

  nebula_proximity: {
    id: "nebula_proximity",
    name: "Nebula Proximity",
    category: "phenomena",
    descriptions: {
      1: "The system sits near a thin nebular tendril. Occasional rare gas harvesting is possible.",
      2: "A substantial nebula looms nearby, providing rare gas harvesting opportunities and natural sensor interference.",
      3: "The system is enveloped in a dense nebula fringe — rich in rare gases, shrouded from sensors, a haven for the resourceful and the desperate alike.",
    },
  },
  solar_flare_activity: {
    id: "solar_flare_activity",
    name: "Solar Flare Activity",
    category: "phenomena",
    descriptions: {
      1: "The local star shows occasional flare activity. Energy harvesting is possible during active periods.",
      2: "A hyperactive star with frequent, powerful flares. Massive energy availability between dangerous radiation spikes.",
      3: "An extraordinarily active star — titanic flares power industrial-scale energy harvesting, but periodic storms can shut down operations for days.",
    },
    dangerModifier: 0.03,
    negative: true,
  },
  gravitational_anomaly: {
    id: "gravitational_anomaly",
    name: "Gravitational Anomaly",
    category: "phenomena",
    descriptions: {
      1: "Minor gravitational distortion detected by sensitive instruments. Research teams maintain a small monitoring station.",
      2: "A significant gravitational anomaly of unknown origin. Research stations cluster around it, generating steady scientific output.",
      3: "A profound gravitational distortion — possibly precursor technology, possibly natural. One of the galaxy's great mysteries and a magnet for the scientific community.",
    },
  },
  dark_nebula: {
    id: "dark_nebula",
    name: "Dark Nebula",
    category: "phenomena",
    descriptions: {
      1: "Thin dark gas clouds partially obscure the system. Sensor range is slightly reduced.",
      2: "Dense dark nebula shrouds the system, blocking sensors and complicating navigation. A natural hiding place.",
      3: "Impenetrable dark nebula engulfs the system — sensors are blind, navigation is treacherous, but what hides within is invisible to the outside galaxy.",
    },
    dangerModifier: 0.06,
    negative: true,
  },
  precursor_ruins: {
    id: "precursor_ruins",
    name: "Precursor Ruins",
    category: "phenomena",
    descriptions: {
      1: "Fragmentary ruins from an unknown civilisation. Mostly picked over, but occasional finds still surface.",
      2: "Substantial precursor ruins with intact structures. Archaeological teams regularly recover functional technology fragments.",
      3: "A vast precursor complex — largely intact, barely understood. Recovered technology has reshaped entire industries. Every faction wants access.",
    },
  },
  subspace_rift: {
    id: "subspace_rift",
    name: "Subspace Rift",
    category: "phenomena",
    descriptions: {
      1: "Faint subspace instability detected at the system's edge. Monitoring equipment records occasional anomalous readings.",
      2: "A measurable subspace rift generating dangerous but scientifically invaluable distortion effects. Approach with extreme caution.",
      3: "A major subspace rift — unstable spacetime that warps reality in its vicinity. One of only a handful known. Priceless to science, lethal to the careless.",
    },
    dangerModifier: 0.08,
    negative: true,
  },
  pulsar_proximity: {
    id: "pulsar_proximity",
    name: "Pulsar Proximity",
    category: "phenomena",
    descriptions: {
      1: "A distant pulsar sends regular electromagnetic pulses through the system. Minor industrial applications for radiation-hardened manufacturing.",
      2: "A nearby pulsar bathes the system in regular energy pulses. Hardened electronics manufacturing thrives here despite the hazards.",
      3: "An exceptionally close pulsar — its powerful, metronomic pulses enable unique radiation-hardened electronics that cannot be produced anywhere else.",
    },
  },
  ion_storm_corridor: {
    id: "ion_storm_corridor",
    name: "Ion Storm Corridor",
    category: "phenomena",
    descriptions: {
      1: "Occasional charged particle streams from stellar wind interactions. Minor energy harvesting is possible between surges.",
      2: "A significant ion storm corridor where intense energy enables industrial-scale catalysis and chemical synthesis. Periodic surges disrupt operations.",
      3: "A massive ion storm corridor — the intense charged particle streams power chemical synthesis on an extraordinary scale, but devastating surges can shut down the entire system.",
    },
    dangerModifier: 0.04,
    negative: true,
  },
  bioluminescent_ecosystem: {
    id: "bioluminescent_ecosystem",
    name: "Bioluminescent Ecosystem",
    category: "phenomena",
    descriptions: {
      1: "Faint bioluminescent organisms in the local ecosystem produce minor quantities of useful organic compounds.",
      2: "A thriving bioluminescent ecosystem yielding complex organic compounds with pharmaceutical and agricultural applications.",
      3: "An extraordinary bioluminescent ecosystem — exotic biological systems producing unique biochemistry that has revolutionised both agriculture and pharmaceutical research.",
    },
  },

  signal_anomaly: {
    id: "signal_anomaly",
    name: "Signal Anomaly",
    category: "phenomena",
    descriptions: {
      1: "Faint, repeating signals of unknown origin detected on deep-space frequencies. Origin unclear.",
      2: "A persistent signal anomaly broadcasting structured data patterns. Research teams maintain listening arrays to decode the transmissions.",
      3: "An extraordinarily complex signal anomaly — layered, structured, and possibly artificial. The source remains unknown, drawing scientists and conspiracy theorists in equal measure.",
    },
  },
  xenobiology_preserve: {
    id: "xenobiology_preserve",
    name: "Xenobiology Preserve",
    category: "phenomena",
    descriptions: {
      1: "A small protected zone harbours a handful of non-terrestrial organisms. Sampling is tightly regulated.",
      2: "A significant xenobiology preserve with diverse alien life forms. Controlled research yields pharmaceutical and agricultural breakthroughs.",
      3: "A vast preserve teeming with alien ecosystems — the largest concentration of non-terrestrial life ever documented. Its biochemistry has revolutionised medicine and bio-engineering.",
    },
  },
  ancient_minefield: {
    id: "ancient_minefield",
    name: "Ancient Minefield",
    category: "phenomena",
    dangerModifier: 0.05,
    negative: true,
    descriptions: {
      1: "Scattered dormant mines from a forgotten conflict drift through the outer system. Most shipping lanes are clear.",
      2: "A dense field of ancient automated mines makes large portions of the system hazardous. Salvagers occasionally recover valuable ordnance.",
      3: "A vast ancient minefield spanning the entire system — thousands of dormant weapons from a war lost to history. Navigation is perilous, but the intelligence locked within the mines is priceless.",
    },
  },
  pirate_stronghold: {
    id: "pirate_stronghold",
    name: "Pirate Stronghold",
    category: "phenomena",
    dangerModifier: 0.08,
    negative: true,
    descriptions: {
      1: "A minor pirate enclave operates from a hidden base in the system's asteroid field. Patrols keep them contained.",
      2: "An established pirate stronghold with fortified positions and a fleet of raiding vessels. Commerce is frequently disrupted.",
      3: "A major pirate stronghold — a heavily fortified base of operations from which raiding fleets terrorise the surrounding systems. Only the brave or foolish linger here.",
    },
  },

  // ── Infrastructure & Legacy ────────────────────────────────────

  ancient_trade_route: {
    id: "ancient_trade_route",
    name: "Ancient Trade Route",
    category: "legacy",
    descriptions: {
      1: "This system sits on a minor historic trade lane. A few old merchant families maintain traditional commerce.",
      2: "A historically significant trade junction. Established merchant guilds and commerce infrastructure attract steady traffic.",
      3: "A legendary crossroads of galactic trade — merchants have converged here for centuries. The commerce infrastructure is unmatched.",
    },
  },
  generation_ship_wreckage: {
    id: "generation_ship_wreckage",
    name: "Generation Ship Wreckage",
    category: "legacy",
    descriptions: {
      1: "Scattered debris from a colonisation-era vessel. Salvage crews pick through the remains for usable materials.",
      2: "A substantial generation ship hulk in a stable orbit. Organised salvage operations recover rare alloys and historical artifacts.",
      3: "A massive, largely intact generation ship — a treasure trove of pre-built materials, rare alloys, and priceless historical records from the colonisation era.",
    },
  },
  orbital_ring_remnant: {
    id: "orbital_ring_remnant",
    name: "Orbital Ring Remnant",
    category: "legacy",
    descriptions: {
      1: "Fragmentary sections of an ancient orbital ring. Some segments have been repurposed as basic manufacturing platforms.",
      2: "A partially intact orbital ring with functional industrial sections. Expansion and restoration are ongoing.",
      3: "A remarkably preserved orbital ring — a megastructure from a bygone era. Its industrial capacity rivals purpose-built stations at a fraction of the cost.",
    },
  },
  seed_vault: {
    id: "seed_vault",
    name: "Seed Vault",
    category: "legacy",
    descriptions: {
      1: "A small biological archive from the colonisation era. Some preserved crop strains are still cultivated locally.",
      2: "A substantial seed vault with diverse genetic material. Unique crop strains boost agricultural output and pharmaceutical research.",
      3: "A comprehensive biological archive of extraordinary completeness — thousands of preserved species, crop strains, and genetic data that have transformed the region's agricultural and biotech industries.",
    },
  },
  colonial_capital: {
    id: "colonial_capital",
    name: "Colonial Capital",
    category: "legacy",
    descriptions: {
      1: "Remnants of an early colonial administration. Some institutional infrastructure still functions, drawing minor trade.",
      2: "A former colonial capital with established institutions and population density. Governance infrastructure attracts commerce and industry.",
      3: "A grand colonial capital — centuries of continuous governance have built institutions, trade networks, and cultural significance that make this system a natural hub of civilisation.",
    },
  },
  free_port_declaration: {
    id: "free_port_declaration",
    name: "Free Port Declaration",
    category: "legacy",
    descriptions: {
      1: "A minor historical trade concession. Tariff reductions attract a trickle of additional merchant traffic.",
      2: "An established free port with meaningful tariff exemptions. Merchants prefer to route luxury goods through this system.",
      3: "A galactic free trade landmark — centuries of open commerce have built an unrivalled marketplace. Merchants from every corner of the galaxy converge here.",
    },
  },
  shipbreaking_yards: {
    id: "shipbreaking_yards",
    name: "Shipbreaking Yards",
    category: "legacy",
    descriptions: {
      1: "A small orbital scrapyard where decommissioned shuttles are stripped for salvageable components.",
      2: "Massive orbital scrapyards processing a steady stream of decommissioned vessels. Recycled metals and salvaged components feed local industry.",
      3: "The largest shipbreaking operation in the sector — an industrial-scale recycling machine that transforms retired fleets into raw materials, recovered alloys, and repurposed weapons systems.",
    },
  },
  derelict_fleet: {
    id: "derelict_fleet",
    name: "Derelict Fleet",
    category: "legacy",
    descriptions: {
      1: "A handful of gutted hulks drift in a decaying orbit. Occasional salvage runs recover scrap metal.",
      2: "A graveyard of warships from a forgotten campaign. Organised salvage teams strip the vessels for rare alloys and intact components.",
      3: "An enormous derelict fleet — hundreds of warships suspended in silent formation. The salvage rights alone are worth a fortune, and rumours persist of sealed vaults deep within the flagships.",
    },
  },
  abandoned_station: {
    id: "abandoned_station",
    name: "Abandoned Station",
    category: "legacy",
    descriptions: {
      1: "A small decommissioned outpost with stripped systems. Little of value remains beyond structural materials.",
      2: "A large abandoned station with partially functional infrastructure. Reclamation crews recover industrial equipment and data cores.",
      3: "A massive abandoned megastation — entire decks remain sealed and unexplored. Its industrial systems, if restored, could anchor a new colonial hub.",
    },
  },
  smuggler_haven: {
    id: "smuggler_haven",
    name: "Smuggler Haven",
    category: "legacy",
    descriptions: {
      1: "A discreet refuelling point known to independent traders. Authorities turn a blind eye to minor infractions.",
      2: "An established smuggler haven with hidden docking bays and a reputation for discretion. Contraband flows freely through its markets.",
      3: "A legendary smuggler haven — a vast network of concealed berths, black markets, and information brokers. If it exists, it can be found here — for a price.",
    },
  },
};

// ── Helpers ───────────────────────────────────────────────────────

export const ALL_TRAIT_IDS: readonly TraitId[] = Object.keys(TRAITS).filter(
  (k): k is TraitId => k in TRAITS,
);
