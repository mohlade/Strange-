export function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

export function tomorrowUtc(): string {
  return new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
}

export function localDateIso(isoTime: string, offsetMin: number): string {
  return new Date(new Date(isoTime).getTime() + offsetMin * 60_000).toISOString().slice(0, 10);
}

export function dayLabel(day: string): string {
  if (day === "today") return "Today";
  if (day === "tomorrow") return "Tomorrow";
  if (day === "any") return "All days";
  return day;
}

export function resolveDay(day: string, offsetMin: number): string {
  if (day === "today") return localDateIso(new Date().toISOString(), offsetMin);
  if (day === "tomorrow") return localDateIso(new Date(Date.now() + 86_400_000).toISOString(), offsetMin);
  return day;
}

export function matchDay(commenceTime: string, day: string, offsetMin = 0): boolean {
  if (!day || day === "any") return true;
  const iso = localDateIso(commenceTime, offsetMin);
  return iso === day;
}
