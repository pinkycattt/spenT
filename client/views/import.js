import { escapeHtml, longDate } from "../lib.js";

const FIELDS = [
  ["date", "Date column", true],
  ["description", "Description column", true],
];

function columnSelect(name, headers, selected, { allowNone = false } = {}) {
  const options = [
    allowNone ? `<option value="">&mdash; none &mdash;</option>` : "",
    ...headers.map(
      (h) =>
        `<option value="${escapeHtml(h)}" ${selected === h ? "selected" : ""}>${escapeHtml(
          h
        )}</option>`
    ),
  ].join("");
  return `<select class="field" data-change="mapping" data-field="${name}">${options}</select>`;
}

function mapper(preview) {
  const { headers, rows, mapping, totalRows, originalName } = preview;
  const usingSplit = Boolean(mapping.debit || mapping.credit);

  const amountBlock = usingSplit
    ? `<div>
        <label>Money out column</label>
        ${columnSelect("debit", headers, mapping.debit, { allowNone: true })}
      </div>
      <div>
        <label>Money in column</label>
        ${columnSelect("credit", headers, mapping.credit, { allowNone: true })}
      </div>`
    : `<div>
        <label>Amount column</label>
        ${columnSelect("amount", headers, mapping.amount, { allowNone: true })}
      </div>
      <div>
        <label>Sign convention</label>
        <select class="field" data-change="mapping" data-field="sign">
          <option value="negative_expense" ${
            mapping.sign !== "positive_expense" ? "selected" : ""
          }>Expenses are negative</option>
          <option value="positive_expense" ${
            mapping.sign === "positive_expense" ? "selected" : ""
          }>Expenses are positive</option>
        </select>
      </div>`;

  return `<div class="card" style="margin-bottom:14px">
    <div class="card-head">
      <h2>Map the columns</h2>
      <span class="muted" style="font-size:13px">${escapeHtml(
        originalName
      )} &middot; ${totalRows} rows</span>
    </div>

    <div class="grid" style="grid-template-columns:1fr 1fr;gap:10px 14px">
      ${FIELDS.map(
        ([name, label]) => `<div>
          <label>${label}</label>
          ${columnSelect(name, headers, mapping[name])}
        </div>`
      ).join("")}
      ${amountBlock}
      <div>
        <label>Date order</label>
        <select class="field" data-change="mapping" data-field="dateFormat">
          <option value="DMY" ${
            mapping.dateFormat !== "MDY" ? "selected" : ""
          }>Day first (31/12/2026)</option>
          <option value="MDY" ${
            mapping.dateFormat === "MDY" ? "selected" : ""
          }>Month first (12/31/2026)</option>
        </select>
      </div>
      <div>
        <label>Account column (optional)</label>
        ${columnSelect("account", headers, mapping.account, { allowNone: true })}
      </div>
    </div>

    <p class="hint">
      ${
        usingSplit
          ? "Using separate money-in and money-out columns."
          : "Using a single signed amount column."
      }
      <button type="button" class="link" data-action="toggle-amount-mode">
        ${usingSplit ? "Use one amount column instead" : "My file splits money in and out"}
      </button>
    </p>

    <div class="toolbar" style="margin:16px 0 0">
      <button type="button" class="btn" data-action="commit-import">Import ${totalRows} rows</button>
      <button type="button" class="btn ghost" data-action="cancel-import">Cancel</button>
    </div>
  </div>

  <div class="card mapper" style="margin-bottom:14px">
    <div class="card-head"><h2>First few rows, as read</h2></div>
    <table>
      <thead><tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr></thead>
      <tbody>${rows
        .map(
          (row) =>
            `<tr style="cursor:default">${row
              .map((cell) => `<td>${escapeHtml(cell)}</td>`)
              .join("")}</tr>`
        )
        .join("")}</tbody>
    </table>
  </div>`;
}

function result(stats) {
  return `<div class="card" style="margin-bottom:14px">
    <div class="card-head"><h2>Import finished</h2></div>
    <div class="stat-row">
      <div class="stat"><div class="value">${stats.inserted}</div><div class="label">added</div></div>
      <div class="stat"><div class="value">${stats.skipped}</div><div class="label">duplicates skipped</div></div>
      <div class="stat"><div class="value">${stats.autoTagged}</div><div class="label">auto-tagged</div></div>
      <div class="stat"><div class="value">${stats.untagged ?? 0}</div><div class="label">still untagged</div></div>
    </div>
    <div class="toolbar" style="margin:16px 0 0">
      <button type="button" class="btn" data-action="nav" data-view="overview">See the overview</button>
      ${
        stats.untagged
          ? `<button type="button" class="btn ghost" data-action="review-untagged">Tag the rest</button>`
          : ""
      }
    </div>
  </div>`;
}

export function importView(state) {
  const history = state.uploads?.length
    ? `<table>
        <thead><tr><th>File</th><th>Added</th><th>Skipped</th><th>Auto-tagged</th><th>When</th></tr></thead>
        <tbody>${state.uploads
          .map(
            (u) => `<tr style="cursor:default">
              <td>${escapeHtml(u.filename)}</td>
              <td class="muted">${u.inserted}</td>
              <td class="muted">${u.skipped}</td>
              <td class="muted">${u.autoTagged}</td>
              <td class="muted">${longDate(u.createdAt.slice(0, 10))}</td>
            </tr>`
          )
          .join("")}</tbody>
      </table>`
    : `<p class="muted">No imports yet.</p>`;

  return `
    <p class="note">Drop in a CSV or Excel export from your bank. Rows are matched on date,
    description, and amount, so re-importing an overlapping statement won't double anything up.</p>

    ${state.importResult ? result(state.importResult) : ""}

    ${
      state.importPreview
        ? mapper(state.importPreview)
        : `<div class="drop" id="drop-zone">
            <div>
              <h3>Drop a statement here</h3>
              <p class="muted">CSV, XLSX or XLS &middot; up to 20 MB</p>
              <div class="toolbar" style="justify-content:center;margin-top:16px">
                <button type="button" class="btn" data-action="choose-file">Choose a file</button>
                <button type="button" class="btn ghost" data-action="load-demo">Load sample data</button>
              </div>
            </div>
            <input type="file" id="file-input" accept=".csv,.xlsx,.xls" hidden />
          </div>`
    }

    <div class="card">
      <div class="card-head"><h2>Import history</h2></div>
      ${history}
    </div>
  `;
}
