export type SportId = "soccer" | "basketball" | "tennis";

export type MarketType =
  | "h2h"
  | "totals"
  | "spreads"
  | "btts"
  | "double_chance"
  | "draw_no_bet"
  | "odd_even";

export type BetMode = "single" | "mixed";

export interface SportConfig {
  id: SportId;
  label: string;
  icon: string;
  sportPrefix: string;
  markets: MarketType[];
}

export interface League {
  key: string;
  title: string;
}

export interface PickConfig {
  sports: SportId[];
  markets: MarketType[];
  numPicks: number;
  mode: BetMode;
  minOdds: number;
  maxOdds: number;
  /** Optional minimum accumulated (combined) odds target for the accumulator */
  targetCombinedOdds?: number;
  day: string;
  tzOffset: number;
  leagues: Partial<Record<SportId, string[]>>;
}

export interface OddsOutcome {
  name: string;
  price: number;
  point?: number;
}

export interface OddsMarket {
  key: MarketType;
  outcomes: OddsOutcome[];
}

export interface Bookmaker {
  key: string;
  title: string;
  markets: OddsMarket[];
}

export interface Game {
  id: string;
  sport_key: string;
  sport_title: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers: Bookmaker[];
}

export interface TeamIntel {
  homeForm: string;
  awayForm: string;
  homePosition: number | null;
  awayPosition: number | null;
  h2hNote: string;
  advice: string | null;
  modelWinner: string | null;
  modelHome: number | null;
  modelDraw: number | null;
  modelAway: number | null;
  goalsAdvice: string | null;
}

export interface BookmakerOdds {
  bookmaker: string;
  odds: number;
}

export interface Pick {
  sport: SportId;
  gameId: string;
  league: string;
  home: string;
  away: string;
  commenceTime: string;
  market: MarketType;
  marketLabel: string;
  selection: string;
  bestOdds: number;
  avgOdds: number;
  oddsMin: number;
  oddsMax: number;
  bookmakerCount: number;
  consensusProb: number;
  safetyScore: number;
  ev: number;
  /** Full Kelly stake as % of bankroll (0-25), derived from consensus prob vs best price */
  kelly: number;
  /** Letter grade A+..C from safety + EV */
  grade: "A+" | "A" | "B+" | "B" | "C";
  /** % the best price beats the market average (line-shopping edge) */
  priceSpread: number;
  /** Short human-readable reasons backing this pick */
  rationale: string[];
  /** Bettable period of the line, e.g. "Full Game" or "1st Half" (basketball overs) */
  period?: string;
  /** How many distinct bettable options were evaluated for this game before choosing this one */
  optionsEvaluated?: number;
  bookmakerOdds: BookmakerOdds[];
  teamIntel: TeamIntel | null;
}

export interface SafeByMarket {
  market: MarketType;
  marketLabel: string;
  picks: Pick[];
}

export interface SportyOutcome {
  selection: string;
  home: string;
  away: string;
  odds: string;
  tournament: string;
  market: string;
}

export interface SportyBetResult {
  shareCode: string;
  shareURL: string;
  deadline: number | null;
  outcomes: SportyOutcome[];
  unavailable: string[];
}

export interface GenerateResult {
  source: "live" | "mock" | "mock-fallback" | "catalog-fallback";
  generatedAt: string;
  date: string;
  config: PickConfig;
  code: string;
  mode: BetMode;
  picks: Pick[];
  safeByMarket: SafeByMarket[];
  combinedOdds?: number;
  combinedProb?: number;
  /** Slip-level expected value in % (mixed mode) */
  slipEv?: number;
  /** Slip-level full Kelly stake as % of bankroll */
  slipKelly?: number;
  /** Whether the accumulated odds target was met */
  targetOddsAchieved?: boolean;
  stake?: number;
  partial: boolean;
  skippedSports: SportId[];
  sporty: SportyBetResult | null;
  disclaimer: string;
}

export type ApiErrorCode =
  | "BAD_CONFIG"
  | "BAD_BODY"
  | "NO_GAMES"
  | "ODDS_RANGE_EMPTY"
  | "NOT_ENOUGH_GAMES";

export interface ApiError {
  error: string;
  code?: ApiErrorCode;
  suggestion?: string;
}
