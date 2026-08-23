import type { MarketType, SportConfig, SportId } from "@/lib/types";

export const SPORTS: SportConfig[] = [
  {
    id: "soccer",
    label: "Football (Soccer)",
    icon: "⚽",
    sportPrefix: "soccer_",
    markets: ["h2h", "totals", "spreads", "btts", "double_chance", "draw_no_bet", "odd_even"],
  },
  {
    id: "basketball",
    label: "Basketball",
    icon: "🏀",
    sportPrefix: "basketball_",
    markets: ["h2h", "spreads", "totals"],
  },
  {
    id: "tennis",
    label: "Tennis",
    icon: "🎾",
    sportPrefix: "tennis_",
    markets: ["h2h", "totals", "spreads"],
  },
];

export const MARKET_LABELS: Record<MarketType, string> = {
  h2h: "Match Winner (1X2)",
  totals: "Over / Under",
  spreads: "Handicap / Spread",
  btts: "Both Teams To Score",
  double_chance: "Double Chance",
  draw_no_bet: "Draw No Bet",
  odd_even: "Odd / Even",
};

export const SOCCER_ONLY_MARKETS: MarketType[] = ["btts", "double_chance", "draw_no_bet", "odd_even"];

export const DEFAULT_MIN_ODDS = 1.3;
export const DEFAULT_MAX_ODDS = 5.0;

/** Preset accumulated (combined) odds targets for the accumulator builder */
export const ACCUMULATOR_ODDS_PRESETS: { label: string; value: number }[] = [
  { label: "10x", value: 10 },
  { label: "20x", value: 20 },
  { label: "50x", value: 50 },
  { label: "100x", value: 100 },
  { label: "200x", value: 200 },
];

export const SPORT_SHORT: Record<SportId, string> = {
  soccer: "Football",
  basketball: "Basketball",
  tennis: "Tennis",
};

export const FRIENDLIES_KEY = "soccer_friendlies";
export const FRIENDLIES_TITLE = "Club & International Friendlies";

export const DEFAULT_LEAGUES: Record<SportId, string[]> = {
  soccer: [
    "soccer_epl",
    "soccer_spain_la_liga",
    "soccer_italy_serie_a",
    "soccer_germany_bundesliga",
    "soccer_france_ligue_one",
    "soccer_uefa_champs_league",
  ],
  basketball: ["basketball_nba", "basketball_euroleague"],
  tennis: ["tennis_atp", "tennis_wta"],
};

const FALLBACK_LEAGUE_TITLES: Record<string, string> = {
  soccer_epl: "English Premier League",
  soccer_spain_la_liga: "Spain – La Liga",
  soccer_italy_serie_a: "Italy – Serie A",
  soccer_germany_bundesliga: "Germany – Bundesliga",
  soccer_france_ligue_one: "France – Ligue 1",
  soccer_uefa_champs_league: "UEFA Champions League",
  basketball_nba: "NBA",
  basketball_euroleague: "EuroLeague",
  tennis_atp: "ATP Tour",
  tennis_wta: "WTA Tour",
};

export function fallbackLeagues(sport: SportId): { key: string; title: string }[] {
  return (DEFAULT_LEAGUES[sport] ?? []).map((key) => ({
    key,
    title: FALLBACK_LEAGUE_TITLES[key] ?? key,
  }));
}

export function getSport(id: SportId): SportConfig {
  return SPORTS.find((s) => s.id === id) ?? SPORTS[0];
}

export const REGIONS = "eu,us,uk";
