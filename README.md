# Strange Bets 👻

A sports betting agent site. Pick a sport, choose your odds types, number of picks, and single vs mixed
(accumulator). It pulls live odds from dozens of bookmakers via [The Odds API](https://the-odds-api.com),
runs an expert consensus engine across every game, ranks the safest options, and gives you a shareable
Sporty code to book the picks in your bookmaker app.

## Features

- **Sports & mixed accumulators**: Football, Basketball and Tennis in one slip — a single SportyBet code books selections across sports (verified live)
- **Markets**: Football (1X2, Over/Under, Asian Handicap, **Both Teams To Score**, **Double Chance**, **Draw No Bet**, **Odd/Even**), Basketball (Moneyline, Spreads, Totals), Tennis (Match Winner)
- **Game day picker**: today / tomorrow / all days, local-timezone aware — the picks only come from the day you asked for
- **League filters**: pick specific competitions (EPL, La Liga, Serie A, Bundesliga, Ligue 1, UCL, NBA, ATP, …)
- **Club & International Friendlies** (football): a `soccer_friendlies` league backed by API-Football (league 667) that shows when friendly fixtures exist; games are fetched for a ±1-day window with a 5-min cache and capped at 3 games to respect API-Football's 10 req/min budget. Friendly picks are often skipped by SportyBet booking (fixtures rarely in the SportyBet catalog) and return as a reference code instead.
- **Expert analysis**: consensus implied probability across all bookmakers, agreement score, safety rating, and expected value (EV); advanced football markets (BTTS, Double Chance, DNB, Odd/Even) are derived from a Poisson model calibrated to the market's total-goals consensus
- **Team analysis** (football, via API-Football): last-5 form, league positions, head-to-head history, and a model win-probability blend on top of market consensus
- **Safe games by odds type**: the most consensus-backed pick per market you selected
- **Real SportyBet booking codes** (all 3 sports, free, no API key): the app talks to SportyBet's own public API via a small Python sidecar (`scripts/sportybet_api.py`, Chrome TLS impersonation via `curl_cffi`) and returns a genuine share code + load link that fills your betslip instantly
- **Live or demo**: live odds when `ODDS_API_KEY` is set; otherwise runs on realistic mock odds

## Setup

```bash
npm install
cp .env.example .env.local   # add your API keys
python3 -m venv ~/.sportybet-venv && ~/.sportybet-venv/bin/pip install curl_cffi
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The `curl_cffi` venv is the only setup SportyBet codes need.

### API keys (all have free tiers)

| Key | Where | What it powers | Free limit |
| --- | --- | --- | --- |
| `ODDS_API_KEY` | https://the-odds-api.com | Live cross-bookmaker odds + consensus | 500 req/mo |
| `APIFOOTBALL_KEY` | https://dashboard.api-football.com | Team form, H2H, standings, model predictions, **friendlies fixtures** | 100 req/day |
| `SPORTYBET_PYTHON` | (set in `.env.example`) | Path to the venv used for **real SportyBet booking codes** | Free — no key needed |

The app degrades gracefully: no `ODDS_API_KEY` → mock odds; Odds API quota exhausted or no games on the chosen day → seeded demo games (labeled "Demo data") so picks always generate; no SportyBet match found for a pick → reference code for that slip (e.g. tennis totals, which SportyBet doesn't expose via the booking API); no `APIFOOTBALL_KEY` → market analysis only (no team intel, no friendlies).

## How the analysis works

1. For each game, every bookmaker's odds are converted to margin-removed implied probabilities.
2. A candidate pick's **consensus probability** is the average across all bookmakers that price it.
3. **Agreement** measures how much bookmakers disagree (lower spread = safer market).
4. **Safety score** = consensus probability adjusted by agreement (capped at 99).
5. **EV** compares consensus probability against the best available price to flag value.
6. **Derived football markets** (BTTS, Double Chance, Draw No Bet, Odd/Even): since free odds APIs don't expose these, a Poisson model is calibrated to the market's over/under 2.5 consensus to estimate expected goals, then split by the home/away probability share to price each market at fair odds.
7. For football, team form / H2H / standings and a model probability are blended (40%) into the pick.
8. Picks are ranked by safety, filtered to your odds range, one per game.
9. Picks are matched to SportyBet events (fuzzy team matching) and booked via SportyBet's own public `orders/share` API through the sidecar, returning a real share code.

## Deploying to Vercel

The app itself is a standard Next.js app and deploys to Vercel as-is. The one
catch: SportyBet blocks plain HTTP clients with TLS fingerprinting, so booking
codes are produced by a tiny sidecar (`scripts/sportybet_api.py`) that must run
somewhere long-running (Render / Railway / Fly.io / any always-on box).

1. **Host the sidecar** (one small service):
   ```bash
   pip install curl_cffi
   SPORTYBET_TOKEN=$(openssl rand -hex 24) python scripts/sportybet_server.py
   ```
   Deploy those two files anywhere that runs Python, or run it on a home server.
   Note the public URL (e.g. `https://your-sidecar.onrender.com`) and the token.

2. **Deploy the app**:
   ```bash
   npx vercel login
   npx vercel        # link the project (accept defaults)
   npx vercel --prod # ship it
   ```
   Or push to GitHub and import the repo at vercel.com/new.

3. **Environment variables** (Vercel → Project → Settings → Environment Variables,
   copy from `.env.example`):
   | Variable | Required | Purpose |
   |---|---|---|
   | `ODDS_API_KEY` | yes (live odds) | [the-odds-api.com](https://the-odds-api.com) key |
   | `SPORTYBET_SIDECAR_URL` | for booking codes | URL of your hosted sidecar |
   | `SPORTYBET_SIDECAR_TOKEN` | recommended | shared secret sent as `x-sidecar-token` |
   | `APIFOOTBALL_KEY` | optional | deeper soccer analysis + friendlies |
   | `FRIENDLIES_LEAGUE_ID` | optional | defaults to 667 |

Without `SPORTYBET_SIDECAR_URL` the app works fine but booking codes are only
available in local development.

## Disclaimer

A SportyBet booking code only loads selections into your betslip — it does not place a wager. You must review and stake yourself. Odds analysis is informational only. Sports betting involves risk and is not guaranteed income. Bet responsibly and only what you can afford to lose. 18+.

## Tech

Next.js 16 (App Router, Tailwind CSS v4), TypeScript. API routes: `/api/sports`, `/api/generate`.