import {
  escapeHtml,
  longDate,
  money,
  roundMoney,
  shortDate,
  signedMoney,
  todayIso,
} from "../lib.js";

export const PAGE_SIZE = 100;

function tagOptions(tags, selectedId, noneLabel = "No tag") {
  return [
    `<option value="">${escapeHtml(noneLabel)}</option>`,
    ...tags.map(
      (tag) =>
        `<option value="${tag.id}" ${
          Number(selectedId) === tag.id ? "selected" : ""
        }>${escapeHtml(tag.name)}</option>`
    ),
  ].join("");
}

function tagPill(txn) {
  if (!txn.tagId) return `<span class="muted" style="font-size:12.5px">&mdash;</span>`;
  return `<span class="tag ${txn.tagSource === "auto" ? "auto" : ""}"
      title="${txn.tagSource === "auto" ? "Tagged by a rule" : "Tagged by you"}">
    <span class="tag-dot" style="background:${escapeHtml(txn.tagColor)}"></span>
    ${escapeHtml(txn.tagName)}
  </span>`;
}

export function ledgerShell(state) {
  return `
    <div class="toolbar">
      <input class="search" id="ledger-search" type="search" placeholder="Search descriptions, merchants, notes"
        value="${escapeHtml(state.filters.q)}" />
      <button type="button" class="btn ghost" data-action="toggle-group">${
        state.groupByMerchant ? "Show transactions" : "Group by merchant"
      }</button>
      <button type="button" class="btn" data-action="add-spend">Add spend</button>
    </div>
    <div class="chips" id="ledger-chips"></div>
    <div id="ledger-bulk"></div>
    <div class="ledger-layout">
      <div class="card table-card" id="ledger-table"></div>
      <aside class="card inspector" id="ledger-inspector"></aside>
    </div>
  `;
}

export function ledgerChips(state) {
  const { filters, tags } = state;
  const chip = (label, action, pressed, extra = "") =>
    `<button type="button" class="chip" data-action="${action}" ${extra}
      aria-pressed="${pressed}">${escapeHtml(label)}</button>`;

  const noFilters = !filters.tag && !filters.untagged && !filters.excluded && !filters.merchant;

  return [
    chip("All", "filter-all", noFilters),
    chip("Untagged", "filter-untagged", Boolean(filters.untagged)),
    chip("Excluded", "filter-excluded", Boolean(filters.excluded)),
    ...tags.map((tag) =>
      chip(tag.name, "filter-tag", Number(filters.tag) === tag.id, `data-id="${tag.id}"`)
    ),
    filters.merchant
      ? `<button type="button" class="chip" data-action="filter-all" aria-pressed="true">
          ${escapeHtml(filters.merchant)} &times;</button>`
      : "",
  ].join("");
}

export function ledgerBulk(state) {
  const count = state.checked.size;
  if (!count) return "";
  return `<div class="toolbar">
    <span class="muted">${count} selected</span>
    <select class="field" style="width:auto" data-change="bulk-tag">
      <option value="">Tag as&hellip;</option>
      ${state.tags.map((t) => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join("")}
    </select>
    <button type="button" class="btn ghost small" data-action="bulk-exclude">Exclude from totals</button>
    <button type="button" class="btn ghost small" data-action="bulk-include">Include again</button>
    <button type="button" class="btn ghost small" data-action="bulk-clear">Clear selection</button>
  </div>`;
}

function merchantTable(state) {
  const merchants = state.merchants || [];
  if (!merchants.length) {
    return `<div class="empty"><h3>No merchants here</h3><p>Try a wider period.</p></div>`;
  }
  return `<table>
    <thead><tr>
      <th>Merchant</th><th>Spends</th><th>Last seen</th><th class="col-amount">Total</th>
    </tr></thead>
    <tbody>${merchants
      .map(
        (m) => `<tr data-action="filter-merchant" data-name="${escapeHtml(m.name)}">
          <td>${escapeHtml(m.name)}</td>
          <td class="muted">${m.count}</td>
          <td class="muted">${shortDate(m.lastDate)}</td>
          <td class="col-amount"><span class="amount">${money(m.spend)}</span></td>
        </tr>`
      )
      .join("")}</tbody>
  </table>
  <div class="pager"><span>${merchants.length} merchants</span>
    <span>${roundMoney(merchants.reduce((s, m) => s + m.spend, 0))} total</span></div>`;
}

export function ledgerTable(state) {
  if (state.groupByMerchant) return merchantTable(state);

  const { transactions, total, spend } = state.ledger;
  if (!transactions.length) {
    return `<div class="empty">
      <h3>Nothing matches</h3>
      <p>Loosen the filters, widen the period, or add a spend by hand.</p>
    </div>`;
  }

  const rows = transactions
    .map((txn) => {
      const sub = [
        txn.merchant && txn.merchant !== txn.description ? escapeHtml(txn.merchant) : "",
        txn.notes ? `&#9679; ${escapeHtml(txn.notes.slice(0, 60))}` : "",
        txn.excluded ? "&#9679; excluded" : "",
      ]
        .filter(Boolean)
        .join(" ");

      return `<tr data-action="select-row" data-id="${txn.id}"
          class="${txn.excluded ? "excluded" : ""}"
          aria-selected="${state.selectedId === txn.id}">
        <td class="col-check"><input type="checkbox" data-action="toggle-check" data-id="${txn.id}"
          ${state.checked.has(txn.id) ? "checked" : ""} aria-label="Select spend" /></td>
        <td class="muted" style="white-space:nowrap">${shortDate(txn.date)}</td>
        <td class="desc">
          <button type="button" class="row-open" data-action="select-row" data-id="${txn.id}">
            <span class="desc-main">${escapeHtml(txn.description)}</span>
          </button>
          ${sub ? `<div class="desc-sub">${sub}</div>` : ""}
        </td>
        <td>${tagPill(txn)}</td>
        <td class="col-amount"><span class="amount ${
          txn.amount > 0 ? "inflow" : ""
        }">${signedMoney(txn.amount)}</span></td>
      </tr>`;
    })
    .join("");

  const from = state.page * PAGE_SIZE + 1;
  const to = Math.min(total, from + transactions.length - 1);
  const pages = Math.ceil(total / PAGE_SIZE);

  return `<table>
    <thead><tr>
      <th class="col-check"><input type="checkbox" data-action="toggle-check-all"
        ${transactions.every((t) => state.checked.has(t.id)) ? "checked" : ""}
        aria-label="Select all shown" /></th>
      <th>Date</th><th>Description</th><th>Tag</th><th class="col-amount">Amount</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="pager">
    <span>${from}&ndash;${to} of ${total} &middot; ${money(spend)} net spend</span>
    <span>
      <button type="button" class="btn ghost small" data-action="page-prev"
        ${state.page === 0 ? "disabled" : ""}>Newer</button>
      <button type="button" class="btn ghost small" data-action="page-next"
        ${state.page >= pages - 1 ? "disabled" : ""}>Older</button>
    </span>
  </div>`;
}

export function ledgerInspector(state) {
  if (state.creating) {
    return `<div class="inspector-head"><h3>Add a spend</h3></div>
      <p class="hint">Amounts are negative for money out. Enter a positive amount with a
      tag to record a refund.</p>
      <form id="spend-form">
        <label for="f-date">Date</label>
        <input class="field" id="f-date" name="date" type="date" value="${todayIso()}" required />
        <label for="f-description">Description</label>
        <input class="field" id="f-description" name="description" placeholder="Woolworths Surry Hills" required />
        <div class="field-row">
          <div>
            <label for="f-amount">Amount</label>
            <input class="field" id="f-amount" name="amount" type="number" step="0.01"
              placeholder="-42.50" required />
          </div>
          <div>
            <label for="f-tag">Tag</label>
            <select class="field" id="f-tag" name="tagId">${tagOptions(state.tags, null)}</select>
          </div>
        </div>
        <label for="f-merchant">Merchant <span class="muted">(optional)</span></label>
        <input class="field" id="f-merchant" name="merchant"
          placeholder="Leave blank to take it from the description" />
        <label for="f-notes">Notes</label>
        <textarea class="field" id="f-notes" name="notes" placeholder="What was this for?"></textarea>
        <label class="check">
          <input type="checkbox" name="excluded" />
          <span>Exclude from totals &mdash; for transfers between your own accounts and
          one-offs you don't want skewing the trend.</span>
        </label>
        <div class="actions">
          <button type="submit" class="btn" data-action="create-spend">Add spend</button>
          <button type="button" class="btn ghost" data-action="cancel-edit">Cancel</button>
        </div>
      </form>`;
  }

  const txn = state.ledger.transactions.find((t) => t.id === state.selectedId);
  if (!txn) {
    return `<div class="inspector-head"><h3>Spend details</h3></div>
      <p class="muted">Pick a row to edit its tag, merchant, notes, or to keep it out
      of your totals.</p>`;
  }

  const suggested = (txn.merchant || txn.description.split(" ")[0] || "").toUpperCase();

  return `<div class="inspector-head">
      <h3>${escapeHtml(txn.description)}</h3>
    </div>
    <p class="hint">${longDate(txn.date)} &middot; ${signedMoney(txn.amount)}${
      txn.tagSource === "auto" && txn.tagId ? " &middot; tagged by a rule" : ""
    }</p>
    <form id="spend-form" data-id="${txn.id}">
      <div class="field-row">
        <div>
          <label for="f-date">Date</label>
          <input class="field" id="f-date" name="date" type="date" value="${txn.date}" required />
        </div>
        <div>
          <label for="f-amount">Amount</label>
          <input class="field" id="f-amount" name="amount" type="number" step="0.01"
            value="${txn.amount}" required />
        </div>
      </div>
      <label for="f-description">Description</label>
      <input class="field" id="f-description" name="description"
        value="${escapeHtml(txn.description)}" required />
      <label for="f-merchant">Merchant</label>
      <input class="field" id="f-merchant" name="merchant" value="${escapeHtml(txn.merchant)}" />
      <p class="hint">Spends sharing a merchant group together. Rename it here to fold a
      stray branch into the rest.</p>
      <label for="f-tag">Tag</label>
      <select class="field" id="f-tag" name="tagId">${tagOptions(state.tags, txn.tagId)}</select>
      <label class="check">
        <input type="checkbox" name="remember" />
        <span>Always tag spends matching &ldquo;${escapeHtml(suggested)}&rdquo; this way</span>
      </label>
      <label for="f-notes">Notes</label>
      <textarea class="field" id="f-notes" name="notes"
        placeholder="What was this for?">${escapeHtml(txn.notes)}</textarea>
      <label class="check">
        <input type="checkbox" name="excluded" ${txn.excluded ? "checked" : ""} />
        <span>Exclude from totals &mdash; stays in the ledger, out of every chart and budget.</span>
      </label>
      <div class="actions">
        <button type="submit" class="btn">Save changes</button>
        <button type="button" class="btn danger" data-action="delete-spend"
          data-id="${txn.id}">Delete spend</button>
      </div>
    </form>`;
}

export function emptyState() {
  return `<div class="card empty">
    <h3>No spending data yet</h3>
    <p>Import a CSV or Excel export from your bank, or load a sample month to look around.</p>
    <div class="toolbar" style="justify-content:center;margin-top:18px">
      <button type="button" class="btn" data-action="nav" data-view="import">Import a file</button>
      <button type="button" class="btn ghost" data-action="load-demo">Load sample data</button>
    </div>
  </div>`;
}
