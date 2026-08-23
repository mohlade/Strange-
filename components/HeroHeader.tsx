"use client";

import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { BrainCircuit, Ghost, ShieldCheck, Ticket, Zap } from "lucide-react";

const FEATURES = [
  { icon: BrainCircuit, label: "40+ bookmakers", tone: "text-ultra-bright" },
  { icon: Zap, label: "consensus engine", tone: "text-hex-bright" },
  { icon: ShieldCheck, label: "safety-rated picks", tone: "text-sky-300" },
  { icon: Ticket, label: "real booking codes", tone: "text-amber-300" },
];

const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.07, delayChildren: 0.02 } },
};
const item = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: [0.22, 1, 0.36, 1] as const } },
};

function CornerMark({ className }: { className: string }) {
  return (
    <span aria-hidden className={`pointer-events-none absolute font-mono text-xl text-white/15 select-none ${className}`}>
      +
    </span>
  );
}

export default function HeroHeader() {
  const [clock, setClock] = useState("--:--:--");

  useEffect(() => {
    const tick = () => {
      const now = new Date();
      setClock(now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  const todayCompact = new Date().toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });

  return (
    <header className="relative overflow-hidden border-b-2 border-white">
      {/* ambient glow blobs */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute -top-32 -left-24 h-80 w-80 rounded-full bg-ultra/25 blur-[110px]" />
        <div className="absolute top-4 -right-16 h-72 w-72 rounded-full bg-hex/20 blur-[110px]" />
        <div className="absolute right-[22%] -bottom-24 h-56 w-56 rounded-full bg-fuchsia-500/10 blur-[90px]" />
      </div>
      <CornerMark className="top-3 left-3 hidden sm:block" />
      <CornerMark className="top-3 right-3 hidden sm:block" />

      <motion.div
        variants={container}
        initial="hidden"
        animate="show"
        className="relative mx-auto max-w-5xl px-4 pb-10 pt-10 sm:pb-12 sm:pt-16 xl:max-w-6xl"
      >
        <motion.div variants={item} className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <motion.span
              whileHover={{ rotate: -6, scale: 1.05 }}
              transition={{ duration: 0.15 }}
              className="brd flex h-12 w-12 items-center justify-center bg-ultra hard-ink"
            >
              <Ghost className="h-6 w-6 text-black" fill="currentColor" />
            </motion.span>
            <span className="tag text-zinc-400">v3.0 / the strange odds engine</span>
          </div>
          <span className="sticker -rotate-1 bg-foreground text-black hard-sm">
            <span className="h-2.5 w-2.5 shrink-0 animate-blink bg-hex" />
            live · {todayCompact}
            <span className="mx-0.5 text-zinc-500">|</span>
            <span className="tabular-nums tracking-widest">{clock}</span>
          </span>
        </motion.div>

        <motion.h1
          variants={item}
          className="mt-8 text-[13vw] font-bold uppercase leading-[0.9] tracking-tight sm:text-7xl md:text-8xl"
        >
          Strange
          <br />
          <span className="grad-text">Bets_</span>
          <motion.span
            aria-hidden
            animate={{ opacity: [1, 1, 0, 0] }}
            transition={{ duration: 1, repeat: Infinity, times: [0, 0.5, 0.5, 1] }}
            className="ml-2 inline-block h-[0.75em] w-[0.08em] translate-y-[0.08em] bg-ultra align-baseline"
          />
        </motion.h1>

        <motion.p variants={item} className="tag mt-6 max-w-2xl text-zinc-400 normal-case tracking-normal font-normal text-base leading-relaxed">
          Strange things in the odds markets — I scan prices from dozens of bookmakers, run expert
          consensus analysis on every game, and hand you the safest options plus a SportyBet-style
          code to book it.
        </motion.p>

        <motion.div variants={item} className="mt-7 flex flex-wrap gap-2.5">
          {FEATURES.map(({ icon: Icon, label, tone }, i) => (
            <span
              key={label}
              className={`sticker -rotate-[0.5deg] text-zinc-300 ${i % 2 === 0 ? "" : "rotate-[0.75deg]"} hover:text-white hover:border-ultra transition-colors`}
            >
              <Icon className={`h-3.5 w-3.5 ${tone}`} />
              {label}
            </span>
          ))}
        </motion.div>
      </motion.div>
    </header>
  );
}
