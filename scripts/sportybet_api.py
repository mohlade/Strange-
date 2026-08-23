#!/usr/bin/env python3
"""SportyBet public API sidecar.

SportyBet's own (unauthenticated) endpoints are protected by a WAF that blocks
plain HTTP clients via TLS fingerprinting. This script uses curl_cffi with a
Chrome impersonation profile to pass that check, then talks to the same public
API SportyBet's web frontend uses:

  GET  /factsCenter/commonThumbnailEvents  -> event catalog (no auth)
  POST /orders/share                        -> create a booking code (no auth)
  GET  /orders/share/{code}                 -> load a booking code (no auth)

Usage:
  python sportybet_api.py catalog soccer        # -> JSON event list on stdout
  python sportybet_api.py catalog basketball
  python sportybet_api.py book                  # reads {"selections": [...]} from stdin
"""

import json
import random
import sys
import time

from curl_cffi import requests

BASE = "https://www.sportybet.com/api/ng"

HEADERS = {
    "Referer": "https://www.sportybet.com/ng/",
    "Accept": "application/json",
    "Accept-Language": "en-US,en;q=0.9",
    "Origin": "https://www.sportybet.com",
}

SPORT_IDS = {
    "football": "sr:sport:1",
    "soccer": "sr:sport:1",
    "basketball": "sr:sport:2",
    "tennis": "sr:sport:5",
}


def _get(path, params=None):
    time.sleep(random.uniform(0.4, 1.0))
    r = requests.get(BASE + path, headers=HEADERS, params=params, impersonate="chrome131", timeout=20)
    if r.status_code != 200:
        return None
    data = r.json()
    if data.get("bizCode") != 10000:
        return None
    return data


def _post(path, payload):
    time.sleep(random.uniform(0.3, 0.8))
    headers = dict(HEADERS)
    headers["Content-Type"] = "application/json"
    r = requests.post(BASE + path, headers=headers, json=payload, impersonate="chrome131", timeout=20)
    if r.status_code != 200:
        return None
    data = r.json()
    if data.get("bizCode") != 10000:
        return None
    return data


def cmd_catalog(sport):
    sport_id = SPORT_IDS.get(sport, SPORT_IDS["football"])
    data = _get("/factsCenter/commonThumbnailEvents", {"sportId": sport_id, "marketId": "1"})
    if not data:
        print(json.dumps({"error": "catalog_unavailable"}))
        return

    events = []
    for group in data.get("data") or []:
        if not isinstance(group, dict):
            continue
        for ev in group.get("events") or []:
            home = ev.get("homeTeamName") or ""
            away = ev.get("awayTeamName") or ""
            if not home or not away:
                continue
            tournament = ((ev.get("sport") or {}).get("category") or {}).get("tournament") or {}
            name = tournament.get("name") or ""
            if "SRL" in name:
                continue
            events.append(
                {
                    "eventId": ev.get("eventId", ""),
                    "home": home,
                    "away": away,
                    "startTime": ev.get("estimateStartTime") or 0,
                    "tournament": name,
                }
            )

    print(json.dumps({"events": events}))


def cmd_book():
    try:
        payload = json.loads(sys.stdin.read() or "{}")
    except (json.JSONDecodeError, ValueError):
        print(json.dumps({"error": "bad_payload"}))
        return

    selections = payload.get("selections") or []
    if not selections:
        print(json.dumps({"error": "no_selections"}))
        return

    def _try(sel):
        return _post("/orders/share", {"selections": sel})

    def _format(data, extra_unavailable=None):
        body = data.get("data") or {}
        outcomes = []
        for o in body.get("outcomes") or []:
            markets = o.get("markets") or []
            market = markets[0] if markets else {}
            market_outcomes = market.get("outcomes") or []
            chosen = market_outcomes[0] if market_outcomes else {}
            tournament = ((o.get("sport") or {}).get("category") or {}).get("tournament") or {}
            outcomes.append(
                {
                    "selection": chosen.get("desc") or o.get("selectedOutcome"),
                    "home": o.get("homeTeamName"),
                    "away": o.get("awayTeamName"),
                    "odds": chosen.get("odds") or o.get("odds"),
                    "tournament": tournament.get("name") or o.get("tournament"),
                    "market": market.get("desc") or o.get("marketDesc"),
                }
            )
        unavailable = list(body.get("unavailableOutcomes") or [])
        if extra_unavailable:
            for s in extra_unavailable:
                if isinstance(s, dict) and s.get("label"):
                    unavailable.append(s["label"])
                else:
                    unavailable.append(str(s))
        print(
            json.dumps(
                {
                    "shareCode": body.get("shareCode"),
                    "shareURL": body.get("shareURL"),
                    "deadline": body.get("deadline"),
                    "outcomes": outcomes,
                    "unavailable": unavailable,
                }
            )
        )

    data = _try(selections)
    if data:
        _format(data)
        return

    # Full bet was rejected (one or more selections invalid). Find a bookable
    # subset so we can still hand back a real share code instead of failing the
    # whole slip. Probe each selection individually, then book the valid ones.
    valid = []
    invalid = []
    for s in selections:
        probe = _try([s])
        if probe:
            valid.append(s)
        else:
            invalid.append(s)

    if valid:
        data = _try(valid)
        if data:
            _format(data, extra_unavailable=invalid)
            return

    print(json.dumps({"error": "booking_rejected"}))


def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "catalog":
        sport = sys.argv[2] if len(sys.argv) > 2 else "football"
        cmd_catalog(sport)
    elif cmd == "book":
        cmd_book()
    else:
        print(json.dumps({"error": "unknown_command"}))


if __name__ == "__main__":
    main()
