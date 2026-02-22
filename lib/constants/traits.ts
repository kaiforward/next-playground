import type {
  EconomyType,
  QualityTier,
  TraitCategory,
  TraitId,
} from "@/lib/types/game";

// ── Trait definition ──────────────────────────────────────────────

export interface TraitDefinition {
  id: TraitId;
  name: string;
  category: TraitCategory;
  /** Economy affinity scores — only non-zero entries. 1 = minor, 2 = strong. */
  economyAffinity: Partial<Record<EconomyType, 1 | 2>>;
  /** Which goods this trait boosts production of. */
  productionGoods: string[];
  /** Flavour text per quality tier. */
  descriptions: Record<QualityTier, string>;
  /** Base danger adjustment. Stored now, wired in Layer 1+. */
  dangerModifier?: number;
  /** Trait has downsides (volcanic, radioactive, etc.). */
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
// 45 traits across 5 categories. Economy affinities and production
// goods match the design doc (system-enrichment.md §1.1).
// Strong affinities (2) drive economy derivation; minor (1) are
// flavour and production bonuses only.

export const TRAITS: Record<TraitId, TraitDefinition> = {
  // ── Planetary Bodies ────────────────────────────────────────────

  habitable_world: {
    id: "habitable_world",
    name: "Habitable World",
    category: "planetary",
    economyAffinity: { agricultural: 2, core: 2 },
    productionGoods: ["food"],
    descriptions: {
      1: "A marginal world with thin atmosphere and limited arable land. Settlements cling to sheltered valleys.",
      2: "A temperate world with reliable water cycles and established farmland across its major continents.",
      3: "A garden world — Earth-like paradise with rich biosphere, deep oceans, and abundant natural resources.",
    },
  },
  ocean_world: {
    id: "ocean_world",
    name: "Ocean World",
    category: "planetary",
    economyAffinity: { agricultural: 2, extraction: 1 },
    productionGoods: ["food", "water"],
    descriptions: {
      1: "A waterlogged world with shallow seas. Small-scale aquaculture supplements local food supply.",
      2: "A deep-ocean world supporting industrial aquaculture farms and offshore mineral extraction platforms.",
      3: "A vast ocean world teeming with marine life. Massive kelp forests and deep-sea harvesting operations feed entire regions.",
    },
  },
  volcanic_world: {
    id: "volcanic_world",
    name: "Volcanic World",
    category: "planetary",
    economyAffinity: { extraction: 2, refinery: 1 },
    productionGoods: ["ore", "chemicals"],
    descriptions: {
      1: "An unstable world with minor geothermal vents. Surface mining is possible between eruption cycles.",
      2: "An active volcanic world with rich mineral deposits pushed to the surface. Geothermal energy powers local refining.",
      3: "A violently volcanic world — rivers of magma expose rare mineral seams. Hostile but extraordinarily resource-rich.",
    },
    dangerModifier: 0.05,
    negative: true,
  },
  frozen_world: {
    id: "frozen_world",
    name: "Frozen World",
    category: "planetary",
    economyAffinity: { extraction: 1 },
    productionGoods: ["water"],
    descriptions: {
      1: "A frigid world with thin ice deposits. Small mining crews extract water ice from surface craters.",
      2: "A frozen world with deep glacial formations. Automated harvesters strip water ice and frozen gases.",
      3: "A massive ice world with continent-spanning glaciers and cryogenic compound deposits of exceptional purity.",
    },
  },
  tidally_locked_world: {
    id: "tidally_locked_world",
    name: "Tidally Locked World",
    category: "planetary",
    economyAffinity: { extraction: 1, tech: 1 },
    productionGoods: ["ore"],
    descriptions: {
      1: "A tidally locked world with minor crystalline formations along the terminator line. Limited research interest.",
      2: "A tidally locked world where extreme temperature gradients create unique mineral structures in the twilight zone.",
      3: "A remarkable tidally locked world — the frozen dark hemisphere harbours rare crystalline formations found nowhere else in the sector.",
    },
  },
  desert_world: {
    id: "desert_world",
    name: "Desert World",
    category: "planetary",
    economyAffinity: { extraction: 1, industrial: 1 },
    productionGoods: ["ore"],
    descriptions: {
      1: "A dry, rocky world with scattered mineral deposits. Open-pit mining operations dot the barren surface.",
      2: "A mineral-rich desert world with extensive open-pit mines and solar-powered automated extraction rigs.",
      3: "A vast desert world with enormous mineral wealth exposed across its sun-baked surface. Solar energy abundance powers heavy industry.",
    },
  },
  jungle_world: {
    id: "jungle_world",
    name: "Jungle World",
    category: "planetary",
    economyAffinity: { agricultural: 1, tech: 1 },
    productionGoods: ["food", "chemicals"],
    descriptions: {
      1: "A humid world with dense vegetation. Small bio-harvesting operations collect native plant compounds.",
      2: "A lush jungle world with extraordinary biodiversity. Pharmaceutical prospectors map new species every season.",
      3: "A biodiversity hotspot of galactic significance — its dense canopy harbours unique compounds that have revolutionised bio-engineering.",
    },
  },
  geothermal_vents: {
    id: "geothermal_vents",
    name: "Geothermal Vents",
    category: "planetary",
    economyAffinity: { refinery: 2, extraction: 1 },
    productionGoods: ["fuel", "chemicals"],
    descriptions: {
      1: "Minor geothermal vents produce modest heat for small-scale chemical processing operations.",
      2: "Extensive geothermal networks drive industrial-scale fuel synthesis and chemical refinement.",
      3: "Continent-spanning thermal networks of extraordinary output — natural energy powers refineries that process raw materials at unmatched efficiency.",
    },
  },
  hydrocarbon_seas: {
    id: "hydrocarbon_seas",
    name: "Hydrocarbon Seas",
    category: "planetary",
    economyAffinity: { refinery: 2, extraction: 1 },
    productionGoods: ["chemicals", "fuel"],
    descriptions: {
      1: "Small hydrocarbon lakes dot the surface, providing modest chemical feedstock for local processing.",
      2: "Vast methane and ethane seas support industrial-scale chemical harvesting and refinery operations.",
      3: "World-spanning seas of liquid hydrocarbons — an industrial chemist's paradise. The raw feedstock here supplies refineries across the region.",
    },
  },
  fertile_lowlands: {
    id: "fertile_lowlands",
    name: "Fertile Lowlands",
    category: "planetary",
    economyAffinity: { agricultural: 2 },
    productionGoods: ["food"],
    descriptions: {
      1: "Marginal cropland with unreliable rainfall. Subsistence farming sustains small local populations.",
      2: "Expansive lowlands with rich soil and reliable growing seasons. Major agricultural operations feed neighbouring systems.",
      3: "The breadbasket of the region — endless fertile plains with ideal growing conditions that produce food surplus on a staggering scale.",
    },
  },
  coral_archipelago: {
    id: "coral_archipelago",
    name: "Coral Archipelago",
    category: "planetary",
    economyAffinity: { agricultural: 2, extraction: 1 },
    productionGoods: ["food", "water"],
    descriptions: {
      1: "Shallow marine ecosystems support small-scale aquaculture and seafloor mineral harvesting.",
      2: "A thriving archipelago with industrial aquaculture farms and mineral-rich shallow seas.",
      3: "A vast coral archipelago teeming with marine life — massive aquaculture operations and seafloor extraction make this one of the most productive systems in the sector.",
    },
  },
  tectonic_forge: {
    id: "tectonic_forge",
    name: "Tectonic Forge",
    category: "planetary",
    economyAffinity: { industrial: 2, extraction: 1 },
    productionGoods: ["metals", "machinery"],
    descriptions: {
      1: "Modest tectonic activity creates natural pressure chambers. Limited underground mineral concentration.",
      2: "Extreme geological forces compress and concentrate minerals underground. Raw material processing begins before human industry even touches it.",
      3: "A world where tectonic forces create natural foundries — ore is pre-processed by geological pressure into forms that make industrial production astonishingly efficient.",
    },
  },

  // ── Orbital Features ───────────────────────────────────────────

  asteroid_belt: {
    id: "asteroid_belt",
    name: "Asteroid Belt",
    category: "orbital",
    economyAffinity: { extraction: 2 },
    productionGoods: ["ore", "metals"],
    descriptions: {
      1: "A sparse debris field with scattered rocky bodies. Small-scale prospectors work the larger asteroids.",
      2: "A substantial asteroid belt with reliable ore deposits and several permanent mining installations.",
      3: "A dense, mineral-rich belt stretching across the system — one of the richest extraction sites in the sector.",
    },
  },
  gas_giant: {
    id: "gas_giant",
    name: "Gas Giant",
    category: "orbital",
    economyAffinity: { extraction: 2, refinery: 1 },
    productionGoods: ["fuel"],
    descriptions: {
      1: "A small gas giant with a thin hydrogen atmosphere. Fuel skimming operations yield modest returns.",
      2: "A large gas giant with rich atmospheric composition. Orbital fuel harvesting stations operate continuously.",
      3: "A massive gas giant with exceptional helium-3 concentration — an enormously valuable fuel source that powers the region.",
    },
  },
  mineral_rich_moons: {
    id: "mineral_rich_moons",
    name: "Mineral-Rich Moons",
    category: "orbital",
    economyAffinity: { extraction: 1, industrial: 1 },
    productionGoods: ["ore"],
    descriptions: {
      1: "A few small moons with trace mineral deposits. Low-gravity mining is cheap but yields are modest.",
      2: "Multiple moons with solid mineral deposits and established mining colonies. Easy orbital launch reduces transport costs.",
      3: "An exceptional moon system — each body specialised for different materials, creating a self-sustaining extraction network.",
    },
  },
  ring_system: {
    id: "ring_system",
    name: "Ring System",
    category: "orbital",
    economyAffinity: { extraction: 1 },
    productionGoods: ["water"],
    descriptions: {
      1: "A thin ring of ice and dust. Water extraction yields just enough to supply local stations.",
      2: "A broad ring system with dense ice deposits. Automated harvesters skim water and silicates efficiently.",
      3: "A spectacular ring system — dense bands of pristine ice provide an almost inexhaustible water supply.",
    },
  },
  binary_star: {
    id: "binary_star",
    name: "Binary Star",
    category: "orbital",
    economyAffinity: { refinery: 2, tech: 1 },
    productionGoods: ["fuel", "chemicals"],
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
    economyAffinity: { industrial: 2, core: 1 },
    productionGoods: ["machinery"],
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
    economyAffinity: { extraction: 1, tech: 1 },
    productionGoods: ["ore"],
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
    economyAffinity: { core: 2 },
    productionGoods: [],
    descriptions: {
      1: "A small navigation relay at a stable orbital point. Provides basic communications and route data to passing ships.",
      2: "A major navigation and communications hub drawing steady traffic. Systems around it benefit from being well-connected.",
      3: "A galactic-class deep space beacon — a nexus of navigation, communications, and information exchange. Its presence makes this system a natural crossroads.",
    },
  },

  // ── Resource Deposits ──────────────────────────────────────────

  rare_earth_deposits: {
    id: "rare_earth_deposits",
    name: "Rare Earth Deposits",
    category: "resource",
    economyAffinity: { extraction: 1, tech: 2 },
    productionGoods: ["electronics"],
    descriptions: {
      1: "Scattered deposits of rare earth elements. Enough to support small-scale electronics manufacturing.",
      2: "Significant rare earth veins enabling serious electronics production. Precision instrument fabrication is viable.",
      3: "Extraordinary concentrations of rare earth elements — a cornerstone of advanced electronics manufacturing for the entire region.",
    },
  },
  heavy_metal_veins: {
    id: "heavy_metal_veins",
    name: "Heavy Metal Veins",
    category: "resource",
    economyAffinity: { extraction: 1, industrial: 2 },
    productionGoods: ["metals", "weapons"],
    descriptions: {
      1: "Thin veins of titanium and tungsten in the planetary crust. Small foundries process limited quantities.",
      2: "Rich heavy metal deposits — titanium, tungsten, and uranium. Supports both industrial manufacturing and military production.",
      3: "Massive heavy metal formations of exceptional grade. The raw materials here feed shipyards and weapons factories across the sector.",
    },
  },
  organic_compounds: {
    id: "organic_compounds",
    name: "Organic Compounds",
    category: "resource",
    economyAffinity: { agricultural: 1, refinery: 1 },
    productionGoods: ["chemicals", "medicine"],
    descriptions: {
      1: "Trace organic compounds in the local geology. Minor pharmaceutical applications.",
      2: "Complex hydrocarbon deposits and pre-biotic chemistry. Pharmaceutical refineries produce steady output.",
      3: "Extraordinarily rich organic compound deposits — the pharmaceutical and synthetic material industries built on these resources are among the finest anywhere.",
    },
  },
  crystalline_formations: {
    id: "crystalline_formations",
    name: "Crystalline Formations",
    category: "resource",
    economyAffinity: { extraction: 1, tech: 2 },
    productionGoods: ["electronics"],
    descriptions: {
      1: "Small crystalline deposits with basic piezoelectric properties. Minor value for electronics production.",
      2: "Substantial crystalline structures with optical and data-storage applications. Supports advanced electronics manufacturing.",
      3: "Naturally occurring crystal formations of astonishing complexity — piezoelectric, optical, and quantum properties that push the boundaries of technology.",
    },
  },
  helium3_reserves: {
    id: "helium3_reserves",
    name: "Helium-3 Reserves",
    category: "resource",
    economyAffinity: { extraction: 1, refinery: 2 },
    productionGoods: ["fuel"],
    descriptions: {
      1: "Minor helium-3 traces in the local regolith. Extraction is viable but not economically significant.",
      2: "Substantial helium-3 reserves supporting commercial fusion fuel production. Strategically valuable.",
      3: "Vast helium-3 deposits — an energy goldmine. Fusion fuel produced here is shipped across the sector. Always strategically important.",
    },
  },
  exotic_matter_traces: {
    id: "exotic_matter_traces",
    name: "Exotic Matter Traces",
    category: "resource",
    economyAffinity: { tech: 2 },
    productionGoods: ["electronics"],
    descriptions: {
      1: "Faint traces of anomalous materials detected in deep scans. Research teams study samples with great interest.",
      2: "Measurable deposits of exotic matter outside standard physics. A major research site drawing scientists from across the galaxy.",
      3: "Significant exotic matter concentrations — materials that challenge fundamental physics. One of the most scientifically valuable locations known.",
    },
  },
  radioactive_deposits: {
    id: "radioactive_deposits",
    name: "Radioactive Deposits",
    category: "resource",
    economyAffinity: { extraction: 1, industrial: 1 },
    productionGoods: ["fuel", "chemicals"],
    descriptions: {
      1: "Low-grade fissile material deposits. Power generation potential is limited but useful for remote settlements.",
      2: "Significant radioactive deposits yielding fissile materials and medical isotopes. High value but requires careful handling.",
      3: "Massive fissile material reserves — uranium, thorium, and exotic isotopes. Powers reactors and weapons programmes, but the hazard is ever-present.",
    },
    dangerModifier: 0.04,
    negative: true,
  },
  superdense_core: {
    id: "superdense_core",
    name: "Superdense Core",
    category: "resource",
    economyAffinity: { extraction: 2 },
    productionGoods: ["ore", "metals"],
    descriptions: {
      1: "An unusually dense planetary core yields heavier-than-normal mineral deposits from deep mining operations.",
      2: "An ultra-dense core with extreme mineral concentrations. Deep mining yields rare ores in quantities impossible on lighter bodies.",
      3: "An extraordinarily dense planetary core — the mineral concentrations here are off the charts. Deep mining operations produce more raw material per tonne of rock than anywhere else in the sector.",
    },
  },
  glacial_aquifer: {
    id: "glacial_aquifer",
    name: "Glacial Aquifer",
    category: "resource",
    economyAffinity: { extraction: 2 },
    productionGoods: ["water", "chemicals"],
    descriptions: {
      1: "Modest underground frozen water reserves. Small-scale extraction supplements local supply.",
      2: "Vast underground frozen water reserves locked in ancient geological formations. Industrial-scale water extraction is highly efficient.",
      3: "Immense glacial aquifers spanning entire continents — an almost inexhaustible supply of water and dissolved chemical compounds. A critical resource hub.",
    },
  },

  // ── Phenomena & Anomalies ──────────────────────────────────────

  nebula_proximity: {
    id: "nebula_proximity",
    name: "Nebula Proximity",
    category: "phenomena",
    economyAffinity: { extraction: 1, tech: 1 },
    productionGoods: ["chemicals"],
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
    economyAffinity: { refinery: 1 },
    productionGoods: ["fuel"],
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
    economyAffinity: { tech: 2 },
    productionGoods: [],
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
    economyAffinity: {},
    productionGoods: [],
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
    economyAffinity: { tech: 2, core: 1 },
    productionGoods: ["electronics"],
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
    economyAffinity: { tech: 2 },
    productionGoods: [],
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
    economyAffinity: { industrial: 1, tech: 1 },
    productionGoods: ["electronics"],
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
    economyAffinity: { refinery: 2 },
    productionGoods: ["chemicals"],
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
    economyAffinity: { agricultural: 2, tech: 1 },
    productionGoods: ["food", "medicine"],
    descriptions: {
      1: "Faint bioluminescent organisms in the local ecosystem produce minor quantities of useful organic compounds.",
      2: "A thriving bioluminescent ecosystem yielding complex organic compounds with pharmaceutical and agricultural applications.",
      3: "An extraordinary bioluminescent ecosystem — exotic biological systems producing unique biochemistry that has revolutionised both agriculture and pharmaceutical research.",
    },
  },

  // ── Infrastructure & Legacy ────────────────────────────────────

  ancient_trade_route: {
    id: "ancient_trade_route",
    name: "Ancient Trade Route",
    category: "legacy",
    economyAffinity: { industrial: 1, core: 2 },
    productionGoods: ["luxuries"],
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
    economyAffinity: { extraction: 1, industrial: 1 },
    productionGoods: ["metals"],
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
    economyAffinity: { industrial: 2, core: 1 },
    productionGoods: ["machinery"],
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
    economyAffinity: { agricultural: 2, tech: 1 },
    productionGoods: ["food", "textiles"],
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
    economyAffinity: { core: 2, industrial: 1 },
    productionGoods: ["luxuries"],
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
    economyAffinity: { core: 2 },
    productionGoods: ["luxuries", "textiles"],
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
    economyAffinity: { industrial: 2, extraction: 1 },
    productionGoods: ["metals", "weapons"],
    descriptions: {
      1: "A small orbital scrapyard where decommissioned shuttles are stripped for salvageable components.",
      2: "Massive orbital scrapyards processing a steady stream of decommissioned vessels. Recycled metals and salvaged components feed local industry.",
      3: "The largest shipbreaking operation in the sector — an industrial-scale recycling machine that transforms retired fleets into raw materials, recovered alloys, and repurposed weapons systems.",
    },
  },
};

// ── Helpers ───────────────────────────────────────────────────────

export const ALL_TRAIT_IDS: readonly TraitId[] = Object.keys(
  TRAITS,
) as TraitId[];
