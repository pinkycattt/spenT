import { merchantCharges, spendBetweenForMerchants } from "./db.js";

const MIN_CHARGES = 3;
const MIN_GAP_DAYS = 24;
const MAX_GAP_DAYS = 37;
/** How far amounts may drift and still count as the same subscription. */
const AMOUNT_TOLERANCE = 0.15;
/** How big a jump has to be before it is worth telling you about. */
const PRICE_CHANGE_TOLERANCE = 0.05;

const DAY = 86400000;

const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function addDays(iso, days) {
  return new Date(Date.parse(iso) + days * DAY).toISOString().slice(0, 10);
}

/**
 * A merchant is recurring when it bills on a roughly monthly beat for a
 * roughly steady amount. Groceries fail the amount test; rent and streaming pass.
 */
function assess(merchant, charges) {
  if (charges.length < MIN_CHARGES) return null;

  const gaps = [];
  for (let i = 1; i < charges.length; i += 1) {
    gaps.push(daysBetween(charges[i - 1].date, charges[i].date));
  }
  const usableGaps = gaps.filter((g) => g >= MIN_GAP_DAYS && g <= MAX_GAP_DAYS);
  if (usableGaps.length < gaps.length - 1 || usableGaps.length < MIN_CHARGES - 1) {
    return null;
  }

  const amounts = charges.map((c) => c.amount);
  const typical = median(amounts);
  if (typical <= 0) return null;
  const drifted = amounts.some(
    (a) => Math.abs(a - typical) / typical > AMOUNT_TOLERANCE
  );
  if (drifted) return null;

  const cadence = Math.round(median(usableGaps));
  const latest = charges[charges.length - 1];
  const previous = charges[charges.length - 2];
  const change = previous.amount
    ? (latest.amount - previous.amount) / previous.amount
    : 0;

  return {
    merchant,
    typicalAmount: typical,
    latestAmount: latest.amount,
    previousAmount: previous.amount,
    cadenceDays: cadence,
    charges: charges.length,
    lastCharged: latest.date,
    nextExpected: addDays(latest.date, cadence),
    priceChange:
      Math.abs(change) > PRICE_CHANGE_TOLERANCE
        ? { direction: change > 0 ? "up" : "down", ratio: change }
        : null,
  };
}

export function detectRecurring() {
  const grouped = new Map();
  for (const row of merchantCharges()) {
    if (!grouped.has(row.merchant)) grouped.set(row.merchant, []);
    grouped.get(row.merchant).push(row);
  }

  const found = [];
  for (const [merchant, charges] of grouped) {
    const verdict = assess(merchant, charges);
    if (verdict) found.push(verdict);
  }
  found.sort((a, b) => b.typicalAmount - a.typicalAmount);
  return found;
}

/**
 * Fixed costs are what the recurring merchants took in this period; everything
 * else is variable. Together they reconcile to the period's total spend.
 */
export function recurringSummary(from, to, periodSpend) {
  const items = detectRecurring();
  const names = items.map((i) => i.merchant);
  const fixed = spendBetweenForMerchants(from, to, names);
  const total = Number(periodSpend) || 0;

  return {
    items,
    fixed,
    variable: Math.max(0, total - fixed),
    monthlyCommitment: items.reduce((sum, i) => sum + i.typicalAmount, 0),
    priceChanges: items.filter((i) => i.priceChange),
  };
}
