import { listSportLeagues } from "@/lib/odds";
import type { SportId } from "@/lib/types";

const VALID_SPORTS = ["soccer", "basketball", "tennis"] as const;

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const raw = url.searchParams.get("sport");
  const sport = (VALID_SPORTS as readonly string[]).includes(raw ?? "")
    ? (raw as SportId)
    : null;

  if (!sport) {
    return Response.json({ error: "Missing or invalid 'sport' query param." }, { status: 400 });
  }

  const leagues = await listSportLeagues(sport);
  return Response.json({ sport, leagues });
}
