import { escapeHtml, monthLabel, money, roundMoney } from "./lib.js";

const HEIGHT = 176;
const TOP = 20;
const BOTTOM = 148;
const SIDE = 26;

/** Used until the chart has been measured; the real width comes from the slot. */
const FALLBACK_WIDTH = 720;

export const MONTH_CHART_ID = "month-chart";

/**
 * The chart is drawn in real pixels rather than scaled from a fixed viewBox, so
 * this placeholder goes in the markup and app.js fills it once the width of the
 * card is known. Stretching a viewBox would widen the glyphs and flatten slopes.
 */
export function monthChartSlot() {
  return `<div id="${MONTH_CHART_ID}" class="chart-slot"></div>`;
}

/**
 * Maps spend to a y position using a window that hugs the data instead of
 * starting at zero. Monthly spend sits in a narrow band a long way above zero,
 * so a zero-based axis draws every trend as a flat line.
 */
function scaleFor(values) {
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  // Floor the window so months that barely differ are not magnified into drama.
  const span = Math.max(hi - lo, hi * 0.08, 1);
  const mid = (lo + hi) / 2;
  const pad = span * 0.18;
  const floor = Math.max(0, mid - span / 2 - pad);
  const ceiling = mid + span / 2 + pad;
  return (value) => BOTTOM - ((value - floor) / (ceiling - floor)) * (BOTTOM - TOP);
}

/**
 * Monthly spend as a line. There is deliberately no area fill: the axis does not
 * start at zero, so shading down to the floor would overstate the magnitudes.
 * Each point keeps its printed value so the zoom cannot be misread, and each
 * month is a full-height hit area so the whole column is clickable.
 */
export function monthlyChart(monthly, activeMonth, width = FALLBACK_WIDTH) {
  const months = (monthly || []).filter((m) => m.month);
  if (months.length < 2) {
    return `<p class="muted">Two months of history will draw the trend line.</p>`;
  }

  // One unit of the coordinate system must equal one painted pixel, otherwise
  // the browser scales the text along with the geometry.
  const w = Math.max(320, Math.round(width) || FALLBACK_WIDTH);
  const values = months.map((m) => Math.max(0, Number(m.spend) || 0));
  const step = (w - SIDE * 2) / (months.length - 1);
  const x = (i) => SIDE + i * step;
  const y = scaleFor(values);

  const points = values.map((value, i) => [x(i), y(value)]);
  const line = points
    .map(([px, py], i) => `${i ? "L" : "M"}${px.toFixed(1)} ${py.toFixed(1)}`)
    .join(" ");

  const columnWidth = (w - SIDE * 2) / (months.length - 1 || 1);
  const columns = months
    .map((m, i) => {
      const isActive = m.month === activeMonth;
      const left = Math.max(0, x(i) - columnWidth / 2);
      const colWidth = Math.min(columnWidth, w - left);
      return `<g class="chart-col" data-active="${isActive}" data-action="pick-month" data-month="${m.month}">
        <rect x="${left.toFixed(1)}" y="0" width="${colWidth.toFixed(1)}" height="${HEIGHT}" />
        <circle cx="${x(i).toFixed(1)}" cy="${y(values[i]).toFixed(1)}" r="${isActive ? 4 : 2.5}"
          fill="${isActive ? "var(--accent)" : "var(--surface)"}"
          stroke="var(--accent)" stroke-width="1.5" />
        <text class="chart-value" x="${x(i).toFixed(1)}" y="${(y(values[i]) - 10).toFixed(1)}"
          text-anchor="middle">${roundMoney(values[i])}</text>
        <text class="chart-label" x="${x(i).toFixed(1)}" y="${BOTTOM + 20}"
          text-anchor="middle">${monthLabel(m.month)}</text>
      </g>`;
    })
    .join("");

  return `<svg class="chart" viewBox="0 0 ${w} ${HEIGHT}" width="${w}" height="${HEIGHT}"
      role="img" aria-label="Spend by month">
    <line x1="0" y1="${BOTTOM}" x2="${w}" y2="${BOTTOM}" stroke="var(--line)" />
    <path d="${line}" fill="none" stroke="var(--accent)" stroke-width="2"
      vector-effect="non-scaling-stroke" />
    ${columns}
  </svg>`;
}

/**
 * Ranked horizontal bars. Each row carries a data-action so the caller can
 * send a click straight through to a filtered ledger.
 */
export function barList(rows, { action, emptyText = "Nothing here yet." } = {}) {
  const items = (rows || []).filter((r) => Number(r.spend) > 0);
  if (!items.length) return `<p class="muted">${escapeHtml(emptyText)}</p>`;

  const peak = Math.max(...items.map((r) => r.spend));
  return `<div class="bars">${items
    .map((row) => {
      const width = Math.max(2, (row.spend / peak) * 100);
      const attrs = action
        ? `data-action="${action}" data-id="${row.id ?? ""}" data-name="${escapeHtml(row.name)}"`
        : "";
      return `<button type="button" class="bar" ${attrs} title="${escapeHtml(row.name)} — ${money(row.spend)}">
        <span class="bar-name">${escapeHtml(row.name)}</span>
        <span class="bar-track"><span class="bar-fill" style="width:${width.toFixed(1)}%;${
          row.color ? `background:${escapeHtml(row.color)}` : ""
        }"></span></span>
        <span class="bar-amount">${roundMoney(row.spend)}</span>
      </button>`;
    })
    .join("")}</div>`;
}

/** Budget progress. Over-budget rows fill completely and flip to the alert colour. */
export function budgetMeters(budgets) {
  if (!budgets?.length) {
    return `<p class="muted">No budgets set yet. Add caps on the Budgets tab to track them here.</p>`;
  }

  return budgets
    .map((budget) => {
      const spend = Number(budget.spend) || 0;
      const cap = Number(budget.amount) || 0;
      const ratio = cap > 0 ? spend / cap : 0;
      const over = spend > cap;
      const name = budget.tagId == null ? "Everything" : budget.tagName;
      return `<div class="meter ${over ? "over" : ""}">
        <div class="meter-row">
          <span>${escapeHtml(name)}</span>
          <span class="meter-amount">${money(spend)} of ${roundMoney(cap)}${
            over ? ` &middot; ${money(spend - cap)} over` : ""
          }</span>
        </div>
        <div class="meter-track">
          <div class="meter-fill" style="width:${Math.min(100, ratio * 100).toFixed(1)}%"></div>
        </div>
      </div>`;
    })
    .join("");
}
