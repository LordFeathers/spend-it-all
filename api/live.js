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

function parsePowerballJackpot(html) {
  const m = html.match(/Estimated\s+Jackpot[\s\S]{0,120}?\$\s*([\d.,]+)\s*(Million|Billion)/i)
         || html.match(/\$\s*([\d.,]+)\s*(Million|Billion)/i);
  if (!m) return null;
  const num = parseFloat(m[1].replace(/,/g, ''));
  if (!isFinite(num)) return null;
  const mult = /billion/i.test(m[2]) ? 1e9 : 1e6;
  return { value: Math.round(num * mult) };
}

// Elon holdings — seed values, mid-2026. Tune periodically from the
// Bloomberg Billionaires Index. The Tesla slice moves live with TSLA;
// the private slice (SpaceX + xAI + Boring + Neuralink + cash) is a fixed estimate.
const TESLA_SHARE_COUNT = 411_000_000;            // approx. core Tesla shares held
const PRIVATE_HOLDINGS_USD = 215_000_000_000;     // SpaceX + xAI + others, est.

function computeElonNetWorth(tslaPrice) {
  return { value: tslaPrice * TESLA_SHARE_COUNT + PRIVATE_HOLDINGS_USD, tslaPrice };
}

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
