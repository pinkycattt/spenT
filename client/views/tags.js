import { escapeHtml } from "../lib.js";

const MATCH_LABELS = {
  contains: "contains",
  equals: "is exactly",
  regex: "regex",
};

function tagRows(state) {
  if (!state.tags.length) return `<p class="muted">No tags yet.</p>`;

  return `<table>
    <thead><tr><th></th><th>Tag</th><th>Spends</th><th>Merge into</th><th></th></tr></thead>
    <tbody>${state.tags
      .map(
        (tag) => `<tr style="cursor:default">
          <td class="col-check">
            <input type="color" value="${escapeHtml(tag.color)}" data-change="tag-color"
              data-id="${tag.id}" aria-label="Colour for ${escapeHtml(tag.name)}"
              style="width:22px;height:22px;padding:0;border:0;background:none" />
          </td>
          <td><input class="field" value="${escapeHtml(tag.name)}" data-change="tag-name"
            data-id="${tag.id}" aria-label="Name" /></td>
          <td class="muted">${tag.useCount}</td>
          <td>
            <select class="field" data-change="tag-merge" data-id="${tag.id}" aria-label="Merge into">
              <option value="">&mdash;</option>
              ${state.tags
                .filter((other) => other.id !== tag.id)
                .map((other) => `<option value="${other.id}">${escapeHtml(other.name)}</option>`)
                .join("")}
            </select>
          </td>
          <td><button type="button" class="btn danger small" data-action="delete-tag"
            data-id="${tag.id}" data-name="${escapeHtml(tag.name)}">Delete</button></td>
        </tr>`
      )
      .join("")}</tbody>
  </table>`;
}

function ruleRows(state) {
  if (!state.rules.length) {
    return `<p class="muted">No rules yet. Tag a spend and tick &ldquo;always tag spends
    matching this&rdquo; to create one from real data.</p>`;
  }

  return `<table>
    <thead><tr>
      <th>On</th><th>When description</th><th>Then tag</th><th>Priority</th><th></th>
    </tr></thead>
    <tbody>${state.rules
      .map(
        (rule) => `<tr style="cursor:default">
          <td class="col-check"><input type="checkbox" data-change="rule-enabled" data-id="${rule.id}"
            ${rule.enabled ? "checked" : ""} aria-label="Enabled" /></td>
          <td>
            <span class="muted" style="font-size:12.5px">${MATCH_LABELS[rule.matchType]}</span>
            <input class="field" value="${escapeHtml(rule.pattern)}" data-change="rule-pattern"
              data-id="${rule.id}" aria-label="Pattern" style="margin-top:3px" />
          </td>
          <td>
            <select class="field" data-change="rule-tag" data-id="${rule.id}" aria-label="Tag">
              ${state.tags
                .map(
                  (tag) =>
                    `<option value="${tag.id}" ${
                      tag.id === rule.tagId ? "selected" : ""
                    }>${escapeHtml(tag.name)}</option>`
                )
                .join("")}
            </select>
          </td>
          <td><input class="field" type="number" value="${rule.priority}" data-change="rule-priority"
            data-id="${rule.id}" aria-label="Priority" style="width:72px" /></td>
          <td><button type="button" class="btn danger small" data-action="delete-rule"
            data-id="${rule.id}">Delete</button></td>
        </tr>`
      )
      .join("")}</tbody>
  </table>`;
}

export function tagsView(state) {
  return `
    <p class="note">Each spend carries one tag, so the numbers always add up. Rules tag
    new imports automatically; anything you set by hand is never overwritten.</p>

    <div class="card" style="margin-bottom:14px">
      <div class="card-head">
        <h2>Tags</h2>
        <form id="tag-form" class="toolbar" style="margin:0">
          <input class="search" name="name" placeholder="New tag name" required
            style="min-width:180px" />
          <button type="submit" class="btn small">Add tag</button>
        </form>
      </div>
      ${tagRows(state)}
    </div>

    <div class="card">
      <div class="card-head">
        <h2>Auto-tagging rules</h2>
        <button type="button" class="btn ghost small" data-action="apply-rules">
          Apply rules to untagged
        </button>
      </div>
      <form id="rule-form" class="toolbar">
        <input class="search" name="pattern" placeholder="Text to look for, e.g. woolworths" required />
        <select class="field" name="matchType" style="width:auto">
          <option value="contains">contains</option>
          <option value="equals">is exactly</option>
          <option value="regex">regex</option>
        </select>
        <select class="field" name="tagId" style="width:auto" required>
          ${state.tags.map((t) => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join("")}
        </select>
        <button type="submit" class="btn small">Add rule</button>
      </form>
      ${ruleRows(state)}
      <p class="hint">Rules run highest priority first, and match against both the raw
      description and the grouped merchant name.</p>
    </div>
  `;
}
