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
// Bloomberg Billionaires Index. Both big stakes move live with their tickers
// (TSLA + SPCX — SpaceX IPO'd on Nasdaq 2026-06-12); the remainder is a fixed
// estimate. Tune the constants periodically from Bloomberg.
const TESLA_SHARE_COUNT  = 411_000_000;            // approx. core Tesla shares held
const SPACEX_SHARE_COUNT = 4_760_000_000;          // ~42% of SpaceX (SPCX), per S-1
const OTHER_HOLDINGS_USD = 147_000_000_000;        // Tesla options (~$127B) + X + Neuralink + Boring (~$20B)

function computeElonNetWorth(tslaPrice, spcxPrice) {
  const value = tslaPrice * TESLA_SHARE_COUNT
              + spcxPrice * SPACEX_SHARE_COUNT
              + OTHER_HOLDINGS_USD;
  return { value, tslaPrice, spcxPrice };
}

const FALLBACK = {
  debt:      { value: 39_300_000_000_000, recordDate: null, perSecond: 64500 },
  powerball: { value: 360_000_000 },
  elon:      { value: 1_030_000_000_000, tslaPrice: null, spcxPrice: null },
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

// Free Finnhub key. Prefer the env var; fall back to this baked-in key so the
// endpoint works without any Vercel config. The owner has accepted exposure of
// this free key; it is server-side only and never returned to the client.
const FINNHUB_KEY_FALLBACK = 'd90si0hr01qpn7h422pgd90si0hr01qpn7h422q0';

async function getElon() {
  const key = process.env.FINNHUB_KEY || FINNHUB_KEY_FALLBACK;
  if (!key) throw new Error('no FINNHUB_KEY');
  const quote = async (sym) => {
    const r = await fetch('https://finnhub.io/api/v1/quote?symbol=' + sym + '&token=' + key);
    if (!r.ok) throw new Error('finnhub ' + sym + ' ' + r.status);
    const j = await r.json();
    if (!j.c) throw new Error('finnhub ' + sym + ' no price');
    return j.c;
  };
  const [tsla, spcx] = await Promise.all([quote('TSLA'), quote('SPCX')]);
  return { ...computeElonNetWorth(tsla, spcx), ok: true };
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
module.exports.SPACEX_SHARE_COUNT = SPACEX_SHARE_COUNT;
module.exports.OTHER_HOLDINGS_USD = OTHER_HOLDINGS_USD;
