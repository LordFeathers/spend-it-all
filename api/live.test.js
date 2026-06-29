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
