const { test } = require('node:test');
const assert = require('node:assert');
const { computeDebt, parsePowerballJackpot } = require('./live.js');

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

const { computeElonNetWorth, TESLA_SHARE_COUNT, PRIVATE_HOLDINGS_USD } = require('./live.js');

test('computeElonNetWorth = tsla stake + private holdings', () => {
  const r = computeElonNetWorth(340);
  assert.strictEqual(r.value, 340 * TESLA_SHARE_COUNT + PRIVATE_HOLDINGS_USD);
  assert.strictEqual(r.tslaPrice, 340);
});
