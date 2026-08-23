import type { Game, TeamIntel } from "@/lib/types";

const BASE = "https://v3.football.api-sports.io";

const FIXTURES_TTL = 60 * 60_000;
const PREDICTION_TTL = 60 * 60_000;
const fixturesCache = new Map<string, { at: number; fixtures: FixtureRef[] }>();
const predictionCache = new Map<string, { at: number; data: { intel: TeamIntel; model: ModelPrediction } }>();

function apiKey(): string | undefined {
  return process.env.APIFOOTBALL_KEY;
}

export function intelEnabled(): boolean {
  return Boolean(apiKey());
}

function normalizeTeam(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\b(fc|cf|afc|sc|ac|fk|sk|kv|jv|sv|vfb|ssc|club|team|nu)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function teamMatch(a: string, b: string): boolean {
  const na = normalizeTeam(a);
  const nb = normalizeTeam(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.length >= 4 && nb.length >= 4 && (na.includes(nb) || nb.includes(na))) return true;
  return false;
}

interface FixtureRef {
  id: number;
  home: string;
  away: string;
}

interface ModelPrediction {
  home: number | null;
  draw: number | null;
  away: number | null;
}

export interface IntelData {
  intel: TeamIntel;
  model: ModelPrediction;
}

function asNum(v: unknown): number | null {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = parseFloat(v);
    return Number.isNaN(n) ? null : n;
  }
  return null;
}

async function fetchJson(path: string, key: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(`${BASE}${path}`, { headers: { "x-apisports-key": key } });
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  } catch (err) {
    console.error("API-Football request failed:", err);
    return null;
  }
}

async function fetchFixtures(key: string, date: string): Promise<FixtureRef[]> {
  const cached = fixturesCache.get(date);
  if (cached && Date.now() - cached.at < FIXTURES_TTL) return cached.fixtures;

  const data = await fetchJson(`/fixtures?date=${date}`, key);
  if (!data) return fixturesCache.get(date)?.fixtures ?? [];
  const response = data["response"];
  if (!Array.isArray(response)) return fixturesCache.get(date)?.fixtures ?? [];
  const fixtures: FixtureRef[] = [];
  for (const raw of response as Record<string, unknown>[]) {
    const fixture = raw["fixture"] as Record<string, unknown> | undefined;
    const teams = raw["teams"] as Record<string, unknown> | undefined;
    const home = teams?.["home"] as Record<string, unknown> | undefined;
    const away = teams?.["away"] as Record<string, unknown> | undefined;
    const id = fixture?.["id"];
    const homeName = typeof home?.["name"] === "string" ? home["name"] : "";
    const awayName = typeof away?.["name"] === "string" ? away["name"] : "";
    if (typeof id === "number" && homeName && awayName) {
      fixtures.push({ id, home: homeName, away: awayName });
    }
  }
  fixturesCache.set(date, { at: Date.now(), fixtures });
  return fixtures;
}

function matches(g: Game, f: FixtureRef): boolean {
  return teamMatch(g.home_team, f.home) && teamMatch(g.away_team, f.away);
}

function parsePercent(v: unknown): number | null {
  if (typeof v !== "string") return null;
  const m = v.match(/(\d+(?:\.\d+)?)/);
  return m ? Math.min(100, Math.max(0, parseFloat(m[1]))) / 100 : null;
}

async function fetchPrediction(key: string, fixtureId: number): Promise<{
  intel: TeamIntel;
  model: ModelPrediction;
} | null> {
  const data = await fetchJson(`/predictions?fixture=${fixtureId}`, key);
  if (!data) return null;
  const response = data["response"];
  if (!Array.isArray(response) || response.length === 0) return null;
  const pred = response[0] as Record<string, unknown>;

  const predictions = (pred["predictions"] ?? {}) as Record<string, unknown>;
  const winnerRaw = predictions["winner"];
  const modelWinner =
    typeof winnerRaw === "string"
      ? winnerRaw
      : typeof winnerRaw === "object" && winnerRaw !== null
        ? String((winnerRaw as Record<string, unknown>)["name"] ?? "")
        : "";
  const advice = typeof predictions["advice"] === "string" ? predictions["advice"] : null;

  const teams = (pred["teams"] ?? {}) as Record<string, unknown>;
  const homeTeams = (teams["home"] ?? {}) as Record<string, unknown>;
  const awayTeams = (teams["away"] ?? {}) as Record<string, unknown>;
  const homeLeague = (homeTeams["league"] ?? {}) as Record<string, unknown>;
  const awayLeague = (awayTeams["league"] ?? {}) as Record<string, unknown>;
  const homeForm = typeof homeLeague["form"] === "string" ? homeLeague["form"] : "n/a";
  const awayForm = typeof awayLeague["form"] === "string" ? awayLeague["form"] : "n/a";
  const homePosition = asNum(homeLeague["position"]);
  const awayPosition = asNum(awayLeague["position"]);

  const comparison = (pred["comparison"] ?? {}) as Record<string, unknown>;
  const poisson = (comparison["poisson_distribution"] ?? {}) as Record<string, unknown>;
  const poissonValue = (v: unknown): number | null =>
    typeof v === "string"
      ? parsePercent(v)
      : typeof v === "object" && v !== null
        ? parsePercent((v as Record<string, unknown>)["all"])
        : null;
  const model: ModelPrediction = {
    home: poissonValue(poisson["home"]),
    draw: null,
    away: poissonValue(poisson["away"]),
  };

  const h2hRaw = pred["h2h"];
  const h2h: Record<string, unknown>[] = Array.isArray(h2hRaw) ? (h2hRaw as Record<string, unknown>[]) : [];
  let homeWins = 0;
  let awayWins = 0;
  let draws = 0;
  for (const m of h2h) {
    const t = (m["teams"] ?? {}) as Record<string, unknown>;
    const th = (t["home"] ?? {}) as Record<string, unknown>;
    const ta = (t["away"] ?? {}) as Record<string, unknown>;
    if (th["winner"] === true) homeWins++;
    else if (ta["winner"] === true) awayWins++;
    else draws++;
  }
  const h2hNote =
    h2h.length === 0
      ? "No recent head-to-head data."
      : `${h2h.length} recent meetings: ${homeWins} home wins, ${draws} draws, ${awayWins} away wins.`;

  const goalsAdvice = typeof predictions["goals"] === "string" ? predictions["goals"] : null;

  const intel: TeamIntel = {
    homeForm,
    awayForm,
    homePosition,
    awayPosition,
    h2hNote,
    advice: modelWinner || advice ? `${modelWinner ? `Model favours: ${modelWinner}. ` : ""}${advice ?? ""}`.trim() : null,
    modelWinner: modelWinner || null,
    modelHome: model.home,
    modelDraw: model.draw,
    modelAway: model.away,
    goalsAdvice,
  };

  return { intel, model };
}

export async function enrichGamesWithIntel(games: Game[]): Promise<Map<string, IntelData>> {
  const map = new Map<string, IntelData>();
  const key = apiKey();
  if (!key || games.length === 0) return map;

  const utcDay = (offset: number): string =>
    new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
  const fixtures: FixtureRef[] = [];
  for (const offset of [-1, 0, 1]) {
    fixtures.push(...(await fetchFixtures(key, utcDay(offset))));
  }
  if (fixtures.length === 0) return map;

  const todayFixtures: { game: Game; fixture: FixtureRef }[] = [];
  for (const game of games) {
    const fixture = fixtures.find((f) => matches(game, f));
    if (fixture) todayFixtures.push({ game, fixture });
  }

  const seen = new Set<string>();
  for (const { game, fixture } of todayFixtures.slice(0, 6)) {
    if (seen.has(fixture.id.toString())) continue;
    seen.add(fixture.id.toString());

    const cached = predictionCache.get(fixture.id.toString());
    if (cached && Date.now() - cached.at < PREDICTION_TTL) {
      map.set(game.id, cached.data);
      continue;
    }

    const result = await fetchPrediction(key, fixture.id);
    if (result) {
      predictionCache.set(fixture.id.toString(), { at: Date.now(), data: result });
      map.set(game.id, result);
    }
  }

  return map;
}
