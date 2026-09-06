// Every tunable in one place. Milestone 6 is "run a hundred seeds and turn these
// knobs until the chronicles read well" — so nothing below is magic-numbered
// inline anywhere else.

export const WORLD_W = 96;
export const WORLD_H = 64;

export const TICKS_PER_YEAR = 12;

// --- world generation --------------------------------------------------------
export const SEA_LEVEL = 0.42;
export const COAST_BAND = 0.46;
export const HILL_LEVEL = 0.66;
export const MOUNTAIN_LEVEL = 0.78;
export const RIVER_COUNT = 30;
export const START_BANDS_MIN = 3;
export const START_BANDS_MAX = 6;
export const START_POP_MIN = 40;
export const START_POP_MAX = 80;
export const START_SEPARATION = 12;

// --- population --------------------------------------------------------------
export const BASE_CAPACITY = 620; // pop supported by fertility 1.0 at tech 1.0
export const GROWTH_RATE = 0.0019; // per month, at full food and no unrest
export const FOOD_NEED = 0.085; // food units per person per month
export const FOOD_STORE_MONTHS = 9; // granary depth, in months of need
export const FAMINE_DEATH_RATE = 0.028;
export const FAMINE_UNREST = 0.05;
export const FAMINE_TICKS = 3;

export const TIER_VILLAGE = 220;
export const TIER_TOWN = 1100;
export const TIER_CITY = 4200;

// --- migration ---------------------------------------------------------------
export const MIGRATION_PRESSURE = 0.86; // fraction of K that starts a split
export const MIGRATION_SHARE_MIN = 0.1;
export const MIGRATION_SHARE_MAX = 0.15;
export const MIGRATION_MIN_POP = 190;
export const SETTLE_RADIUS = 8;
/** Extra settling reach once a people can put out to water at all. */
export const SEA_SETTLE_BONUS = 4;
/** Minimum hexes between two settlements. Sets the saturation density of the map. */
export const SETTLE_SPACING = 3;
export const PROPHET_MIN_POP = 250;
export const SECESSION_BASE = 0.05;

// --- trade & roads -----------------------------------------------------------
export const TRADE_RADIUS = 7;
export const PARTNER_REFRESH = 24;
export const MAX_PARTNERS = 6;
export const TRADE_WEALTH = 0.0016;
/** Goods get used up and wealth gets spent; without these both grow forever. */
export const STOCK_DECAY = 0.994;
export const WEALTH_DECAY = 0.998;
export const CULTURE_CONVERGE = 0.0018;
/**
 * How much of that convergence survives crossing a border. Trade between two
 * realms should mix them, but not so fast that everybody on the map ends up
 * with the same six numbers — which is exactly what happened at 1.0.
 */
export const CULTURE_FOREIGN = 0.08;
export const CULTURE_DRIFT = 0.0035;
/**
 * How much of a habit survives a sea crossing. Goods travel fine once there are
 * hulls, but you meet foreign traders at the dock and not in the village, so
 * character and faith cross water far worse than cargo does. Stacked with
 * CULTURE_FOREIGN this leaves an overseas stranger essentially unmixable, which
 * is why island peoples stay peculiar long after first contact.
 */
export const CULTURE_OVERSEAS = 0.12;
export const ROAD_THRESHOLD = 260;
export const ROAD_TRAFFIC_DECAY = 0.9985;

// --- technology --------------------------------------------------------------
export const RESEARCH_PER_POP = 0.00042;
export const TECH_COST_BASE = 220;
export const TECH_COST_GROWTH = 2.15; // per era
export const INVENTOR_CHANCE = 0.45;
/**
 * How much of a taken city's knowledge the conquerors keep, scaled by sqrt(pop):
 * a camp yields nothing worth having, a great city gives up two or three trades.
 */
export const CONQUEST_TECH_RATE = 0.045;
/**
 * Ticks between diffusion passes. Each pass moves a craft one hop along the
 * trade network, so this is how long knowledge takes to cross a realm: raise it
 * and the provinces fall visibly behind the capital.
 */
export const TECH_DIFFUSION = TICKS_PER_YEAR;

// --- religion ----------------------------------------------------------------
export const PROPHET_CHANCE = 0.000018;
export const CONVERSION_RATE = 0.28; // rolled yearly, not monthly
/** Years before a converted settlement will consider switching again. */
export const CONVERSION_COOLDOWN = 25 * 12;
export const CONVERSION_MARGIN = 0.08;
export const SCHISM_CHANCE = 0.0006;
/** How hard a faith pulls its followers' culture toward its own tenets. */
export const FAITH_PULL = 0.003;
/** How fast a realm's character follows the character of its people. */
export const POLITY_CULTURE_TRACK = 0.04;

// --- politics ----------------------------------------------------------------
export const RULER_LIFESPAN_MIN = 25 * 12;
export const RULER_LIFESPAN_MAX = 62 * 12;
export const STABILITY_DRIFT = 0.006;
export const SUCCESSION_FRACTURE = 0.35; // stability below this can split a realm
export const GOV_KINGDOM_POP = 2600;
export const GOV_LATE_POP = 26000;

// --- war ---------------------------------------------------------------------
export const WAR_BASE_CHANCE = 0.012; // rolled once a year per neighbouring pair
/** Realms this close are neighbours even before their borders meet. */
export const WAR_REACH = 9;
export const BATTLE_CHANCE = 0.16; // per tick while at war
export const WAR_FATIGUE_PER_BATTLE = 0.06;
export const SACK_POP_LOSS = 0.35;
export const PEACE_FATIGUE = 0.75;
export const GRIEVANCE_DECAY = 0.998;

// --- disasters ---------------------------------------------------------------
export const PLAGUE_CHANCE = 0.00002; // per settlement per tick
export const PLAGUE_SPREAD = 0.16;
export const PLAGUE_DEATH_MIN = 0.1;
export const PLAGUE_DEATH_MAX = 0.35;
/** Survivors remember it, and so do their grandchildren. */
export const PLAGUE_IMMUNITY_YEARS_MIN = 35;
export const PLAGUE_IMMUNITY_YEARS_MAX = 80;
export const DROUGHT_CHANCE = 0.00006;
export const FLOOD_CHANCE = 0.00009;
export const QUAKE_CHANCE = 0.00004;

// --- landscape ---------------------------------------------------------------
/** One full wet-dry swing, in ticks. 600 years. */
export const CLIMATE_PERIOD = 7200;
export const CLIMATE_AMPLITUDE = 0.07;
/** Tiles resampled each year for climate creep, regrowth and soil recovery. */
export const LANDSCAPE_SAMPLE = 56;
export const CLEARING_CHANCE = 0.11;
export const REGROWTH_CHANCE = 0.3;
export const SOIL_EXHAUSTION_MAX = 0.34;
export const SOIL_DRIFT = 0.03;

// --- beasts and local sickness -----------------------------------------------
export const BEAST_CHANCE = 0.035;
export const SICKNESS_CHANCE = 0.007;

// --- bookkeeping -------------------------------------------------------------
export const CHRONICLE_CAP = 5000;
export const ERA_BLOCK = 1000;
export const ERA_HIGHLIGHTS = 5;
export const STATS_INTERVAL = 12;
export const STATS_CAP = 3000;
export const PERSIST_INTERVAL = 10;
