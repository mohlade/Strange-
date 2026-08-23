import { MARKET_LABELS } from "@/lib/sports";
import type { Game, MarketType, OddsMarket, Pick, PickConfig, SafeByMarket, SportId } from "@/lib/types";
import type { IntelData } from "@/lib/teamlintel";

export function sportFromKey(sportKey: string): SportId {
  if (sportKey.startsWith("basketball_")) return "basketball";
  if (sportKey.startsWith("tennis_")) return "tennis";
  return "soccer";
}

/**
 * One bettable option found on a game's board (e.g. "Over 168.5" or "Lakers -4.5").
 * Probabilities are Shin-de-margined within each bookmaker's line-group, then
 * averaged across books.
 */
interface GameOption {
  key: string;
  market: MarketType;
  marketLabel: string;
  selection: string;
  line: number | null;
  probs: number[];
  prices: { bookmaker: string; price: number }[];
}

/** How many of a game's options survive as candidates (best-per-game focus). */
const MAX_OPTIONS_PER_GAME = 3;

function collectGameOptions(
  game: Game,
  allowedMarkets: MarketType[],
  oversOnly: boolean,
): GameOption[] {
  const map = new Map<string, GameOption>();

  for (const bm of game.bookmakers) {
    for (const mkt of bm.markets) {
      if (!allowedMarkets.includes(mkt.key)) continue;

      // Group outcomes by line (totals/spreads) so each group can be
      // de-margined as a complete set — never drop one side before Shin runs.
      const groups = new Map<string, OddsMarket["outcomes"]>();
      for (const o of mkt.outcomes) {
        const gk = o.point !== undefined ? String(Math.round(o.point * 100) / 100) : "_";
        const g = groups.get(gk);
        if (g) g.push(o);
        else groups.set(gk, [o]);
      }

      for (const [gk, outs] of groups) {
        const probs = outs.length >= 2 ? shinProbs(outs) : normalizedProbs(outs);
        const point = gk === "_" ? undefined : Number(gk);
        for (const o of outs) {
          if (oversOnly && !o.name.toLowerCase().startsWith("over")) continue;
          const name = displayName(o.name, game);
          const key = `${mkt.key}|${gk}|${name}`;
          const existing = map.get(key);
          if (existing) {
            existing.probs.push(probs[o.name] ?? 1 / o.price);
            existing.prices.push({ bookmaker: bm.title, price: o.price });
          } else {
            map.set(key, {
              key,
              market: mkt.key,
              marketLabel: MARKET_LABELS[mkt.key],
              selection: selectionLabel(o.name, point, mkt.key, game),
              line: point ?? null,
              probs: [probs[o.name] ?? 1 / o.price],
              prices: [{ bookmaker: bm.title, price: o.price }],
            });
          }
        }
      }
    }
  }

  return [...map.values()];
}

interface ScoredOption {
  option: GameOption;
  prob: number;
  agreement: number;
  bestOdds: number;
  avgOdds: number;
  priceSpread: number;
  ev: number;
  score: number;
}

function scoreOption(option: GameOption): ScoredOption {
  const prob = mean(option.probs);
  const sd = stddev(option.probs, prob);
  const agreement =
    option.probs.length > 1 ? Math.max(0, 1 - sd / Math.max(prob, 0.001)) : 0.5;
  const prices = option.prices.map((p) => p.price);
  const bestOdds = Math.max(...prices);
  const avgOdds = mean(prices);
  const ev = (prob * bestOdds - 1) * 100;
  // Composite ranking: safety first; positive EV boosts, negative EV drags.
  const score = safetyScore(prob, agreement) + (ev >= 0 ? Math.min(20, ev * 2) : ev);

  return {
    option,
    prob,
    agreement,
    bestOdds,
    avgOdds,
    priceSpread: avgOdds > 0 ? ((bestOdds - avgOdds) / avgOdds) * 100 : 0,
    ev,
    score,
  };
}

function displayName(outcomeName: string, game: Game): string {
  const lower = outcomeName.toLowerCase();
  if (lower === "home") return game.home_team;
  if (lower === "away") return game.away_team;
  return outcomeName;
}

function formatPoint(point: number, market: MarketType): string {
  const p = Math.round(point * 100) / 100;
  if (market === "totals") return ` ${p}`;
  return p > 0 ? ` +${p}` : ` ${p}`;
}

function selectionLabel(outcomeName: string, point: number | undefined, market: MarketType, game: Game): string {
  const name = displayName(outcomeName, game);
  if (point === undefined) return name;
  return `${name}${formatPoint(point, market)}`;
}

function normalizedProbs(outcomes: { name: string; price: number }[]): Record<string, number> {
  const inv = outcomes.map((o) => 1 / o.price);
  const sum = inv.reduce((a, b) => a + b, 0);
  const out: Record<string, number> = {};
  outcomes.forEach((o, i) => {
    out[o.name] = inv[i] / sum;
  });
  return out;
}

/**
 * Shin (1993) margin removal.
 *
 * Naive proportional normalisation overrates longshots because it strips an
 * equal *proportion* of margin from every outcome, while real books shade
 * longshots hardest (favourites–longshot bias). The Shin model assumes a
 * fraction `z` of informed money and solves for the true probabilities:
 *
 *   π_i = (√(z² + 4(1−z)·r_i²/B) − z) / (2(1−z))
 *
 * where r_i are the raw implied probs (1/odds), B = Σr_i, and z is found by
 * bisection so that Σπ_i = 1. Falls back to proportional normalisation for
 * degenerate books (no margin, bad prices).
 */
function shinProbs(outcomes: { name: string; price: number }[]): Record<string, number> {
  const raw = outcomes.map((o) => 1 / Math.max(1.01, o.price));
  const B = raw.reduce((a, b) => a + b, 0);
  if (!(B > 1) || raw.length < 2 || !Number.isFinite(B)) return normalizedProbs(outcomes);

  const probsAt = (z: number): number[] =>
    raw.map(
      (r) => (Math.sqrt(z * z + (4 * (1 - z) * r * r) / B) - z) / (2 * (1 - z)),
    );

  let lo = 0;
  let hi = 0.6;
  for (let i = 0; i < 60; i++) {
    const z = (lo + hi) / 2;
    const total = probsAt(z).reduce((a, b) => a + b, 0);
    if (total > 1) lo = z;
    else hi = z;
  }
  const pis = probsAt((lo + hi) / 2);
  const out: Record<string, number> = {};
  let ok = true;
  outcomes.forEach((o, i) => {
    const v = pis[i];
    if (!Number.isFinite(v) || v <= 0.001) ok = false;
    out[o.name] = v;
  });
  return ok ? out : normalizedProbs(outcomes);
}

/** Full Kelly stake fraction (as % of bankroll, capped 25) for a price vs true prob. */
export function kellyPct(price: number, prob: number): number {
  const b = price - 1;
  if (b <= 0) return 0;
  const f = (b * prob - (1 - prob)) / b;
  return Math.max(0, Math.min(25, f * 100));
}

function valueGrade(safetyScore: number, ev: number): Pick["grade"] {
  if (safetyScore >= 75 && ev >= 0) return "A+";
  if (safetyScore >= 70) return "A";
  if (safetyScore >= 60) return "B+";
  if (safetyScore >= 48) return "B";
  return "C";
}

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function stddev(values: number[], m: number): number {
  if (values.length < 2) return 0;
  const variance = mean(values.map((v) => (v - m) ** 2));
  return Math.sqrt(variance);
}

function safetyScore(consensusProb: number, agreement: number): number {
  return Math.min(99, Math.round(consensusProb * 100 * (0.75 + 0.25 * agreement)));
}

/**
 * A richer composite score (0-99) blending:
 *  - bookmaker consensus probability (50%)
 *  - bookmaker agreement / market efficiency (20%)
 *  - API-Football Poisson model probability (20%) — only when available
 *  - form/position momentum signal (10%) — only when available
 */
export function deepAnalysisScore(
  consensusProb: number,
  agreement: number,
  modelProb: number | null,
  formSignal: number | null, // 0-1, higher = better form for this side
): number {
  const w1 = 0.20;
  let w0 = 0.50, w2 = 0.20, w3 = 0.10;
  // if model unavailable, redistribute its weight to consensus
  if (modelProb === null) { w0 += w2; w2 = 0; }
  if (formSignal === null) { w0 += w3; w3 = 0; }

  const score =
    w0 * consensusProb +
    w1 * agreement * consensusProb + // agreement amplifies consensus, not standalone
    w2 * (modelProb ?? 0) +
    w3 * (formSignal ?? 0);

  return Math.min(99, Math.round(score * 100));
}

export function analyzeGames(games: Game[], config: PickConfig): Pick[] {
  const picks: Pick[] = [];

  for (const game of games) {
    const sport = sportFromKey(game.sport_key);
    // Basketball is overs-only (full-game totals; halves when the feed carries them).
    const allowedMarkets: MarketType[] = sport === "basketball" ? ["totals"] : config.markets;
    const oversOnly = sport === "basketball";

    // ── full-board sweep: every bettable option on this game, scored ──
    const options = collectGameOptions(game, allowedMarkets, oversOnly);
    if (options.length === 0) continue;
    const scored = options
      .map(scoreOption)
      .sort((a, b) => b.score - a.score || b.option.probs.length - a.option.probs.length);
    const winners = scored.slice(0, MAX_OPTIONS_PER_GAME);

    for (let rank = 0; rank < winners.length; rank++) {
      const w = winners[rank];
      const c = w.option;

      // ── rationale: short evidence lines explaining the pick ──
      const rationale: string[] = [];
      rationale.push(
        rank === 0
          ? `best of ${scored.length} options scanned for this match`
          : `alt option ${rank + 1} of ${scored.length} scanned`,
      );
      if (oversOnly) rationale.push("basketball board restricted to Overs");
      rationale.push(
        `${c.probs.length} bookmaker${c.probs.length === 1 ? "" : "s"} · ${Math.round(
          w.prob * 100,
        )}% de-margined consensus`,
      );
      if (c.probs.length >= 6 && w.agreement >= 0.85)
        rationale.push("books agree tightly — efficient market");
      else if (c.probs.length >= 2 && w.agreement < 0.6)
        rationale.push("books split on this line — extra risk");
      if (w.priceSpread >= 2)
        rationale.push(`line shopping +${w.priceSpread.toFixed(1)}% vs market average`);
      if (w.ev >= 5) rationale.push(`positive EV (+${w.ev.toFixed(1)}%) at best price`);
      if (c.probs.length <= 2) rationale.push("thin market — treat as reference only");

      const prices = c.prices.map((p) => p.price);
      picks.push({
        sport,
        gameId: game.id,
        league: game.sport_title || game.sport_key,
        home: game.home_team,
        away: game.away_team,
        commenceTime: game.commence_time,
        market: c.market,
        marketLabel: c.marketLabel,
        selection: c.selection,
        bestOdds: Math.round(w.bestOdds * 100) / 100,
        avgOdds: Math.round(w.avgOdds * 100) / 100,
        oddsMin: Math.round(Math.min(...prices) * 100) / 100,
        oddsMax: Math.round(Math.max(...prices) * 100) / 100,
        bookmakerCount: c.probs.length,
        consensusProb: Math.round(w.prob * 1000) / 10,
        safetyScore: safetyScore(w.prob, w.agreement),
        ev: Math.round(w.ev * 10) / 10,
        kelly: Math.round(kellyPct(w.bestOdds, w.prob) * 10) / 10,
        grade: valueGrade(safetyScore(w.prob, w.agreement), w.ev),
        priceSpread: Math.round(w.priceSpread * 10) / 10,
        rationale: rationale.slice(0, 5),
        period: sport === "basketball" ? "Full Game" : undefined,
        optionsEvaluated: scored.length,
        bookmakerOdds: [...c.prices]
          .sort((a, b) => b.price - a.price)
          .slice(0, 5)
          .map((p) => ({ bookmaker: p.bookmaker, odds: Math.round(p.price * 100) / 100 })),
        teamIntel: null,
      });
    }
  }

  return picks;
}

export function applyIntel(picks: Pick[], intel: Map<string, IntelData>): Pick[] {
  return picks.map((p) => {
    const data = intel.get(p.gameId);
    if (!data) return p;

    let prob = p.consensusProb / 100;
    let modelProb: number | null = null;

    if (p.market === "h2h") {
      const pickName = p.selection.toLowerCase();
      const pickHome = p.home.toLowerCase();
      const pickAway = p.away.toLowerCase();
      if (pickName === pickHome || p.selection === p.home) modelProb = data.model.home;
      else if (pickName === pickAway || p.selection === p.away) modelProb = data.model.away;
      else if (pickName === "draw") modelProb = data.model.draw;
      if (modelProb !== null) {
        // Blend bookmaker consensus (60%) with Poisson model (40%)
        prob = 0.6 * prob + 0.4 * modelProb;
      }
    } else if (p.market === "totals" && data.intel.advice) {
      const isOver = p.selection.toLowerCase().startsWith("over");
      const adviceLower = data.intel.advice.toLowerCase();
      const adviceMatches = isOver
        ? adviceLower.includes("over") && !adviceLower.includes("under")
        : adviceLower.includes("under") && !adviceLower.includes("over");
      if (adviceMatches) prob = Math.min(0.97, prob + 0.03);
    }

    // Derive a form signal (0-1) from the relevant side's last 5 results
    const formStr = (() => {
      const pickName = p.selection.toLowerCase();
      const pickHome = p.home.toLowerCase();
      const pickAway = p.away.toLowerCase();
      if (pickName === pickHome || p.selection === p.home) return data.intel.homeForm;
      if (pickName === pickAway || p.selection === p.away) return data.intel.awayForm;
      return null;
    })();
    let formSignal: number | null = null;
    if (formStr && formStr !== "n/a") {
      const last5 = formStr.slice(-5).toUpperCase();
      let pts = 0;
      let total = 0;
      for (const ch of last5) {
        if (ch === "W") { pts += 1; total++; }
        else if (ch === "D") { pts += 0.5; total++; }
        else if (ch === "L") { total++; }
      }
      if (total > 0) formSignal = pts / total;
    }

    const agreement = Math.min(1, 0.6 + p.bookmakerCount * 0.05);

    // ── evidence lines from the team-intel layer ──
    const rationale = [...p.rationale];
    if (modelProb !== null && p.market === "h2h") {
      const marketProb = p.consensusProb / 100;
      const delta = (modelProb - marketProb) * 100;
      if (delta >= 3) rationale.push(`Poisson model agrees (+${delta.toFixed(0)}% vs market)`);
      else if (delta <= -3) rationale.push(`model disagrees (${delta.toFixed(0)}% vs market) — downgraded`);
    }
    if (formSignal !== null) {
      if (formSignal >= 0.7) rationale.push("picked side in strong recent form");
      else if (formSignal <= 0.3) rationale.push("picked side in poor form — caution");
    }

    const safetyScore = deepAnalysisScore(prob, agreement, modelProb, formSignal);
    return {
      ...p,
      consensusProb: Math.round(prob * 1000) / 10,
      safetyScore,
      ev: Math.round((prob * p.bestOdds - 1) * 1000) / 10,
      kelly: Math.round(kellyPct(p.bestOdds, prob) * 10) / 10,
      grade: valueGrade(safetyScore, (prob * p.bestOdds - 1) * 100),
      rationale: rationale.slice(0, 4),
      teamIntel: data.intel,
    };
  });
}

function poissonPmf(k: number, lambda: number): number {
  return (Math.exp(-lambda) * Math.pow(lambda, k)) / factorial(k);
}

function factorial(n: number): number {
  let f = 1;
  for (let i = 2; i <= n; i++) f *= i;
  return f;
}

function poissonCdf(k: number, lambda: number): number {
  let sum = 0;
  for (let i = 0; i <= k; i++) sum += poissonPmf(i, lambda);
  return sum;
}

function solveLambdaForOver(overProb: number): number {
  let lo = 0.4;
  let hi = 6.0;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    const pOver = 1 - poissonCdf(2, mid);
    if (pOver > overProb) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}

function gameH2HProbs(game: Game): { home: number; draw: number; away: number; bookmakers: number } | null {
  let ph = 0;
  let pd = 0;
  let pa = 0;
  let count = 0;
  for (const bm of game.bookmakers) {
    const mkt = bm.markets.find((m) => m.key === "h2h");
    if (!mkt || mkt.outcomes.length < 2) continue;
    const probs = shinProbs(mkt.outcomes);
    ph += probs[game.home_team] ?? probs.home ?? 0;
    pd += probs.draw ?? 0;
    pa += probs[game.away_team] ?? probs.away ?? 0;
    count++;
  }
  if (count === 0) return null;
  return { home: ph / count, draw: pd / count, away: pa / count, bookmakers: count };
}

function gameOverUnderProb(game: Game, line: number): number | null {
  const overProbs: number[] = [];
  for (const bm of game.bookmakers) {
    const mkt = bm.markets.find((m) => m.key === "totals");
    if (!mkt) continue;
    const over = mkt.outcomes.find((o) => Math.abs((o.point ?? 0) - line) < 0.01 && o.name.toLowerCase().startsWith("over"));
    const under = mkt.outcomes.find((o) => Math.abs((o.point ?? 0) - line) < 0.01 && o.name.toLowerCase().startsWith("under"));
    if (!over || !under) continue;
    const probs = shinProbs([
      { name: "over", price: over.price },
      { name: "under", price: under.price },
    ]);
    if (typeof probs.over === "number") overProbs.push(probs.over);
  }
  if (overProbs.length === 0) return null;
  return overProbs.reduce((a, b) => a + b, 0) / overProbs.length;
}

function fairOdds(prob: number): number {
  return Math.round((1 / Math.max(0.02, prob)) * 100) / 100;
}

const DERIVED_RATIONALE: Record<string, string> = {
  double_chance: "covers two of three outcomes — model-priced from 1X2 consensus",
  draw_no_bet: "stake refunded on draw — priced from de-margined 1X2",
  btts: "Poisson goal model calibrated to the O/U 2.5 market consensus",
  odd_even: "Poisson total-goals distribution — inherently close to a coin flip",
};

function derivedPickBase(
  game: Game,
  market: MarketType,
  selection: string,
  prob: number,
  agreement: number,
  bookmakerCount: number,
): Pick {
  const odds = fairOdds(prob);
  const score = safetyScore(prob, agreement);
  return {
    sport: "soccer",
    gameId: game.id,
    league: game.sport_title || game.sport_key,
    home: game.home_team,
    away: game.away_team,
    commenceTime: game.commence_time,
    market,
    marketLabel: MARKET_LABELS[market],
    selection,
    bestOdds: odds,
    avgOdds: odds,
    oddsMin: odds,
    oddsMax: odds,
    bookmakerCount,
    consensusProb: Math.round(prob * 1000) / 10,
    safetyScore: score,
    ev: 0,
    kelly: 0,
    grade: valueGrade(score, 0),
    priceSpread: 0,
    rationale: [
      `${bookmakerCount} books fed the model`,
      DERIVED_RATIONALE[market] ?? "model-derived fair odds",
    ],
    bookmakerOdds: [],
    teamIntel: null,
  };
}

export function deriveExtraPicks(games: Game[], config: PickConfig): Pick[] {
  const wanted = new Set(config.markets);
  if (!wanted.has("btts") && !wanted.has("double_chance") && !wanted.has("draw_no_bet") && !wanted.has("odd_even")) {
    return [];
  }
  if (!config.sports.includes("soccer")) return [];

  const derived: Pick[] = [];
  const soccerGames = games.filter((g) => sportFromKey(g.sport_key) === "soccer");

  for (const game of soccerGames) {
    const h2h = gameH2HProbs(game);
    if (!h2h) continue;
    const over26 = gameOverUnderProb(game, 2.5);
    const lambdaTotal = over26 !== null ? solveLambdaForOver(over26) : 2.6;
    const shareHome = h2h.home / Math.max(0.001, h2h.home + h2h.away);
    const lambdaHome = lambdaTotal * shareHome;
    const lambdaAway = lambdaTotal - lambdaHome;

    if (wanted.has("double_chance")) {
      const dc = {
        "Home or Draw": h2h.home + h2h.draw,
        "Home or Away": h2h.home + h2h.away,
        "Draw or Away": h2h.draw + h2h.away,
      };
      for (const [label, prob] of Object.entries(dc)) {
        derived.push(derivedPickBase(game, "double_chance", label, prob, 0.6, h2h.bookmakers));
      }
    }

    if (wanted.has("draw_no_bet")) {
      const denom = h2h.home + h2h.away;
      derived.push(derivedPickBase(game, "draw_no_bet", game.home_team, h2h.home / denom, 0.6, h2h.bookmakers));
      derived.push(derivedPickBase(game, "draw_no_bet", game.away_team, h2h.away / denom, 0.6, h2h.bookmakers));
    }

    if (wanted.has("btts")) {
      const yes = (1 - Math.exp(-lambdaHome)) * (1 - Math.exp(-lambdaAway));
      derived.push(derivedPickBase(game, "btts", "Yes", yes, 0.55, h2h.bookmakers));
      derived.push(derivedPickBase(game, "btts", "No", 1 - yes, 0.55, h2h.bookmakers));
    }

    if (wanted.has("odd_even")) {
      const odd = (1 - Math.exp(-2 * lambdaTotal)) / 2;
      derived.push(derivedPickBase(game, "odd_even", "Odd", odd, 0.5, h2h.bookmakers));
      derived.push(derivedPickBase(game, "odd_even", "Even", 1 - odd, 0.5, h2h.bookmakers));
    }
  }

  return derived;
}

function inOddsRange(p: Pick, config: PickConfig): boolean {
  return p.bestOdds >= config.minOdds && p.bestOdds <= config.maxOdds;
}

const TAB_ORDER: MarketType[] = [
  "h2h",
  "double_chance",
  "draw_no_bet",
  "btts",
  "odd_even",
  "totals",
  "spreads",
];

export function finalize(picks: Pick[], config: PickConfig): { ranked: Pick[]; safeByMarket: SafeByMarket[] } {
  const ranked = picks
    .filter((p) => inOddsRange(p, config))
    .sort((a, b) => b.safetyScore - a.safetyScore || b.ev - a.ev || b.bookmakerCount - a.bookmakerCount);

  // Tabs follow the odds types actually available on today's board (e.g.
  // basketball overs appear even when the user only checked other boxes).
  const present = [...new Set(ranked.map((p) => p.market))].sort(
    (a, b) => TAB_ORDER.indexOf(a) - TAB_ORDER.indexOf(b),
  );

  const safeByMarket: SafeByMarket[] = present.map((m) => ({
    market: m,
    marketLabel: MARKET_LABELS[m],
    picks: ranked.filter((p) => p.market === m).slice(0, 5),
  }));

  return { ranked, safeByMarket };
}

/**
 * Greedy algorithm to build an accumulator that meets a minimum combined-odds
 * target.  Works in two passes:
 *
 * Pass 1 — sort candidates by bestOdds DESC (highest contributors first) and
 *          greedily add picks until the running product >= targetCombinedOdds,
 *          skipping games already used and ensuring each pick passes safety
 *          threshold (safetyScore >= 40 by default).
 *
 * Pass 2 — if the target is still not met with the requested numPicks, relax
 *          the safety floor and retry from the remaining pool.
 *
 * Returns the selected picks (may be fewer than numPicks if the pool is
 * exhausted, which triggers the `partial` flag upstream).
 */
export function selectPicksForTargetOdds(
  ranked: Pick[],
  config: PickConfig,
  usedGames: Set<string> = new Set(),
): Pick[] {
  const target = config.targetCombinedOdds ?? 0;
  const maxPicks = Math.max(0, config.numPicks - usedGames.size);
  if (maxPicks === 0) return [];

  const safetyFloors = [50, 35, 0]; // progressively relax safety
  for (const floor of safetyFloors) {
    const pool = ranked.filter(
      (p) => !usedGames.has(p.gameId) && p.safetyScore >= floor,
    );
    if (pool.length === 0) continue;

    // Sort by bestOdds DESC so we accumulate towards the target fast
    const byOdds = [...pool].sort((a, b) => b.bestOdds - a.bestOdds);

    const selected: Pick[] = [];
    const localUsed = new Set<string>(usedGames);
    let product = 1;

    for (const pick of byOdds) {
      if (selected.length >= maxPicks) break;
      if (localUsed.has(pick.gameId)) continue;
      selected.push(pick);
      localUsed.add(pick.gameId);
      product *= pick.bestOdds;
      if (target > 0 && product >= target) break;
    }

    // If we've hit the target (or no target set), return this selection
    if (target === 0 || product >= target || pool.length <= maxPicks) {
      return selected;
    }
    // Otherwise continue to next (more relaxed) floor
  }

  // Last resort: return as many as possible from the full ranked pool
  const fallback: Pick[] = [];
  const fallbackUsed = new Set<string>(usedGames);
  for (const pick of ranked) {
    if (fallback.length >= maxPicks) break;
    if (fallbackUsed.has(pick.gameId)) continue;
    fallback.push(pick);
    fallbackUsed.add(pick.gameId);
  }
  return fallback;
}

export function selectPicks(
  ranked: Pick[],
  config: PickConfig,
  usedGames: Set<string> = new Set(),
): Pick[] {
  const requested = Math.max(0, config.numPicks - usedGames.size);
  const selected: Pick[] = [];

  const take = (p: Pick): boolean => {
    if (usedGames.has(p.gameId)) return false;
    usedGames.add(p.gameId);
    selected.push(p);
    return true;
  };

  // Phase 1 — one pick for every selected market (best safety per market, on a
  // game not already used).
  for (const market of config.markets) {
    if (selected.length >= requested) break;
    const best = ranked.find((p) => p.market === market && !usedGames.has(p.gameId));
    if (best) take(best);
  }

  // Phase 2 — round-robin across sports so every selected sport is represented.
  if (config.sports.length > 1) {
    let changed = true;
    while (selected.length < requested && changed) {
      changed = false;
      for (const sport of config.sports) {
        if (selected.length >= requested) break;
        const best = ranked.find((p) => p.sport === sport && !usedGames.has(p.gameId));
        if (best && take(best)) changed = true;
      }
    }
  }

  // Phase 3 — round-robin across markets so no single odds type dominates.
  let changed = true;
  while (selected.length < requested && changed) {
    changed = false;
    for (const market of config.markets) {
      if (selected.length >= requested) break;
      const best = ranked.find((p) => p.market === market && !usedGames.has(p.gameId));
      if (best && take(best)) changed = true;
    }
  }

  // Phase 4 — final top-up by overall safety when market variety is exhausted.
  for (const p of ranked) {
    if (selected.length >= requested) break;
    if (!usedGames.has(p.gameId)) take(p);
  }

  return selected;
}

export function combinedOdds(picks: Pick[]): number {
  if (picks.length === 0) return 0;
  return Math.round(picks.reduce((a, p) => a * p.bestOdds, 1) * 100) / 100;
}
