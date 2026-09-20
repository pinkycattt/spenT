import { escapeHtml, monthLabel, money, roundMoney } from "./lib.js";

const WIDTH = 720;
const HEIGHT = 176;
const TOP = 20;
const BOTTOM = 148;
const SIDE = 26;

/**
 * Monthly spend as a line and soft area. Each month is a full-height hit area
 * so the whole column is clickable, not just the point.
 */
export function monthlyChart(monthly, activeMonth) {
  const months = (monthly || []).filter((m) => m.month);
  if (months.length < 2) {
    return `<p class="muted">Two months of history will draw the trend line.</p>`;
  }

  const values = months.map((m) => Math.max(0, Number(m.spend) || 0));
  const peak = Math.max(...values, 1);
  const step = (WIDTH - SIDE * 2) / (months.length - 1);
  const x = (i) => SIDE + i * step;
  const y = (value) => BOTTOM - (value / peak) * (BOTTOM - TOP);

  const points = values.map((value, i) => [x(i), y(value)]);
  const line = points.map(([px, py], i) => `${i ? "L" : "M"}${px} ${py}`).join(" ");
  const area = `${line} L${x(months.length - 1)} ${BOTTOM} L${SIDE} ${BOTTOM} Z`;

  const columnWidth = (WIDTH - SIDE * 2) / (months.length - 1 || 1);
  const columns = months
    .map((m, i) => {
      const isActive = m.month === activeMonth;
      const left = Math.max(0, x(i) - columnWidth / 2);
      const width = Math.min(columnWidth, WIDTH - left);
      return `<g class="chart-col" data-active="${isActive}" data-action="pick-month" data-month="${m.month}">
        <rect x="${left.toFixed(1)}" y="0" width="${width.toFixed(1)}" height="${HEIGHT}" />
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

  return `<svg class="chart" viewBox="0 0 ${WIDTH} ${HEIGHT}" preserveAspectRatio="none"
      role="img" aria-label="Spend by month">
    <line x1="0" y1="${BOTTOM}" x2="${WIDTH}" y2="${BOTTOM}" stroke="var(--line)" />
    <path d="${area}" fill="var(--accent)" fill-opacity="0.09" />
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
