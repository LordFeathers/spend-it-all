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
