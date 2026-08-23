"use client";

import { useState } from "react";
import { motion } from "motion/react";
import NumberFlow from "@number-flow/react";
import {
  Check,
  Copy,
  ExternalLink,
  Lightbulb,
  Star,
  Target,
  TriangleAlert,
} from "lucide-react";
import type { GenerateResult, Pick, SportId } from "@/lib/types";
import { dayLabel } from "@/lib/day";
import { cn } from "@/lib/utils";

const SPORT_META: Record<SportId, { label: string; icon: string }> = {
  soccer: { label: "Football", icon: "⚽" },
  basketball: { label: "Basketball", icon: "🏀" },
  tennis: { label: "Tennis", icon: "🎾" },
};

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function resultsHeading(day: string): string {
  if (day === "today") return "Today's picks";
  if (day === "tomorrow") return "Tomorrow's picks";
  if (day === "any") return "Upcoming picks";
  return `${day} picks`;
}

function safetyTone(score: number) {
  if (score >= 70) return "bg-ultra border-ultra";
  if (score >= 55) return "bg-amber-400 border-amber-400";
  return "bg-hex border-hex";
}

const GRADE_STYLE: Record<Pick["grade"], string> = {
  "A+": "border-black bg-ultra text-black",
  A: "border-ultra bg-ultra/15 text-ultra-bright",
  "B+": "border-amber-300 bg-amber-300/15 text-amber-200",
  B: "border-white/50 bg-white/10 text-zinc-200",
  C: "border-hex bg-hex/15 text-hex-bright",
};

function GradeChip({ grade }: { grade: Pick["grade"] }) {
  return (
    <span
      title="Value grade from safety score + expected value"
      className={cn(
        "brd inline-flex h-8 min-w-8 items-center justify-center px-1.5 font-mono text-sm font-bold",
        GRADE_STYLE[grade],
      )}
    >
      {grade}
    </span>
  );
}

/* segmented safety meter — 10 blocks */
function SafetyMeter({ score }: { score: number }) {
  const filled = Math.round(Math.min(100, Math.max(0, score)) / 10);
  return (
    <div className="flex shrink-0 flex-col items-end gap-1" title={`Safety ${score}/100`}>
      <div className="flex gap-[3px]">
        {Array.from({ length: 10 }).map((_, i) => (
          <motion.span
            key={i}
            initial={{ scaleY: 0 }}
            animate={{ scaleY: 1 }}
            transition={{ delay: 0.15 + i * 0.04, duration: 0.15 }}
            className={cn(
              "h-4 w-[7px] origin-bottom border",
              i < filled ? safetyTone(score) : "border-white/25 bg-transparent",
            )}
          />
        ))}
      </div>
      <span className="font-mono text-[11px] font-bold uppercase text-zinc-300">
        safety <NumberFlow value={score} />
      </span>
    </div>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="brd border-white/20 bg-white/[0.04] px-2 py-1.5">
      <p className="font-mono text-[10px] font-semibold uppercase tracking-wider text-zinc-300">{label}</p>
      <p className="font-mono text-sm font-bold text-white">{children}</p>
    </div>
  );
}

function FormStrip({ form }: { form: string }) {
  return (
    <span className="flex gap-0.5">
      {form.slice(-6).toUpperCase().split("").map((ch, i) => (
        <span
          key={i}
          className={cn(
            "inline-flex h-5 w-5 items-center justify-center border border-black/40 font-mono text-[10px] font-bold",
            ch === "W" && "bg-ultra text-black",
            ch === "D" && "bg-amber-300 text-black",
            ch === "L" && "bg-hex text-black",
            ch !== "W" && ch !== "D" && ch !== "L" && "border-white/20 bg-transparent text-zinc-500",
          )}
        >
          {ch}
        </span>
      ))}
    </span>
  );
}

function PickCard({ pick, index }: { pick: Pick; index: number }) {
  return (
    <motion.article
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: Math.min(index * 0.07, 0.5), ease: [0.22, 1, 0.36, 1] }}
      className="brd group relative overflow-hidden bg-panel p-4 hard press press-ink sm:p-5"
    >
      <div className="absolute top-0 left-0 h-full w-1 bg-ultra opacity-0 transition-opacity group-hover:opacity-100" />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="tag text-zinc-300">
            pick_{String(index + 1).padStart(2, "0")} · {SPORT_META[pick.sport].icon}{" "}
            {SPORT_META[pick.sport].label} · {pick.league}
          </p>
          <h3 className="mt-1 truncate text-lg font-bold uppercase tracking-tight text-zinc-100">
            {pick.home} <span className="text-zinc-500">vs</span> {pick.away}
          </h3>
          <p className="mt-0.5 font-mono text-xs text-zinc-300">{formatTime(pick.commenceTime)}</p>
        </div>
        <SafetyMeter score={pick.safetyScore} />
      </div>

      <div className="mt-4 flex flex-wrap items-stretch gap-2">
        <span className="brd inline-flex items-center border-white/30 px-2 font-mono text-[11px] uppercase text-zinc-300">
          {pick.marketLabel}
        </span>
        {pick.period && (
          <span className="brd inline-flex items-center border-ultra/50 px-2 font-mono text-[11px] uppercase text-ultra-bright">
            {pick.period}
          </span>
        )}
        <span className="brd inline-flex items-center bg-ultra px-3 py-1 font-mono text-sm font-bold text-black">
          {pick.selection}
        </span>
        <span className="brd ml-auto inline-flex items-center gap-2 bg-white px-3 py-1 font-mono text-lg leading-snug font-bold text-black">
          <NumberFlow value={pick.bestOdds} format={{ minimumFractionDigits: 2 }} />
          <Star className="h-3 w-3 self-center opacity-50" fill="currentColor" />
        </span>
        <GradeChip grade={pick.grade} />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="consensus">{pick.consensusProb}%</Stat>
        <Stat label="books">{pick.bookmakerCount}</Stat>
        <Stat label="ev">
          <span className={pick.ev >= 0 ? "text-ultra-bright" : "text-red-400"}>
            {pick.ev >= 0 ? "+" : ""}
            {pick.ev}%
          </span>
        </Stat>
        <Stat label="kelly stake">{pick.kelly > 0 ? `${pick.kelly}%` : "—"}</Stat>
        <Stat label="price edge">
          <span className={pick.priceSpread >= 2 ? "text-ultra-bright" : ""}>
            {pick.priceSpread >= 0 ? "+" : ""}
            {pick.priceSpread}%
          </span>
        </Stat>
        <Stat label="range">
          {pick.oddsMin.toFixed(2)}–{pick.oddsMax.toFixed(2)}
        </Stat>
      </div>

      {pick.rationale.length > 0 && (
        <ul className="mt-3 space-y-1 border-l-2 border-ultra/60 pl-3">
          {pick.rationale.map((r, i) => (
            <li key={i} className="font-mono text-[11px] leading-relaxed text-zinc-300">
              <span className="mr-1.5 text-ultra-bright">▸</span>
              {r}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3">
        <p className="tag mb-1.5 flex items-center justify-between text-zinc-500">
          best price per bookmaker
          <span className="text-ultra-bright">★ = best</span>
        </p>
        <div className="flex flex-wrap gap-1.5">
          {pick.bookmakerOdds.map((bo) => {
            const isBest = bo.odds === pick.bestOdds;
            return (
              <span
                key={`${bo.bookmaker}-${bo.odds}`}
                className={cn(
                  "inline-flex items-center gap-1.5 px-2 py-1 font-mono text-xs",
                  isBest
                    ? "brd border-ultra bg-ultra/15 font-bold text-ultra-bright"
                    : "border border-white/20 text-zinc-300",
                )}
              >
                {bo.bookmaker}
                <NumberFlow value={bo.odds} format={{ minimumFractionDigits: 2 }} />
                {isBest && <Star className="h-2.5 w-2.5" fill="currentColor" />}
              </span>
            );
          })}
        </div>
      </div>

      {pick.teamIntel && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2, duration: 0.35 }}
          className="brd mt-3 border-sky-400/60 bg-sky-950/30 p-3"
        >
          <p className="tag mb-2 font-bold text-sky-300">
            <span className="mr-1">{"///"}</span> deep analysis
          </p>
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="w-10 shrink-0 truncate font-mono text-xs text-zinc-500">{pick.home.split(" ").pop()}:</span>
              <FormStrip form={pick.teamIntel.homeForm} />
              {pick.teamIntel.homePosition !== null && (
                <span className="font-mono text-xs text-zinc-500">#{pick.teamIntel.homePosition}</span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="w-10 shrink-0 truncate font-mono text-xs text-zinc-500">{pick.away.split(" ").pop()}:</span>
              <FormStrip form={pick.teamIntel.awayForm} />
              {pick.teamIntel.awayPosition !== null && (
                <span className="font-mono text-xs text-zinc-500">#{pick.teamIntel.awayPosition}</span>
              )}
            </div>

            {(pick.teamIntel.modelHome !== null || pick.teamIntel.modelAway !== null) && (
              <div className="mt-1 border border-white/10 bg-black/40 px-3 py-2">
                <p className="tag mb-1.5 text-zinc-500">model win probabilities</p>
                <div className="flex h-8 items-end gap-1">
                  {([
                    { label: "H", value: pick.teamIntel.modelHome, bar: "bg-sky-400" },
                    { label: "D", value: pick.teamIntel.modelDraw, bar: "bg-amber-300" },
                    { label: "A", value: pick.teamIntel.modelAway, bar: "bg-violet-400" },
                  ] as { label: string; value: number | null; bar: string }[]).map(({ label, value, bar }) =>
                    value !== null ? (
                      <div key={label} className="flex flex-col items-center gap-0.5" style={{ width: "32px" }}>
                        <span className="font-mono text-[9px] text-zinc-400">{Math.round(value * 100)}%</span>
                        <motion.div
                          initial={{ height: 0 }}
                          animate={{ height: `${Math.max(4, Math.round(value * 28))}px` }}
                          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1], delay: 0.3 }}
                          className={cn("w-full", bar)}
                        />
                        <span className="font-mono text-[9px] text-zinc-500">{label}</span>
                      </div>
                    ) : null
                  )}
                </div>
              </div>
            )}

            <p className="text-sm text-zinc-300">{pick.teamIntel.h2hNote}</p>
            {pick.teamIntel.advice && (
              <p className="flex items-start gap-1.5 font-medium text-sky-300">
                <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {pick.teamIntel.advice}
              </p>
            )}
            {pick.teamIntel.goalsAdvice && (
              <p className="font-mono text-xs text-zinc-500">goals: {pick.teamIntel.goalsAdvice}</p>
            )}
          </div>
        </motion.div>
      )}
    </motion.article>
  );
}

function BetCodeBanner({ result, stake }: { result: GenerateResult; stake: number }) {
  const [copied, setCopied] = useState(false);

  async function copy(text: string) {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const potentialReturn =
    result.mode === "mixed" && result.combinedOdds
      ? Math.round(stake * result.combinedOdds * 100) / 100
      : result.picks.reduce((sum, p) => sum + Math.round(stake * p.bestOdds * 100) / 100, 0);

  const today = new Date(result.date).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  const sportsLabel = result.config.sports.map((s) => SPORT_META[s].label).join(" + ");
  const real = result.sporty?.shareCode ?? null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      className="relative"
    >
      {/* paper slip */}
      <div className="ticket ticket-perf rotate-[-0.35deg] bg-[#f4f4f5] p-4 text-black shadow-[6px_6px_0_#a259ff] sm:p-6 md:p-8">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-600">
              strange bets · official slip
            </p>
            <p className="tag mt-1 font-bold text-black normal-case tracking-normal text-sm">
              {result.mode === "mixed" ? "Mixed accumulator" : "Single bets"} · {sportsLabel} ·{" "}
              {result.picks.length} picks
            </p>
          </div>
          <span className="brd -rotate-2 border-black bg-ultra px-2 py-1 font-mono text-[10px] font-bold uppercase">
            {today}
          </span>
        </div>

        {real ? (
          <>
            <div className="mt-5 flex flex-wrap items-center justify-between gap-4 border-y-2 border-dashed border-black/30 py-5">
              <div className="min-w-0">
                <p className="font-mono text-[10px] uppercase tracking-widest text-zinc-600">
                  booking code — paste in app
                </p>
                <p className="mt-1 inline-block max-w-full break-all bg-black px-4 py-1.5 font-mono text-2xl font-bold tracking-[0.2em] text-ultra-bright sm:text-3xl md:text-4xl">
                  {real}
                </p>
              </div>
              <div className="flex flex-col gap-2">
                <motion.button
                  whileTap={{ scale: 0.95 }}
                  onClick={() => copy(real)}
                  className={cn(
                    "brd inline-flex items-center justify-center gap-2 border-black px-5 py-2.5 font-mono text-sm font-bold uppercase transition-colors",
                    copied ? "bg-black text-ultra-bright" : "bg-white press press-ink hover:bg-ultra",
                  )}
                >
                  {copied ? (
                    <>
                      <Check className="h-4 w-4" /> Copied
                    </>
                  ) : (
                    <>
                      <Copy className="h-4 w-4" /> Copy code
                    </>
                  )}
                </motion.button>
                {result.sporty?.shareURL && (
                  <motion.a
                    whileTap={{ scale: 0.95 }}
                    href={result.sporty.shareURL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="brd press press-ink inline-flex items-center justify-center gap-1.5 border-black bg-black px-5 py-2.5 font-mono text-sm font-bold uppercase text-ultra-bright"
                  >
                    Open SportyBet <ExternalLink className="h-3.5 w-3.5" />
                  </motion.a>
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="mt-5 border-y-2 border-dashed border-black/30 py-4">
            <p className="inline-flex items-center gap-1.5 bg-hex px-2 py-1 font-mono text-xs font-bold uppercase text-black">
              <TriangleAlert className="h-3.5 w-3.5" />
              no booking code issued
            </p>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-zinc-700">
              None of the selections could be matched to live SportyBet events (e.g. a tennis totals pick, a
              friendly fixture SportyBet doesn&rsquo;t carry, or the odds source is unavailable). The picks above
              are still valid — build the slip manually in your bookmaker.
            </p>
          </div>
        )}

        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {result.mode === "mixed" && result.combinedOdds ? (
            <>
              <div className="brd border-black/70 px-3 py-2">
                <p className="font-mono text-[10px] uppercase tracking-wide text-zinc-600">combined odds</p>
                <p className="font-mono text-lg font-bold">
                  <NumberFlow value={result.combinedOdds} format={{ minimumFractionDigits: 2 }} />x
                  {result.targetOddsAchieved !== undefined && (
                    <span className={`ml-2 align-middle font-mono text-[10px] font-bold uppercase ${result.targetOddsAchieved ? "text-ultra-bright" : "text-hex-bright"}`}>
                      {result.targetOddsAchieved ? "target met" : "below target"}
                      {result.config.targetCombinedOdds ? ` (${result.config.targetCombinedOdds}x)` : ""}
                    </span>
                  )}
                </p>
              </div>
              <div className="brd border-black/70 px-3 py-2">
                <p className="font-mono text-[10px] uppercase tracking-wide text-zinc-600">implied win</p>
                <p className="font-mono text-lg font-bold">{result.combinedProb}%</p>
              </div>
              {typeof result.slipEv === "number" && (
                <div className="brd border-black/70 px-3 py-2">
                  <p className="font-mono text-[10px] uppercase tracking-wide text-zinc-600">slip value (EV)</p>
                  <p className={`font-mono text-lg font-bold ${result.slipEv >= 0 ? "text-ultra-bright" : "text-hex-bright"}`}>
                    {result.slipEv >= 0 ? "+" : ""}
                    {result.slipEv}%
                  </p>
                </div>
              )}
              {typeof result.slipKelly === "number" && result.slipKelly > 0 && (
                <div className="brd border-black/70 px-3 py-2">
                  <p className="font-mono text-[10px] uppercase tracking-wide text-zinc-600">kelly stake</p>
                  <p className="font-mono text-lg font-bold">{result.slipKelly}%</p>
                </div>
              )}
            </>
          ) : (
            <div className="brd border-black/70 px-3 py-2">
              <p className="font-mono text-[10px] uppercase tracking-wide text-zinc-600">picks</p>
              <p className="font-mono text-lg font-bold">
                <NumberFlow value={result.picks.length} />
              </p>
            </div>
          )}
          <div className="brd border-black bg-black px-3 py-2 text-[#f4f4f5] sm:col-span-2">
            <p className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wide text-zinc-400">
              <Target className="h-3 w-3 text-ultra-bright" />
              stake ₦{stake.toLocaleString()} → potential return
            </p>
            <p className="font-mono text-lg font-bold text-ultra-bright">
              ₦<NumberFlow value={potentialReturn} format={{ maximumFractionDigits: 0 }} />
            </p>
          </div>
        </div>

        {real && result.sporty && result.sporty.outcomes.length > 0 && (
          <div className="mt-5 flex flex-wrap gap-2">
            {result.sporty.outcomes.map((o, i) => (
              <span key={i} className="border border-black/50 bg-white px-2 py-1 font-mono text-[11px]">
                <span className="font-bold">{o.home}</span> vs {o.away}
                <span className="mx-1 text-zinc-500">·</span>
                {o.selection}
                <span className="mx-1 text-zinc-500">@</span>
                <span className="font-bold">{o.odds}</span>
              </span>
            ))}
          </div>
        )}

        {real && result.sporty && result.sporty.unavailable.length > 0 && (
          <p className="mt-3 bg-hex/20 px-3 py-2 font-mono text-xs text-red-800">
            ⚠ {result.sporty.unavailable.length} pick(s) couldn&rsquo;t be booked and were excluded:
            {result.sporty.unavailable.join(", ")}
          </p>
        )}

        {/* barcode footer */}
        <div className="mt-6 flex items-end gap-3 border-t-2 border-dashed border-black/30 pt-4">
          <div className="barcode flex-1 opacity-80" />
          <p className="max-w-[16rem] text-right font-mono text-[9px] leading-snug text-zinc-600">
            genuine share code · loads selections into betslip · stake yourself · 18+
          </p>
        </div>
      </div>
    </motion.div>
  );
}

function SafeGames({ result }: { result: GenerateResult }) {
  const [active, setActive] = useState(0);
  const sections = result.safeByMarket.filter((s) => s.picks.length > 0);
  if (sections.length === 0) return null;
  const current = sections[Math.min(active, sections.length - 1)];

  return (
    <div>
      <h2 className="text-xl font-bold uppercase tracking-tight text-white sm:text-2xl">
        Safe games <span className="text-ultra-bright">by market_</span>
      </h2>
      <p className="tag mt-1 text-zinc-400">most consensus-backed pick per odds type</p>

      <div className="mt-4 flex flex-wrap gap-2">
        {sections.map((s, i) => {
          const isActive = i === Math.min(active, sections.length - 1);
          return (
            <button
              key={s.market}
              onClick={() => setActive(i)}
              className={cn(
                "brd px-3.5 py-1.5 font-mono text-xs font-bold uppercase transition-all",
                isActive
                  ? "-translate-y-0.5 bg-ultra text-black hard-sm"
                  : "border-white/30 text-zinc-300 hover:border-ultra hover:text-ultra-bright",
                )}
              >
                [{s.marketLabel}]
            </button>
          );
        })}
      </div>

      <motion.div
        key={current.market}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28 }}
        className="mt-4 grid gap-3 md:grid-cols-2"
      >
        {current.picks.map((pick, i) => (
          <motion.div
            key={pick.gameId + pick.selection}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, delay: i * 0.06, ease: [0.22, 1, 0.36, 1] }}
            className="brd bg-panel p-4 hard press press-ink"
          >
            <div className="flex items-start justify-between gap-3">
              <p className="min-w-0 truncate text-sm font-bold uppercase text-zinc-200">
                {pick.home} vs {pick.away}
              </p>
              <SafetyMeter score={pick.safetyScore} />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="bg-ultra px-2 py-0.5 font-mono text-xs font-bold text-black">
                {pick.selection}
              </span>
              <NumberFlow
                value={pick.bestOdds}
                format={{ minimumFractionDigits: 2 }}
                className="font-mono text-base font-bold text-zinc-100"
              />
              <GradeChip grade={pick.grade} />
              <span className="font-mono text-[10px] text-zinc-300">
                avg {pick.avgOdds.toFixed(2)} · {pick.oddsMin.toFixed(2)}–{pick.oddsMax.toFixed(2)}
              </span>
              <span className={cn("ml-auto font-mono text-[11px]", pick.ev >= 0 ? "text-ultra-bright" : "text-red-400")}>
                EV {pick.ev >= 0 ? "+" : ""}{pick.ev}%
              </span>
            </div>
          </motion.div>
        ))}
      </motion.div>
    </div>
  );
}

export function Results({ result, stake }: { result: GenerateResult; stake: number }) {
  const sourceLabel =
    result.source === "live"
      ? "Live odds from The Odds API"
      : result.source === "catalog-fallback"
        ? "Simulated odds · real SportyBet fixtures (Odds API unavailable)"
        : result.source === "mock-fallback"
          ? "Demo data (live API unavailable — check your ODDS_API_KEY)"
          : "Demo data (add your ODDS_API_KEY for live odds)";

  const grouped = result.config.sports
    .filter((s) => result.picks.some((p) => p.sport === s))
    .map((sport) => ({
      sport,
      meta: SPORT_META[sport],
      picks: result.picks.filter((p) => p.sport === sport),
    }));

  return (
    <div className="animate-fade-up mt-10 space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b-2 border-dashed border-white/20 pb-3">
        <h2 className="text-xl font-bold uppercase tracking-tight text-white sm:text-2xl">
          {resultsHeading(result.config.day)}
        </h2>
        <span className="sticker max-w-full whitespace-normal text-left text-[10px] leading-snug sm:text-[11px]">{sourceLabel} · {dayLabel(result.config.day)}</span>
      </div>

      {result.partial && (
        <p className="brd border-amber-400/70 bg-amber-400/10 px-4 py-3 text-sm text-amber-200 hard-sm">
          Only {result.picks.length} of your {result.config.numPicks} requested picks matched the odds range — try
          widening it, picking a different day, or adding more odds types for a deeper accumulator.
          {result.skippedSports.length > 0 && (
            <span className="mt-1 block font-mono text-xs">
              skipped: {result.skippedSports.map((s) => SPORT_META[s].label).join(", ")} — no games that day.
            </span>
          )}
        </p>
      )}

      <BetCodeBanner result={result} stake={stake} />

      <div className="space-y-6">
        {grouped.map((group) => (
          <section key={group.sport}>
            <div className="mb-3 flex items-center gap-2">
              <span className="text-lg">{group.meta.icon}</span>
              <h3 className="tag font-bold text-zinc-100">{group.meta.label}</h3>
              <span className="brd border-white/30 px-2 py-0.5 font-mono text-[10px] text-zinc-400">
                {group.picks.length} picks
              </span>
            </div>
            <div className="grid gap-4">
              {group.picks.map((pick, i) => (
                <PickCard key={pick.gameId + pick.selection} pick={pick} index={i} />
              ))}
            </div>
          </section>
        ))}
      </div>

      <SafeGames result={result} />

      <p className="brd flex items-start gap-2 border-amber-400/70 bg-amber-950/40 px-4 py-3 text-xs leading-relaxed text-amber-200">
        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
        {result.disclaimer}
      </p>
    </div>
  );
}
