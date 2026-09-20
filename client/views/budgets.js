import { budgetMeters } from "../charts.js";
import { escapeHtml, money } from "../lib.js";

export function budgetsView(state) {
  const byTag = new Map((state.budgets || []).map((b) => [b.tagId, b]));
  const overall = byTag.get(null);
  const spendByTag = new Map((state.summary?.byTag || []).map((t) => [t.id, t.spend]));

  const rows = state.tags
    .map((tag) => {
      const budget = byTag.get(tag.id);
      const spend = spendByTag.get(tag.id) || 0;
      return `<tr style="cursor:default">
        <td>
          <span class="tag"><span class="tag-dot" style="background:${escapeHtml(
            tag.color
          )}"></span>${escapeHtml(tag.name)}</span>
        </td>
        <td class="amount">${money(spend)}</td>
        <td>
          <input class="field" type="number" min="0" step="10" style="width:120px"
            value="${budget ? budget.amount : ""}" placeholder="No cap"
            data-change="budget" data-id="${tag.id}" aria-label="Monthly cap for ${escapeHtml(
              tag.name
            )}" />
        </td>
        <td>${
          budget
            ? `<button type="button" class="btn danger small" data-action="delete-budget"
                data-id="${budget.id}">Remove</button>`
            : ""
        }</td>
      </tr>`;
    })
    .join("");

  return `
    <p class="note">Caps are monthly. Spends you've excluded from totals never count
    against a budget, and refunds pull the tag back down.</p>

    <div class="grid grid-split">
      <div class="card">
        <div class="card-head"><h2>Overall monthly cap</h2></div>
        <div class="toolbar" style="margin:0">
          <input class="search" type="number" min="0" step="50" style="max-width:180px"
            value="${overall ? overall.amount : ""}" placeholder="No overall cap"
            data-change="budget-overall" aria-label="Overall monthly cap" />
          ${
            overall
              ? `<button type="button" class="btn danger small" data-action="delete-budget"
                  data-id="${overall.id}">Remove</button>`
              : ""
          }
        </div>
        <p class="hint">One number for everything. Leave it blank to track per-tag caps only.</p>
      </div>
      <div class="card">
        <div class="card-head">
          <h2>This period</h2>
          <span class="muted" style="font-size:13px">${escapeHtml(state.period.label)}</span>
        </div>
        ${budgetMeters(state.summary?.budgets || [])}
      </div>
    </div>

    <div class="card">
      <div class="card-head"><h2>Per-tag caps</h2></div>
      <table>
        <thead><tr><th>Tag</th><th>Spent this period</th><th>Monthly cap</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}
