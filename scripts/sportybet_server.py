#!/usr/bin/env python3
"""HTTP wrapper around sportybet_api.py for hosted deployments.

The Next.js app (e.g. on Vercel) cannot spawn this repo's python venv, so set
SPORTYBET_SIDECAR_URL to a hosted instance of this server and the app will
call it over HTTP instead:

    GET  /catalog/soccer      -> {"events": [...]}
    GET  /catalog/basketball
    POST /book                body {"selections": [...]} -> share-code JSON

Run anywhere that allows long-running processes (Render, Railway, Fly.io,
a Raspberry Pi at home...):

    pip install curl_cffi
    SPORTYBET_PORT=8080 python scripts/sportybet_server.py

Protect the instance with a shared secret (recommended):
    SPORTYBET_TOKEN=some-long-random-string python scripts/sportybet_server.py
Clients then include the header:  x-sidecar-token: some-long-random-string
"""

import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import sportybet_api as api  # noqa: E402

TOKEN = os.environ.get("SPORTYBET_TOKEN", "")


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _send(self, code: int, payload) -> None:
        body = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _authorized(self) -> bool:
        return not TOKEN or self.headers.get("x-sidecar-token") == TOKEN

    def do_GET(self):  # noqa: N802
        if not self._authorized():
            self._send(401, {"error": "unauthorized"})
            return
        parts = self.path.strip("/").split("/")
        if len(parts) == 2 and parts[0] == "catalog":
            sport = parts[1]
            sport_id = api.SPORT_IDS.get(sport)
            data = api._get("/factsCenter/commonThumbnailEvents", {"sportId": sport_id, "marketId": "1"}) if sport_id else None
            if not data:
                self._send(502, {"error": "catalog_unavailable"})
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
                    events.append({
                        "eventId": ev.get("eventId", ""),
                        "home": home,
                        "away": away,
                        "startTime": ev.get("estimateStartTime") or 0,
                        "tournament": name,
                    })
            self._send(200, {"events": events})
            return
        self._send(404, {"error": "unknown_route"})

    def do_POST(self):  # noqa: N802
        if not self._authorized():
            self._send(401, {"error": "unauthorized"})
            return
        if self.path.strip("/") != "book":
            self._send(404, {"error": "unknown_route"})
            return
        try:
            length = int(self.headers.get("Content-Length") or 0)
            payload = json.loads(self.rfile.read(length) or b"{}")
        except (json.JSONDecodeError, ValueError):
            self._send(400, {"error": "bad_payload"})
            return

        # Reuse the CLI's booking logic by feeding it through a temp swap of
        # stdin is awkward; instead replicate its subset-probe flow directly.
        selections = payload.get("selections") or []
        if not selections:
            self._send(400, {"error": "no_selections"})
            return

        data = api._post("/orders/share", {"selections": selections})
        invalid = []
        if not data:
            valid = []
            for s in selections:
                probe = api._post("/orders/share", {"selections": [s]})
                if probe:
                    valid.append(s)
                else:
                    invalid.append(s)
            if valid:
                data = api._post("/orders/share", {"selections": valid})
            if not data:
                self._send(502, {"error": "booking_rejected"})
                return
            selections = valid

        body = data.get("data") or {}
        outcomes = []
        for o in body.get("outcomes") or []:
            markets = o.get("markets") or []
            market = markets[0] if markets else {}
            market_outcomes = market.get("outcomes") or []
            chosen = market_outcomes[0] if market_outcomes else {}
            tournament = ((o.get("sport") or {}).get("category") or {}).get("tournament") or {}
            outcomes.append({
                "selection": chosen.get("desc") or o.get("selectedOutcome"),
                "home": o.get("homeTeamName"),
                "away": o.get("awayTeamName"),
                "odds": chosen.get("odds") or o.get("odds"),
                "tournament": tournament.get("name") or o.get("tournament"),
                "market": market.get("desc") or o.get("marketDesc"),
            })
        unavailable = list(body.get("unavailableOutcomes") or [])
        for s in invalid:
            unavailable.append(s.get("label") if isinstance(s, dict) and s.get("label") else str(s))
        self._send(200, {
            "shareCode": body.get("shareCode"),
            "shareURL": body.get("shareURL"),
            "deadline": body.get("deadline"),
            "outcomes": outcomes,
            "unavailable": unavailable,
        })

    def log_message(self, fmt, *args):  # quiet
        pass


if __name__ == "__main__":
    port = int(os.environ.get("SPORTYBET_PORT", "8080"))
    server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    print(f"sportybet sidecar listening on :{port}", flush=True)
    server.serve_forever()
