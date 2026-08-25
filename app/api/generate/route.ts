import {
  analyzeGames,
  applyIntel,
  combinedOdds,
  deriveExtraPicks,
  finalize,
  kellyPct,
  selectPicks,
  selectPicksForTargetOdds,
  sportFromKey,
} from "@/lib/analysis";
import { generateBetCode } from "@/lib/code";
import { generateCatalogGames } from "@/lib/mock";
import { fetchSportGames } from "@/lib/odds";
import { bookSportyBet, fetchSportyEvents, matchPickToEvent, pickToSelection } from "@/lib/sportybet";
import { DEFAULT_MAX_ODDS, DEFAULT_MIN_ODDS, getSport } from "@/lib/sports";
import { enrichGamesWithIntel, intelEnabled } from "@/lib/teamlintel";
import type { ApiErrorCode, Game, GenerateResult, MarketType, Pick as SportPick, PickConfig, SportId, SportyBetResult } from "@/lib/types";

const VALID_SPORTS: SportId[] = ["soccer", "basketball", "tennis"];
const VALID_MARKETS = [
  "h2h",
  "totals",
  "spreads",
  "btts",
  "double_chance",
  "draw_no_bet",
  "odd_even",
] as const;
const API_MARKETS: readonly string[] = ["h2h", "totals", "spreads"];
const VALID_MODES = ["single", "mixed"] as const;
const VALID_DAYS = ["today", "tomorrow", "any"] as const;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const dynamic = "force-dynamic";

function sanitizeSports(raw: unknown): SportId[] {
  const list = Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : [];
  const picked = list.filter(
    (s): s is SportId => typeof s === "string" && (VALID_SPORTS as string[]).includes(s),
  );
  return picked.length > 0 ? [...new Set(picked)] : ["soccer"];
}

function sanitizeLeagues(raw: unknown): PickConfig["leagues"] {
  const out: PickConfig["leagues"] = {};
  if (raw && typeof raw === "object") {
    for (const sport of VALID_SPORTS) {
      const value = (raw as Record<string, unknown>)[sport];
      if (Array.isArray(value)) {
        const keys = value.filter((k): k is string => typeof k === "string");
        if (keys.length > 0) out[sport] = keys;
      }
    }
  }
  return out;
}

function sanitizeConfig(body: unknown): PickConfig | null {
  const b = (body ?? {}) as Record<string, unknown>;

  if (typeof b.mode !== "string" || !(VALID_MODES as readonly string[]).includes(b.mode)) return null;

  const markets: MarketType[] = Array.isArray(b.markets)
    ? (b.markets as unknown[])
        .filter(
          (m): m is (typeof VALID_MARKETS)[number] =>
            typeof m === "string" && (VALID_MARKETS as readonly string[]).includes(m),
        )
    : ["h2h"];
  if (markets.length === 0) return null;

  const numPicks = typeof b.numPicks === "number" ? Math.round(b.numPicks) : 3;
  let minOdds = typeof b.minOdds === "number" && Number.isFinite(b.minOdds) ? b.minOdds : DEFAULT_MIN_ODDS;
  let maxOdds = typeof b.maxOdds === "number" && Number.isFinite(b.maxOdds) ? b.maxOdds : DEFAULT_MAX_ODDS;
  // Per-game odds: allow up to 500 so large accumulators can include higher-odds games
  minOdds = Math.max(1.01, Math.min(minOdds, 500));
  maxOdds = Math.min(500, Math.max(maxOdds, 1.01));
  // User swapped the edges (e.g. typed 3–2)? Normalise instead of returning zero picks.
  if (minOdds > maxOdds) [minOdds, maxOdds] = [maxOdds, minOdds];
  const targetCombinedOdds =
    typeof b.targetCombinedOdds === "number" && b.targetCombinedOdds > 1
      ? Math.min(100_000, b.targetCombinedOdds)
      : undefined;
  const day =
    typeof b.day === "string" &&
    ((VALID_DAYS as readonly string[]).includes(b.day) || ISO_DATE.test(b.day))
      ? b.day
      : "any";
  const tzOffset = typeof b.tzOffset === "number" && Number.isFinite(b.tzOffset) ? b.tzOffset : 0;

  const sports = sanitizeSports(b.sports);
  // Basketball legs are overs-only by design; make sure totals is selectable.
  if (sports.includes("basketball") && !markets.includes("totals")) markets.push("totals");

  return {
    sports,
    markets,
    numPicks: Math.min(100, Math.max(1, numPicks)),
    mode: b.mode as PickConfig["mode"],
    minOdds,
    maxOdds,
    targetCombinedOdds,
    day,
    tzOffset: Math.min(840, Math.max(-720, Math.round(tzOffset))),
    leagues: sanitizeLeagues(b.leagues),
  };
}

function apiError(
  code: ApiErrorCode,
  error: string,
  suggestion?: string,
  status = 422,
): Response {
  return Response.json({ error, code, suggestion }, { status });
}

async function buildSportyPicks(picks: SportPick[]): Promise<SportyBetResult | null> {
  const sportsWithPicks = [...new Set(picks.map((p) => p.sport))];
  const catalogs = await Promise.all(
    sportsWithPicks.map(async (sport) => ({ sport, events: await fetchSportyEvents(sport) })),
  );
  const eventsBySport = new Map(catalogs.map((c) => [c.sport, c.events]));

  const bookable: {
    pick: SportPick;
    selection: NonNullable<ReturnType<typeof pickToSelection>>;
    sport: SportId;
  }[] = [];
  for (const pick of picks) {
    const events = eventsBySport.get(pick.sport) ?? [];
    if (events.length === 0) continue;
    const event = matchPickToEvent(pick, events);
    if (!event) continue;
    const selection = pickToSelection(pick, event, pick.sport);
    if (selection) bookable.push({ pick, selection, sport: pick.sport });
  }
  if (bookable.length === 0) return null;
  return bookSportyBet(bookable);
}

async function buildCatalogRanked(
  sports: SportId[],
  config: PickConfig,
): Promise<{ ranked: SportPick[] } | null> {
  const catalogGames: Game[] = [];
  for (const sport of sports) {
    const events = await fetchSportyEvents(sport);
    if (events.length === 0) continue;
    const games = generateCatalogGames(sport, events, { day: config.day, offset: config.tzOffset });
    catalogGames.push(...games);
  }
  if (catalogGames.length === 0) return null;
  let poolPicks = analyzeGames(catalogGames, config);
  poolPicks = poolPicks.concat(deriveExtraPicks(catalogGames, config));
  const poolFinal = finalize(poolPicks, config);
  if (poolFinal.ranked.length === 0) return null;
  return { ranked: poolFinal.ranked };
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("BAD_BODY", "The request didn't make it through in one piece.", "Refresh the page and try again.", 400);
  }

  const config = sanitizeConfig(body);
  if (!config) {
    return apiError("BAD_CONFIG", "Those settings didn't add up.", "Reset the form (reload the page) and try again.", 400);
  }

  const markets = config.markets;
  const wantsDerived = markets.some((m) => !(API_MARKETS as readonly string[]).includes(m));
  const baseFetchMarkets: MarketType[] = markets.filter((m) =>
    (API_MARKETS as readonly string[]).includes(m),
  );
  if (wantsDerived && !baseFetchMarkets.includes("h2h")) baseFetchMarkets.unshift("h2h");
  // Basketball is overs-only: fetch totals exclusively (saves quota, sharpens pool).
  const fetchMarketsFor = (sport: SportId): MarketType[] =>
    sport === "basketball" ? ["totals"] : baseFetchMarkets;

  const fetched = await Promise.allSettled(
    config.sports.map((sport) =>
      fetchSportGames(sport, getSport(sport).sportPrefix, fetchMarketsFor(sport), {
        leagues: config.leagues[sport],
        day: config.day,
        offset: config.tzOffset,
      }),
    ),
  );

  const games: Game[] = [];
  const allSportKeys: string[] = [];
  let fellBack = false;
  let catalogBack = false;
  fetched.forEach((r, i) => {
    const sport = config.sports[i];
    if (r.status === "fulfilled") {
      games.push(...r.value.games);
      allSportKeys.push(...r.value.sportKeys);
      if (r.value.sportKeys[0]?.startsWith("mock_")) fellBack = true;
      if (r.value.sportKeys[0]?.startsWith("catalog_")) catalogBack = true;
    } else {
      console.error(`Fetch failed for ${sport}:`, r.reason);
      fellBack = true;
    }
  });

  // Only offer fixtures that haven't kicked off yet (60-min in-play grace).
  const cutoff = Date.now() - 60 * 60_000;
  for (let i = games.length - 1; i >= 0; i--) {
    if (new Date(games[i].commence_time).getTime() < cutoff) games.splice(i, 1);
  }

  const presentSports = new Set(games.map((g) => sportFromKey(g.sport_key)));
  const skippedSports = config.sports.filter((s) => !presentSports.has(s));

  if (games.length === 0) {
    const leagueFiltered = Object.values(config.leagues).some((l) => l && l.length > 0);
    return apiError(
      "NO_GAMES",
      "No fixtures found for that day and sport combination.",
      leagueFiltered
        ? "Your league filters may be too narrow — hit 'All leagues' or pick another day."
        : "Try 'All days', switch to tomorrow, or add more odds types.",
    );
  }

  let source: "catalog-fallback" | "mock-fallback" | "mock" | "live" = catalogBack
    ? "catalog-fallback"
    : fellBack
      ? (process.env.ODDS_API_KEY ? "mock-fallback" : "mock")
      : "live";

  let picks = analyzeGames(games, config);
  picks = picks.concat(deriveExtraPicks(games, config));

  if (config.sports.includes("soccer") && intelEnabled()) {
    const soccerGames = games.filter(
      (g) => sportFromKey(g.sport_key) === "soccer" && g.sport_key !== "soccer_friendlies",
    );
    // Enrich top-20 candidates (up from 8) so intel-adjusted ranking has more
    // material to work with before we select the final N picks.
    const topCandidates = picks
      .filter((p) => p.sport === "soccer")
      .sort((a, b) => b.consensusProb - a.consensusProb)
      .slice(0, 20);
    const targetIds = new Set(topCandidates.map((p) => p.gameId));
    const subset = soccerGames.filter((g) => targetIds.has(g.id));
    if (subset.length > 0) {
      const intel = await enrichGamesWithIntel(subset);
      picks = applyIntel(picks, intel);
    }
  }

  // BUG FIX: re-run finalize AFTER intel so intel-adjusted safety scores
  // determine the final pick ranking, not pre-intel scores.
  const { ranked, safeByMarket } = finalize(picks, config);

  if (ranked.length === 0) {
    const closest = picks.reduce(
      (best, p) => {
        const d = p.bestOdds < config.minOdds ? config.minOdds - p.bestOdds : p.bestOdds - config.maxOdds;
        return d < best.d ? { d, odds: p.bestOdds } : best;
      },
      { d: Infinity, odds: 0 },
    );
    return apiError(
      "ODDS_RANGE_EMPTY",
      `Nothing fits ${config.minOdds}–${config.maxOdds} right now.`,
      closest.odds > 0
        ? `The closest priced selection is ${closest.odds.toFixed(2)} — widen the range to include it.`
        : "Widen your odds range or add more odds types.",
    );
  }

  let finalPicks = config.targetCombinedOdds
    ? selectPicksForTargetOdds(ranked, config)
    : selectPicks(ranked, config);

  if (finalPicks.length === 0) {
    return apiError(
      "NOT_ENOUGH_GAMES",
      "Not enough distinct games to build this slip.",
      "Lower the number of picks, or pick 'All days' for a deeper pool.",
    );
  }

  // Top up from real SportyBet fixtures when the primary source can't supply
  // the full requested accumulator (e.g. live odds only cover a few games).
  // Skip when a combined-odds target is already met — extra legs would only
  // inflate the odds and slash the win probability.
  const achieved = combinedOdds(finalPicks);
  const targetMet = config.targetCombinedOdds !== undefined && achieved >= config.targetCombinedOdds;
  if (finalPicks.length < config.numPicks && !targetMet) {
    try {
      const pool = await buildCatalogRanked(config.sports, config);
      if (pool) {
        const used = new Set(finalPicks.map((p) => p.gameId));
        const topUp = config.targetCombinedOdds
          ? selectPicksForTargetOdds(pool.ranked, config, used)
          : selectPicks(pool.ranked, config, used);
        finalPicks = finalPicks.concat(topUp);
      }
    } catch (err) {
      console.error("SportyBet catalog top-up failed:", err);
    }
  }

  let sporty: SportyBetResult | null = null;
  try {
    sporty = await buildSportyPicks(finalPicks);
  } catch (err) {
    console.error("SportyBet booking flow failed:", err);
  }

  if (!sporty) {
    try {
      const pool = await buildCatalogRanked([...new Set(finalPicks.map((p) => p.sport))], config);
      if (pool) {
        const fallbackSelected = selectPicks(pool.ranked, config);
        if (fallbackSelected.length > 0) {
          const fallbackSporty = await buildSportyPicks(fallbackSelected);
          if (fallbackSporty) {
            finalPicks = fallbackSelected;
            sporty = fallbackSporty;
            source = "catalog-fallback";
          }
        }
      }
    } catch (err) {
      console.error("SportyBet catalog safety net failed:", err);
    }
  }

  // Pre-code verification: the book itself is the final check. Any leg Sporty
  // marked unavailable is dropped from the slip so the displayed picks always
  // match what the booking code actually loads.
  if (sporty && sporty.unavailable.length > 0 && sporty.outcomes.length > 0) {
    const rejected = sporty.unavailable.map((u) => u.toLowerCase());
    const kept = finalPicks.filter((p) => {
      const label = `${p.home} vs ${p.away} — ${p.selection}`.toLowerCase();
      return !rejected.includes(label);
    });
    // Only trim when at least one leg survived and something was actually cut.
    if (kept.length > 0 && kept.length < finalPicks.length) finalPicks = kept;
  }

  const code = generateBetCode(config.sports, finalPicks, config.mode);

  const finalOdds = combinedOdds(finalPicks);
  const finalTargetMet =
    config.targetCombinedOdds !== undefined && finalOdds >= config.targetCombinedOdds;
  const slipProb =
    config.mode === "mixed"
      ? Math.round(finalPicks.reduce((a, p) => a * (p.consensusProb / 100), 1) * 10000) / 100
      : undefined;
  // Slip-level value metrics: EV of the whole acca at combined odds, and the
  // Kelly stake the consensus implies for the full slip.
  const slipEv =
    config.mode === "mixed" && finalOdds > 0 && slipProb
      ? Math.round((slipProb / 100 * finalOdds - 1) * 1000) / 10
      : undefined;
  const slipKelly =
    config.mode === "mixed" && finalOdds > 1 && slipProb
      ? Math.round(kellyPct(finalOdds, slipProb / 100) * 10) / 10
      : undefined;
  const result: GenerateResult = {
    source,
    generatedAt: new Date().toISOString(),
    date: new Date().toISOString().slice(0, 10),
    config,
    code,
    mode: config.mode,
    picks: finalPicks,
    safeByMarket,
    combinedOdds: config.mode === "mixed" ? finalOdds : undefined,
    combinedProb: slipProb,
    slipEv,
    slipKelly,
    targetOddsAchieved:
      config.targetCombinedOdds !== undefined ? finalTargetMet : undefined,
    // In target mode, meeting the odds goal with fewer legs than requested is a success.
    partial: finalPicks.length < config.numPicks && !finalTargetMet,
    skippedSports,
    sporty,
    disclaimer:
      "Odds analysis is provided for informational purposes only. A SportyBet booking code only loads the selections into your betslip — you must review and stake it yourself. Sports betting involves risk and is not guaranteed income. Bet responsibly and only what you can afford to lose. 18+.",
  };

  return Response.json(result);
}
