# Live Budgets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the three scenario budgets (National Debt, Powerball jackpot, Elon Musk net worth) reflect live real-world figures that tick upward in real time on the scenario-select screen, snapshotting the shown value as the budget when a game starts.

**Architecture:** Add one Vercel serverless function `api/live.js` that server-side fetches the U.S. Treasury debt, a TSLA quote (for Elon), and scrapes the real Powerball jackpot, returning one cached JSON blob. The static `index.html` polls `/api/live`, ticks the numbers up live on the intro cards, and snapshots the displayed value as `sc.budget` on scenario start. Everything degrades gracefully to the existing hardcoded numbers if the network fails (the app also ships as an offline TWA/APK).

**Tech Stack:** Vanilla JS (single-file `index.html`), Vercel serverless function (Node 18+ global `fetch`, CommonJS, zero dependencies), Node's built-in `node:test` runner for unit tests.

## Global Constraints

- No new npm dependencies. `api/live.js` uses only Node 18+ built-ins (global `fetch`). Tests use the built-in `node --test` runner.
- `api/live.js` must NEVER throw a 500 — on any upstream failure it returns HTTP 200 with that section's fallback value and `ok:false` for that key.
- The Finnhub API key is read from `process.env.FINNHUB_KEY` only — never hardcoded, never sent to the client.
- Client must remain fully playable with no network (falls back to hardcoded budgets). Do not break the existing offline TWA/APK behavior.
- Scenario ids are exactly `debt`, `powerball`, `elon` — JSON keys returned by `/api/live` must match these exactly.
- Powerball is honest: no fabricated per-second growth (`perSecond = 0`); it only changes when re-polled.
- Match existing code style in `index.html`: 2-space indent, `const`/`let`, no semicolize changes to surrounding code, numeric separators (`_`) for large literals.

---

### Task 1: Treasury debt helper (`computeDebt`)

**Files:**
- Create: `api/live.js`
- Create: `api/live.test.js`

**Interfaces:**
- Produces: `computeDebt(records)` where `records` is the Treasury API `data` array (newest first), each item having `record_date` (`"YYYY-MM-DD"`) and `tot_pub_debt_out_amt` (numeric string). Returns `{ value: number, recordDate: string, perSecond: number }`. `perSecond` = average dollars-per-second increase computed from newest vs oldest record across the span.

- [ ] **Step 1: Write the failing test**

Create `api/live.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { computeDebt } = require('./live.js');

test('computeDebt returns latest value and a positive per-second rate', () => {
  // 30 days apart, grew by 1,728,000,000 -> 1,728,000,000 / 30 / 86400 = 666.66.../sec
  const records = [
    { record_date: '2026-06-25', tot_pub_debt_out_amt: '39000001728000000' },
    { record_date: '2026-05-26', tot_pub_debt_out_amt: '39000000000000000' },
  ];
  const r = computeDebt(records);
  assert.strictEqual(r.value, 39000001728000000);
  assert.strictEqual(r.recordDate, '2026-06-25');
  assert.ok(Math.abs(r.perSecond - 666.6667) < 0.01, `perSecond was ${r.perSecond}`);
});

test('computeDebt handles a single record with perSecond 0', () => {
  const r = computeDebt([{ record_date: '2026-06-25', tot_pub_debt_out_amt: '39000000000000000' }]);
  assert.strictEqual(r.value, 39000000000000000);
  assert.strictEqual(r.perSecond, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test api/live.test.js`
Expected: FAIL — `Cannot find module './live.js'` or `computeDebt is not a function`.

- [ ] **Step 3: Write minimal implementation**

Create `api/live.js`:

```js
// api/live.js — live figures for Spend It All (debt, powerball, elon).
// CommonJS, zero deps, Node 18+ (global fetch). Exports handler + pure helpers for tests.

function computeDebt(records) {
  const latest = records[0];
  const value = parseFloat(latest.tot_pub_debt_out_amt);
  const recordDate = latest.record_date;
  let perSecond = 0;
  if (records.length > 1) {
    const oldest = records[records.length - 1];
    const oldVal = parseFloat(oldest.tot_pub_debt_out_amt);
    const days = (Date.parse(latest.record_date) - Date.parse(oldest.record_date)) / 86400000;
    if (days > 0) perSecond = (value - oldVal) / days / 86400;
  }
  return { value, recordDate, perSecond };
}

module.exports = { computeDebt };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test api/live.test.js`
Expected: PASS (2 passing).

- [ ] **Step 5: Commit**

```bash
git add api/live.js api/live.test.js
git commit -m "feat(api): add computeDebt helper for live debt rate"
```

---

### Task 2: Powerball jackpot parser (`parsePowerballJackpot`)

**Files:**
- Modify: `api/live.js`
- Modify: `api/live.test.js`

**Interfaces:**
- Produces: `parsePowerballJackpot(html)` → `{ value: number } | null`. Parses the "Estimated Jackpot $X Million/Billion" text from powerball.com HTML into a dollar amount. Returns `null` if no amount found.

- [ ] **Step 1: Write the failing test**

Append to `api/live.test.js`:

```js
const { parsePowerballJackpot } = require('./live.js');

test('parsePowerballJackpot reads millions', () => {
  const html = '<div>Estimated Jackpot</div><div>$360 Million</div><div>Cash Value $163.8 Million</div>';
  assert.deepStrictEqual(parsePowerballJackpot(html), { value: 360000000 });
});

test('parsePowerballJackpot reads billions with decimals', () => {
  const html = 'Estimated Jackpot $1.2 Billion';
  assert.deepStrictEqual(parsePowerballJackpot(html), { value: 1200000000 });
});

test('parsePowerballJackpot returns null when absent', () => {
  assert.strictEqual(parsePowerballJackpot('<html>no jackpot here</html>'), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test api/live.test.js`
Expected: FAIL — `parsePowerballJackpot is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `api/live.js`, add the function and update the exports:

```js
function parsePowerballJackpot(html) {
  const m = html.match(/Estimated\s+Jackpot[\s\S]{0,120}?\$\s*([\d.,]+)\s*(Million|Billion)/i)
         || html.match(/\$\s*([\d.,]+)\s*(Million|Billion)/i);
  if (!m) return null;
  const num = parseFloat(m[1].replace(/,/g, ''));
  if (!isFinite(num)) return null;
  const mult = /billion/i.test(m[2]) ? 1e9 : 1e6;
  return { value: Math.round(num * mult) };
}

module.exports = { computeDebt, parsePowerballJackpot };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test api/live.test.js`
Expected: PASS (5 passing).

- [ ] **Step 5: Commit**

```bash
git add api/live.js api/live.test.js
git commit -m "feat(api): add parsePowerballJackpot scraper helper"
```

---

### Task 3: Elon net worth helper (`computeElonNetWorth`)

**Files:**
- Modify: `api/live.js`
- Modify: `api/live.test.js`

**Interfaces:**
- Produces: `computeElonNetWorth(tslaPrice)` → `{ value: number, tslaPrice: number }`. `value` = `tslaPrice * TESLA_SHARE_COUNT + PRIVATE_HOLDINGS_USD`. Constants are module-level, seeded from recent public figures, commented for periodic manual update.

- [ ] **Step 1: Write the failing test**

Append to `api/live.test.js`:

```js
const { computeElonNetWorth, TESLA_SHARE_COUNT, PRIVATE_HOLDINGS_USD } = require('./live.js');

test('computeElonNetWorth = tsla stake + private holdings', () => {
  const r = computeElonNetWorth(340);
  assert.strictEqual(r.value, 340 * TESLA_SHARE_COUNT + PRIVATE_HOLDINGS_USD);
  assert.strictEqual(r.tslaPrice, 340);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test api/live.test.js`
Expected: FAIL — `computeElonNetWorth is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `api/live.js`, add the constants and function, and update exports:

```js
// Elon holdings — seed values, mid-2026. Tune periodically from the
// Bloomberg Billionaires Index. The Tesla slice moves live with TSLA;
// the private slice (SpaceX + xAI + Boring + Neuralink + cash) is a fixed estimate.
const TESLA_SHARE_COUNT = 411_000_000;            // approx. core Tesla shares held
const PRIVATE_HOLDINGS_USD = 215_000_000_000;     // SpaceX + xAI + others, est.

function computeElonNetWorth(tslaPrice) {
  return { value: tslaPrice * TESLA_SHARE_COUNT + PRIVATE_HOLDINGS_USD, tslaPrice };
}

module.exports = {
  computeDebt, parsePowerballJackpot, computeElonNetWorth,
  TESLA_SHARE_COUNT, PRIVATE_HOLDINGS_USD,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test api/live.test.js`
Expected: PASS (6 passing).

- [ ] **Step 5: Commit**

```bash
git add api/live.js api/live.test.js
git commit -m "feat(api): add computeElonNetWorth helper"
```

---

### Task 4: Assemble the `/api/live` request handler

**Files:**
- Modify: `api/live.js`

**Interfaces:**
- Consumes: `computeDebt`, `parsePowerballJackpot`, `computeElonNetWorth`.
- Produces: a Vercel handler (`module.exports = handler` with helpers re-attached) that responds to GET `/api/live` with JSON:
  `{ fetchedAt, debt:{value,recordDate,perSecond,ok}, powerball:{value,ok}, elon:{value,tslaPrice,ok} }`.

- [ ] **Step 1: Write the handler**

In `api/live.js`, add fallback constants and the handler. Keep the existing helper exports by attaching them to the handler function. Replace the final `module.exports = {...}` line with the block below (move the helper exports onto `handler`):

```js
const FALLBACK = {
  debt:      { value: 39_300_000_000_000, recordDate: null, perSecond: 64500 },
  powerball: { value: 360_000_000 },
  elon:      { value: 355_000_000_000, tslaPrice: null },
};

async function getDebt() {
  const url = 'https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/debt_to_penny?sort=-record_date&page[size]=30';
  const r = await fetch(url);
  if (!r.ok) throw new Error('treasury ' + r.status);
  const j = await r.json();
  if (!j.data || !j.data.length) throw new Error('treasury empty');
  return { ...computeDebt(j.data), ok: true };
}

async function getPowerball() {
  const r = await fetch('https://www.powerball.com/', { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!r.ok) throw new Error('powerball ' + r.status);
  const html = await r.text();
  const parsed = parsePowerballJackpot(html);
  if (!parsed) throw new Error('powerball parse');
  return { ...parsed, ok: true };
}

async function getElon() {
  const key = process.env.FINNHUB_KEY;
  if (!key) throw new Error('no FINNHUB_KEY');
  const r = await fetch('https://finnhub.io/api/v1/quote?symbol=TSLA&token=' + key);
  if (!r.ok) throw new Error('finnhub ' + r.status);
  const j = await r.json();
  if (!j.c) throw new Error('finnhub no price');
  return { ...computeElonNetWorth(j.c), ok: true };
}

async function settle(fn, fallback) {
  try { return await fn(); }
  catch (e) { return { ...fallback, ok: false }; }
}

async function handler(req, res) {
  const [debt, powerball, elon] = await Promise.all([
    settle(getDebt, FALLBACK.debt),
    settle(getPowerball, FALLBACK.powerball),
    settle(getElon, FALLBACK.elon),
  ]);
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
  res.status(200).json({ fetchedAt: new Date().toISOString(), debt, powerball, elon });
}

module.exports = handler;
module.exports.computeDebt = computeDebt;
module.exports.parsePowerballJackpot = parsePowerballJackpot;
module.exports.computeElonNetWorth = computeElonNetWorth;
module.exports.TESLA_SHARE_COUNT = TESLA_SHARE_COUNT;
module.exports.PRIVATE_HOLDINGS_USD = PRIVATE_HOLDINGS_USD;
```

Delete the earlier intermediate `module.exports = {...}` lines added in Tasks 1–3 (there must be exactly one `module.exports` block, at the end).

- [ ] **Step 2: Verify helper tests still pass with the new exports**

Run: `node --test api/live.test.js`
Expected: PASS (6 passing) — the test `require('./live.js')` destructures still resolve because helpers are attached to `module.exports`.

- [ ] **Step 3: Smoke-test the handler locally with a fake req/res (no network needed for fallbacks)**

Run this one-off command (it forces all upstreams to fail by unsetting the key and relying on network errors being caught, confirming the never-500 contract):

```bash
node -e "const h=require('./api/live.js'); const res={setHeader(){}, status(c){this._c=c; return this;}, json(o){console.log(this._c, JSON.stringify(o).slice(0,200));}}; h({},res).then(()=>{});"
```
Expected: prints `200 {"fetchedAt":...,"debt":{...},"powerball":{...},"elon":{...}}`. Each section present (real values if network available, fallback + `"ok":false` if not). Never a thrown error / non-200.

- [ ] **Step 4: Commit**

```bash
git add api/live.js
git commit -m "feat(api): assemble /api/live handler with fallbacks and caching"
```

---

### Task 5: Client live-data layer + intro card ticking

**Files:**
- Modify: `index.html` (around the INIT block, lines ~3270–3290; uses globals `SCENARIOS`, `fmtFull`, `introEl`)

**Interfaces:**
- Consumes: `/api/live` JSON from Task 4; `fmtFull(n)` (defined at `index.html:2382`); `SCENARIOS` (`index.html:2024`).
- Produces: globals `liveData`, `ORIGINAL_BUDGETS`, and functions `liveValueFor(id)`, `fetchLive()` for use by Task 6.

- [ ] **Step 1: Add the live-data layer before the intro `forEach`**

In `index.html`, immediately BEFORE the line `SCENARIOS.forEach(s => {` (currently `index.html:3274`), insert:

```js
// ── LIVE FIGURES ─────────────────────────────────────────────────────────────
// Fallback seeds so cards tick even offline; overwritten by /api/live.
const ORIGINAL_BUDGETS = {};
SCENARIOS.forEach(s => { ORIGINAL_BUDGETS[s.id] = s.budget; });

const liveData = {
  debt:      { base: 39_300_000_000_000, perSecond: 64500, fetchedAtMs: Date.now() },
  powerball: { base: 360_000_000,        perSecond: 0,     fetchedAtMs: Date.now() },
  elon:      { base: 355_000_000_000,    perSecond: 0,     fetchedAtMs: Date.now() },
};

function liveValueFor(id) {
  const d = liveData[id];
  if (!d) return ORIGINAL_BUDGETS[id] || 0;
  const elapsed = (Date.now() - d.fetchedAtMs) / 1000;
  return d.base + (d.perSecond || 0) * elapsed;
}

async function fetchLive() {
  try {
    const r = await fetch('/api/live', { cache: 'no-store' });
    if (!r.ok) throw new Error('bad status');
    const j = await r.json();
    const now = Date.now();
    liveData.debt      = { base: j.debt.value,      perSecond: j.debt.perSecond || 0, fetchedAtMs: now };
    liveData.powerball = { base: j.powerball.value, perSecond: 0,                     fetchedAtMs: now };
    liveData.elon      = { base: j.elon.value,      perSecond: 0,                     fetchedAtMs: now };
  } catch (e) {
    // keep current seeds/fallbacks — app stays playable offline
  }
}
```

- [ ] **Step 2: Use the live value for the initial intro card budget**

In the intro `forEach` (currently `index.html:3284`), change the budget line from:

```js
    `<div class="intro-opt-budget">${fmt(s.budget)}</div>`;
```
to:
```js
    `<div class="intro-opt-budget">${fmtFull(liveValueFor(s.id))}</div>`;
```

(Using `fmtFull` — comma-separated full number — so the ticking digits are visible, unlike the abbreviated `fmt`.)

- [ ] **Step 3: Start the ticking + polling loops after the intro `forEach`**

Immediately AFTER the closing `});` of the intro `forEach` (currently `index.html:3287`), insert:

```js
// Tick the intro card numbers up live; re-poll the API periodically.
function tickIntroBudgets() {
  introEl.querySelectorAll('.intro-opt').forEach(btn => {
    const el = btn.querySelector('.intro-opt-budget');
    if (el) el.textContent = fmtFull(liveValueFor(btn.dataset.id));
  });
}
setInterval(tickIntroBudgets, 100);
fetchLive();
setInterval(fetchLive, 30000);
```

- [ ] **Step 4: Manual verification (no JS test harness exists for this single-file app; verify in browser)**

Run from the repo root: `npx vercel dev` (serves `index.html` AND `/api/live` together; requires the `vercel` CLI logged in and `FINNHUB_KEY` set locally via `vercel env` or a `.env` file).
Open the printed `http://localhost:3000`.
Expected:
- All three scenario cards show full comma-separated dollar amounts.
- The National Debt number visibly increments several times per second.
- Powerball and Elon show realistic current values and do not tick per-second (they refresh on the 30s poll).

If `vercel` CLI is unavailable, open `index.html` directly in a browser (file://): `/api/live` will fail, the seeds remain, and the debt still ticks from the fallback rate — confirming the offline fallback.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat(web): poll /api/live and tick intro budgets in real time"
```

---

### Task 6: Snapshot the live value as budget on scenario start

**Files:**
- Modify: `index.html` (`switchScenario`, `index.html:2787`)

**Interfaces:**
- Consumes: `liveValueFor(id)` and `ORIGINAL_BUDGETS` from Task 5.

- [ ] **Step 1: Snapshot the displayed value into `sc.budget`**

In `switchScenario` (`index.html:2787`), immediately AFTER the line `sc = SCENARIOS.find(s => s.id === id);` (line 2788), insert:

```js
  // Lock the live, ticking value as this game's budget at the moment of selection.
  sc.budget = Math.round(liveValueFor(sc.id) || ORIGINAL_BUDGETS[sc.id]);
```

The existing `remaining = sc.budget;` (line 2793) then picks up the snapshot, and all downstream game math (progress bar, achievements, `fmt`) is unchanged.

- [ ] **Step 2: Manual end-to-end verification**

With `npx vercel dev` running (or file:// fallback), in the browser:
1. Watch the National Debt card tick up on the intro screen.
2. Click the National Debt scenario.
3. Expected: the in-game header balance equals (approximately) the number shown on the card at click time — confirming the snapshot. Spending with +/- still works and the progress bar fills correctly.
4. Return to intro (scenario switch), confirm Powerball and Elon also start games with their live-derived budgets.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat(web): snapshot live figure as scenario budget on start"
```

---

## Deployment Notes (post-implementation, performed by the user)

- Set the Finnhub key on Vercel: `vercel env add FINNHUB_KEY` (or via the Vercel dashboard) for Production/Preview/Development. The free key is obtained from finnhub.io.
- Deploy: `vercel --prod` (or push to the connected git branch). `/api/live` deploys automatically from the `api/` directory.
- The APK/TWA does not need rebuilding for this change to take effect on the website, but the bundled offline copy of `index.html` inside the APK will use fallback seeds until it can reach `/api/live`; rebuild the APK only if you want the updated `index.html` shipped in the app package.

## Self-Review Notes

- **Spec coverage:** debt live API ✔ (Tasks 1,4,5), elon stock-based net worth ✔ (Tasks 3,4,5), powerball real jackpot ✔ (Tasks 2,4,5), lock-on-start ✔ (Task 6), Vercel function ✔ (Tasks 1–4), graceful fallback / offline ✔ (Task 4 never-500, Task 5 seeds), honest no-fake-powerball-tick ✔ (`perSecond:0`).
- **Placeholders:** none — all code is concrete; Elon constants are real seed numbers with update comments (a deliberate, documented choice, not a TODO).
- **Type consistency:** helper names (`computeDebt`, `parsePowerballJackpot`, `computeElonNetWorth`) and JSON keys (`debt`/`powerball`/`elon` with `value`/`perSecond`/`tslaPrice`) are identical across api and client tasks.
- **Test note:** the serverless helpers get real unit tests (`node --test`); the single-file client gets explicit manual browser verification because adding a browser test runner (Playwright etc.) to this one-file app is disproportionate (YAGNI) — this is stated, not silently skipped.
