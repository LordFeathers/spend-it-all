# Live Budgets — Design Spec

**Date:** 2026-06-28
**App:** Spend It All (`spend-it-all-repo/index.html`, deployed on Vercel, wrapped as a TWA APK)

## Goal

Replace the three hardcoded scenario budgets with **live, real-world figures that tick upward in real time** on the scenario-select screen:

- 🏛️ **National Debt** — currently hardcoded `33_000_000_000_000`
- 🎰 **Powerball jackpot** — currently hardcoded `1_000_000_000`
- 🚀 **Elon Musk's net worth** — currently hardcoded `200_000_000_000`

## Key Decisions (confirmed)

1. **Architecture:** Add one small **Vercel serverless function** (`/api/live.js`). The app is a static client-side page, so it can't fetch the real Powerball jackpot (CORS-blocked HTML) or hide stock API keys on its own. The function fetches all three server-side, returns one clean JSON blob, and the browser polls it.
2. **Game behavior — lock on start:** The scenario-select (intro) screen shows the live, ticking number. When the user picks a scenario, the current displayed value is **snapshotted** as that game's `budget`. The budget does **not** change mid-game (so the player's money doesn't grow while they spend).

## Architecture

```
Browser (index.html)
  └─ fetch GET /api/live   ──►  Vercel function (/api/live.js)
                                   ├─ Treasury Fiscal Data API   (debt — real, no key)
                                   ├─ Finnhub quote API          (TSLA + other tickers — real, free key)
                                   └─ powerball.com HTML scrape   (jackpot — real)
                                 returns { debt, powerball, elon, fetchedAt }  (cached)
```

### `/api/live.js` (new file)

Single endpoint returning JSON. Caches each source with `Cache-Control: s-maxage` so we don't hammer upstreams (Vercel edge cache):

```json
{
  "fetchedAt": "2026-06-28T12:00:00Z",
  "debt": {
    "value": 39311022730162.44,
    "recordDate": "2026-06-25",
    "perSecond": 64500.0
  },
  "powerball": {
    "value": 360000000,
    "nextDrawDate": "2026-06-29",
    "cashValue": 163800000
  },
  "elon": {
    "value": 221000000000,
    "tslaPrice": 340.12,
    "tslaPctChange": 1.4
  }
}
```

**Sources & details:**

- **Debt** — `GET https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/debt_to_penny?sort=-record_date&page[size]=30`. Take the latest `tot_pub_debt_out_amt` and `record_date`. Compute `perSecond` from the average daily change across the returned ~30 records (`(latest - oldest) / days / 86400`). Cache `s-maxage=3600` (updates ~daily).
- **Elon** — `GET https://finnhub.io/api/v1/quote?symbol=TSLA&token=KEY`. Net worth = `(TSLA price × TESLA_SHARE_COUNT) + PRIVATE_HOLDINGS`, where `TESLA_SHARE_COUNT` (his Tesla shares incl. exercisable options) and `PRIVATE_HOLDINGS` (SpaceX + xAI + Boring + Neuralink + cash, fixed recent estimates) are constants at the top of the file, seeded from current public figures and clearly commented as "update periodically." This honors "use all the companies he owns + stock values + known net worth": the Tesla slice moves live; private slices are fixed estimates. Cache `s-maxage=30`.
  - Honest note: TSLA moves **both** directions, so Elon's number fluctuates rather than strictly rising. Debt and Powerball only go up.
- **Powerball** — scrape `https://www.powerball.com/` (or `/api/v1/estimates/powerball`) server-side, regex out the "Estimated Jackpot $X Million/Billion" and cash value. Cache `s-maxage=600`. The real jackpot is **stepwise** — it jumps at each drawing (~3×/week), it does not continuously tick. See "Powerball ticking" below.

**API key:** Finnhub free key stored as a Vercel **environment variable** (`FINNHUB_KEY`), never in the client. Free tier (60 calls/min) is ample given edge caching.

**Resilience:** If any upstream fails, the function returns that section's last-known/fallback constant and an `"ok": false` flag for that key — the endpoint never 500s.

### Client changes (`index.html`)

Minimal, surgical. The `SCENARIOS` array keeps its current hardcoded `budget` values as **fallbacks**.

1. **On load**, `fetch('/api/live')`. On success, store the live figures + each scenario's `perSecond` growth rate.
2. **Ticking display (intro screen only):** a `requestAnimationFrame`/interval loop updates the on-screen number for each scenario card:
   `displayed = baseValue + perSecond × secondsElapsedSinceFetch`.
   - Debt: `perSecond` from Treasury trend.
   - Powerball: see below.
   - Elon: re-poll `/api/live` every ~30s and animate to the new value (no per-second tick — it's not monotonic).
3. **Snapshot on start:** when `switchScenario(id)` runs, set `sc.budget = currentDisplayedValue(id)` (rounded). All existing game math (`remaining`, progress bar, achievements, `fmt()`) works unchanged because it just reads `sc.budget`.
4. **Fallback:** if `/api/live` fails or is slow, use the hardcoded `budget` constants. The game must always be playable offline (it's also a TWA/APK).

**Powerball ticking:** The real jackpot doesn't grow per-second. Default behavior: show the **real** current jackpot; it refreshes (and may jump) when the function re-scrapes. Optional nice-to-have (flag in spec): a gentle simulated drift from current jackpot toward a projected next-draw amount, clearly an estimate. **Default = real value only, no fabricated per-second growth** unless we decide otherwise.

## Out of Scope

- Rebuilding the APK (separate build step the user runs; this change is web-only).
- Historical charts, multiple currencies, other billionaires/lotteries.
- Auth, persistence of live values.

## Testing

- `/api/live` returns valid JSON with all three keys; verify against known current values (debt ≈ $39.3T, jackpot = powerball.com's figure, Elon in the low-$200B range).
- Simulate each upstream failing → endpoint still returns 200 with fallbacks + `ok:false`.
- Client with network blocked → falls back to hardcoded budgets, game fully playable.
- Numbers visibly tick up on the intro screen; picking a scenario snapshots the shown value; spending math unchanged.

## Risks

- **Powerball scrape is fragile** — if powerball.com changes markup, the regex breaks; mitigated by fallback constant + `ok:false`.
- **Finnhub free-tier limits / TSLA share count drift** — share count and private-holding estimates need occasional manual updates (commented constants).
- **Treasury "real-time" is extrapolated**, not literally to-the-penny live — this is how all debt clocks work; acceptable and noted.
