import { barList, budgetMeters, monthlyChart } from "../charts.js";
import {
  cadenceLabel,
  escapeHtml,
  formatPercent,
  longDate,
  money,
  percentChange,
  roundMoney,
  shortDate,
} from "../lib.js";

const RECURRING_PREVIEW = 4;

function spentFigure(summary, period) {
  const change = percentChange(summary.spend, summary.previousSpend);
  const delta =
    change === null
      ? `<div class="delta">Nothing earlier to compare against</div>`
      : `<div class="delta ${change > 0 ? "up" : "down"}">${formatPercent(
          change
        )} vs ${roundMoney(summary.previousSpend)} over ${escapeHtml(period.prevLabel)}</div>`;

  const excluded = summary.excludedCount
    ? `<div class="delta">${summary.excludedCount} spend${
        summary.excludedCount === 1 ? "" : "s"
      } excluded from this total</div>`
    : "";

  return `<div class="card figure">
    <div class="value">${money(summary.spend)}</div>
    <div class="label">Spent &middot; ${summary.count} transactions</div>
    ${delta}
    ${excluded}
  </div>`;
}

function untaggedFigure(summary) {
  if (!summary.untagged.count) {
    return `<div class="card figure">
      <div class="value small">All tagged</div>
      <div class="label">Every spend in this period has a tag</div>
    </div>`;
  }
  return `<div class="card figure callout">
    <div class="value small">${money(summary.untagged.spend)}</div>
    <div class="label">Untagged &middot; ${summary.untagged.count} spend${
      summary.untagged.count === 1 ? "" : "s"
    }</div>
    <div class="delta"><button type="button" class="link" data-action="review-untagged">Review them</button></div>
  </div>`;
}

function recurringCard(summary, expanded) {
  const recurring = summary.recurring || { items: [], fixed: 0, variable: 0 };
  const { items, fixed, variable } = recurring;
  const total = fixed + variable;

  if (!items.length) {
    return `<div class="card">
      <div class="card-head"><h2>Fixed vs variable</h2></div>
      <p class="muted">Nothing looks recurring yet. Once a merchant charges you three
      times on a monthly beat for a steady amount, it shows up here.</p>
    </div>`;
  }

  const fixedShare = total > 0 ? (fixed / total) * 100 : 0;
  const shown = expanded ? items : items.slice(0, RECURRING_PREVIEW);

  const rows = shown
    .map((item) => {
      const flag = item.priceChange
        ? `<span class="flag ${item.priceChange.direction}">${
            item.priceChange.direction === "up" ? "Price up" : "Price down"
          } ${formatPercent(item.priceChange.ratio)}</span>`
        : `<span></span>`;
      return `<button type="button" class="recurring-row" data-action="filter-merchant"
          data-name="${escapeHtml(item.merchant)}" data-scope="all">
        <span>
          <span>${escapeHtml(item.merchant)}</span>
          <span class="recurring-meta">${cadenceLabel(item.cadenceDays)} &middot; last ${shortDate(
            item.lastCharged
          )} &middot; next ${shortDate(item.nextExpected)}</span>
        </span>
        ${flag}
        <span class="amount">${money(item.latestAmount)}</span>
      </button>`;
    })
    .join("");

  const more =
    items.length > RECURRING_PREVIEW
      ? `<p class="hint"><button type="button" class="link" data-action="toggle-recurring">${
          expanded ? "Show fewer" : `Show all ${items.length}`
        }</button></p>`
      : "";

  return `<div class="card">
    <div class="card-head">
      <h2>Fixed vs variable</h2>
      <span class="muted" style="font-size:13px">${roundMoney(
        recurring.monthlyCommitment
      )} / month committed</span>
    </div>
    <div class="figure">
      <div class="value small">${money(fixed)}</div>
      <div class="label">of ${money(total)} this period is fixed</div>
    </div>
    <div class="split" style="margin-top:14px">
      <div class="split-fixed" style="width:${fixedShare.toFixed(1)}%"></div>
      <div class="split-variable" style="width:${(100 - fixedShare).toFixed(1)}%"></div>
    </div>
    <div class="legend">
      <div><span class="swatch" style="background:var(--accent)"></span>Fixed ${roundMoney(
        fixed
      )}</div>
      <div><span class="swatch" style="background:var(--accent-soft)"></span>Variable ${roundMoney(
        variable
      )}</div>
    </div>
    <div class="recurring-list">${rows}</div>
    ${more}
  </div>`;
}

export function overviewView(state) {
  const { summary } = state;
  if (!summary) return `<div class="loading">Adding up&hellip;</div>`;

  const net = summary.income - summary.spend;

  return `
    <p class="note">${escapeHtml(state.period.label)} &middot; ${longDate(
      summary.from
    )} to ${longDate(summary.to)}</p>

    <div class="grid grid-figures">
      ${spentFigure(summary, state.period)}
      <div class="card figure">
        <div class="value small">${net >= 0 ? "" : "\u2212"}${money(net)}</div>
        <div class="label">Left over &middot; ${money(summary.income)} in</div>
        <div class="delta">Refunds reduce their tag rather than counting as income</div>
      </div>
      ${untaggedFigure(summary)}
    </div>

    <div class="grid grid-split">
      <div class="card">
        <div class="card-head">
          <h2>Where it went</h2>
          <span class="muted" style="font-size:13px">click a tag to open it</span>
        </div>
        ${barList(summary.byTag, {
          action: "filter-tag",
          emptyText: "No tagged spending in this period.",
        })}
      </div>
      ${recurringCard(summary, state.recurringExpanded)}
    </div>

    <div class="card" style="margin-bottom:14px">
      <div class="card-head">
        <h2>Spend by month</h2>
        <span class="muted" style="font-size:13px">click a month to jump to it</span>
      </div>
      ${monthlyChart(summary.monthly, summary.from.slice(0, 7))}
    </div>

    <div class="grid grid-thirds">
      <div class="card">
        <div class="card-head"><h2>Budgets</h2></div>
        ${budgetMeters(summary.budgets)}
      </div>
      <div class="card">
        <div class="card-head">
          <h2>Top merchants</h2>
          <span class="muted" style="font-size:13px">grouped, not raw descriptions</span>
        </div>
        ${barList(summary.topMerchants, {
          action: "filter-merchant",
          emptyText: "No merchant activity in this period.",
        })}
      </div>
    </div>
  `;
}
