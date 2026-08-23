import { createHash } from "node:crypto";
import type { Pick, SportId } from "@/lib/types";

function luhnDigit(partial: string): number {
  let sum = 0;
  let double = true;
  for (let i = partial.length - 1; i >= 0; i--) {
    let d = partial.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return (10 - (sum % 10)) % 10;
}

export function generateBetCode(sports: SportId[], picks: Pick[], mode: "single" | "mixed"): string {
  if (picks.length === 0) {
    throw new Error("Cannot generate a bet code with no picks");
  }

  const canonical = [
    sports.join(","),
    mode,
    String(picks.length),
    ...picks.map((p) => `${p.sport}|${p.gameId}|${p.market}|${p.selection}|${p.bestOdds}`),
  ].join("::");

  const hash = createHash("sha256").update(canonical).digest();

  let digits = "";
  for (const byte of hash) {
    digits += String(byte % 10);
    if (digits.length >= 11) break;
  }
  while (digits.length < 11) digits += "0";

  const check = luhnDigit(digits);
  return digits + String(check);
}
