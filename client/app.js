import {
  PERIOD_OPTIONS,
  api,
  debounce,
  escapeHtml,
  monthPeriod,
  resolvePeriod,
} from "./lib.js";
import { MONTH_CHART_ID, monthlyChart } from "./charts.js";
import { overviewView } from "./views/overview.js";
import {
  PAGE_SIZE,
  emptyState,
  ledgerBulk,
  ledgerChips,
  ledgerInspector,
  ledgerShell,
  ledgerTable,
} from "./views/ledger.js";
import { tagsView } from "./views/tags.js";
import { budgetsView } from "./views/budgets.js";
import { importView } from "./views/import.js";

const VIEWS = [
  ["overview", "Overview"],
  ["ledger", "Ledger"],
  ["tags", "Tags & rules"],
  ["budgets", "Budgets"],
  ["import", "Import"],
];

const state = {
  view: "overview",
  periodId: "this-month",
  period: resolvePeriod("this-month"),
  bounds: null,
  transactionCount: 0,
  tags: [],
  rules: [],
  budgets: [],
  summary: null,
  recurringExpanded: false,
  ledger: { transactions: [], total: 0, spend: 0 },
  merchants: [],
  groupByMerchant: false,
  filters: { q: "", tag: null, untagged: false, excluded: false, merchant: null },
  page: 0,
  selectedId: null,
  creating: false,
  checked: new Set(),
  uploads: [],
  importPreview: null,
  importResult: null,
};

const nav = document.getElementById("nav");
const periods = document.getElementById("periods");
const viewEl = document.getElementById("view");

/* ------------------------------------------------------------------ notices */

let noticeTimer;

function notify(message, isError = false) {
  document.querySelector(".notice")?.remove();
  const el = document.createElement("div");
  el.className = `notice ${isError ? "error" : ""}`;
  el.textContent = message;
  document.body.append(el);
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => el.remove(), isError ? 6000 : 3200);
}

/** Every handler funnels through here so a failed request never leaves a dead UI. */
async function guard(work, successMessage) {
  try {
    const result = await work();
    if (successMessage) notify(successMessage);
    return result;
  } catch (error) {
    notify(error.message, true);
    return null;
  }
}

/* ---------------------------------------------------------------- rendering */

function renderChrome() {
  nav.innerHTML = VIEWS.map(
    ([id, label]) =>
      `<button type="button" data-action="nav" data-view="${id}" ${
        state.view === id ? 'aria-current="page"' : ""
      }>${escapeHtml(label)}</button>`
  ).join("");

  periods.innerHTML = PERIOD_OPTIONS.map(
    (option) =>
      `<button type="button" data-action="period" data-period="${option.id}" ${
        state.periodId === option.id ? 'aria-current="true"' : ""
      }>${escapeHtml(option.label)}</button>`
  ).join("");
}

function renderLedgerParts() {
  document.getElementById("ledger-chips").innerHTML = ledgerChips(state);
  document.getElementById("ledger-bulk").innerHTML = ledgerBulk(state);
  document.getElementById("ledger-table").innerHTML = ledgerTable(state);
  document.getElementById("ledger-inspector").innerHTML = ledgerInspector(state);
}

/** Draws the monthly chart at the measured width of its card. */
function mountMonthlyChart() {
  const slot = document.getElementById(MONTH_CHART_ID);
  if (!slot || !state.summary) return;
  slot.innerHTML = monthlyChart(
    state.summary.monthly,
    state.summary.from.slice(0, 7),
    slot.clientWidth
  );
}

function viewHtml() {
  const needsData = ["overview", "ledger", "budgets"].includes(state.view);
  if (needsData && !state.transactionCount) return emptyState();

  if (state.view === "overview") return overviewView(state);
  if (state.view === "ledger") return ledgerShell(state);
  if (state.view === "tags") return tagsView(state);
  if (state.view === "budgets") return budgetsView(state);
  return importView(state);
}

function render({ partial = false } = {}) {
  renderChrome();

  const canPatchLedger =
    partial && state.view === "ledger" && document.getElementById("ledger-table");

  if (canPatchLedger) {
    renderLedgerParts();
    return;
  }

  viewEl.innerHTML = viewHtml();
  if (state.view === "ledger" && state.transactionCount) {
    renderLedgerParts();
    attachLedger();
  }
  if (state.view === "import") attachImport();
  if (state.view === "overview") mountMonthlyChart();
}

// Redraw rather than rescale, so the chart keeps one unit per pixel at any width.
window.addEventListener("resize", debounce(mountMonthlyChart, 120));

/* ------------------------------------------------------------- data loading */

async function loadView({ partial = false } = {}) {
  const { from, to, prevFrom, prevTo } = state.period;

  await guard(async () => {
    if (state.view === "overview") {
      state.summary = await api.summary({ from, to, prevFrom, prevTo });
    } else if (state.view === "ledger") {
      if (state.groupByMerchant) {
        state.merchants = await api.merchants({ from, to });
      } else {
        state.ledger = await api.transactions({
          from,
          to,
          q: state.filters.q || undefined,
          tag: state.filters.tag || undefined,
          merchant: state.filters.merchant || undefined,
          untagged: state.filters.untagged ? "1" : undefined,
          // Excluded spends stay in the ledger, struck through, so they are easy
          // to find and undo. The chip narrows down to just those.
          excluded: state.filters.excluded ? "1" : undefined,
          limit: PAGE_SIZE,
          offset: state.page * PAGE_SIZE,
        });
      }
    } else if (state.view === "tags") {
      const [tags, rules] = await Promise.all([api.tags(), api.rules()]);
      state.tags = tags;
      state.rules = rules;
    } else if (state.view === "budgets") {
      const [budgets, summary] = await Promise.all([
        api.budgets(),
        api.summary({ from, to }),
      ]);
      state.budgets = budgets;
      state.summary = summary;
    } else if (state.view === "import") {
      state.uploads = await api.uploads();
    }
  });

  render({ partial });
}

/** Tag edits ripple into every view, so refresh the shared copy. */
async function refreshTags() {
  const tags = await api.tags();
  state.tags = tags;
}

async function refreshCounts() {
  const boot = await api.bootstrap();
  state.transactionCount = boot.transactionCount;
  state.bounds = boot.bounds;
  state.tags = boot.tags;
  if (state.periodId === "all") state.period = resolvePeriod("all", state.bounds);
}

/* -------------------------------------------------------------- navigation */

function setView(view, { replace = false } = {}) {
  state.view = view;
  state.checked.clear();
  if (replace) window.history.replaceState(null, "", `#/${view}`);
  else window.location.hash = `#/${view}`;
}

function setPeriod(id) {
  state.periodId = id;
  state.period = resolvePeriod(id, state.bounds);
  state.page = 0;
}

function resetFilters(patch = {}) {
  state.filters = { q: state.filters.q, tag: null, untagged: false, excluded: false, merchant: null, ...patch };
  state.page = 0;
  state.selectedId = null;
  state.creating = false;
  state.checked.clear();
  state.groupByMerchant = false;

  // The search box lives in the shell, which partial renders leave alone.
  const search = document.getElementById("ledger-search");
  if (search && search.value !== state.filters.q) search.value = state.filters.q;
}

/* ---------------------------------------------------------------- listeners */

function attachLedger() {
  const search = document.getElementById("ledger-search");
  if (!search) return;
  search.addEventListener(
    "input",
    debounce((event) => {
      state.filters.q = event.target.value.trim();
      state.page = 0;
      loadView({ partial: true });
    })
  );
}

function attachImport() {
  const zone = document.getElementById("drop-zone");
  const input = document.getElementById("file-input");
  if (!zone || !input) return;

  input.addEventListener("change", () => {
    if (input.files?.[0]) handleFile(input.files[0]);
  });

  for (const type of ["dragenter", "dragover"]) {
    zone.addEventListener(type, (event) => {
      event.preventDefault();
      zone.classList.add("over");
    });
  }
  for (const type of ["dragleave", "drop"]) {
    zone.addEventListener(type, (event) => {
      event.preventDefault();
      zone.classList.remove("over");
    });
  }
  zone.addEventListener("drop", (event) => {
    const file = event.dataTransfer?.files?.[0];
    if (file) handleFile(file);
  });
}

async function handleFile(file) {
  const preview = await guard(() => api.previewUpload(file));
  if (!preview) return;
  state.importResult = null;
  state.importPreview = {
    previewId: preview.previewId,
    originalName: preview.originalName,
    headers: preview.headers,
    rows: preview.rows,
    totalRows: preview.totalRows,
    mapping: preview.guessed,
  };
  render();
}

/* ------------------------------------------------------------------ actions */

async function saveSpendForm(form) {
  const data = new FormData(form);
  const merchant = data.get("merchant");
  const body = {
    date: data.get("date"),
    description: String(data.get("description") || "").trim(),
    amount: Number(data.get("amount")),
    tagId: data.get("tagId") ? Number(data.get("tagId")) : null,
    notes: String(data.get("notes") || ""),
    excluded: data.get("excluded") === "on",
  };
  if (merchant !== null) body.merchant = String(merchant).trim();

  if (data.get("remember") === "on" && body.tagId) {
    body.remember = true;
    body.pattern = (body.merchant || body.description.split(" ")[0] || "").toLowerCase();
  }

  const id = form.dataset.id;
  const result = await guard(
    () => (id ? api.updateTransaction(id, body) : api.createTransaction(body)),
    id ? "Spend updated" : "Spend added"
  );
  if (!result) return;

  if (result.rule) {
    notify(`Saved, and anything matching "${result.rule.pattern}" is now ${result.rule.tagName}`);
  }

  // A brand new spend would hide behind whatever filter is active, so clear them.
  if (!id) resetFilters({ q: "" });

  state.creating = false;
  state.selectedId = result.transaction.id;
  await refreshCounts();
  await loadView({ partial: true });
}

async function bulk(patch, message) {
  const ids = [...state.checked];
  const done = await guard(() => api.bulkTransactions({ ids, ...patch }), message);
  if (!done) return;
  state.checked.clear();
  await loadView({ partial: true });
}

const ACTIONS = {
  nav: (el) => setView(el.dataset.view),

  period: (el) => {
    setPeriod(el.dataset.period);
    loadView({ partial: true });
  },

  "pick-month": (el) => {
    const month = el.dataset.month;
    const now = new Date();
    const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

    if (month === thisMonth) {
      setPeriod("this-month");
    } else {
      state.period = monthPeriod(month);
      state.periodId = month;
      state.page = 0;
    }
    loadView({ partial: true });
  },

  "toggle-recurring": () => {
    state.recurringExpanded = !state.recurringExpanded;
    render();
  },

  "review-untagged": () => {
    resetFilters({ untagged: true });
    setView("ledger");
  },

  "filter-tag": (el) => {
    resetFilters({ tag: Number(el.dataset.id) });
    setView("ledger");
  },

  "filter-merchant": (el) => {
    const merchant = el.dataset.name;
    resetFilters({ merchant });
    if (el.dataset.scope === "all" && state.periodId !== "all") {
      setPeriod("all");
      notify(`Showing all time for ${merchant}`);
    }
    setView("ledger");
  },

  "filter-all": () => {
    resetFilters();
    loadView({ partial: true });
  },

  "filter-untagged": () => {
    const on = !state.filters.untagged;
    resetFilters({ untagged: on });
    loadView({ partial: true });
  },

  "filter-excluded": () => {
    const on = !state.filters.excluded;
    resetFilters({ excluded: on });
    loadView({ partial: true });
  },

  "toggle-group": () => {
    state.groupByMerchant = !state.groupByMerchant;
    state.page = 0;
    render();
    loadView({ partial: true });
  },

  "page-prev": () => {
    state.page = Math.max(0, state.page - 1);
    loadView({ partial: true });
  },

  "page-next": () => {
    state.page += 1;
    loadView({ partial: true });
  },

  "select-row": (el) => {
    state.selectedId = Number(el.dataset.id);
    state.creating = false;
    renderLedgerParts();
  },

  "toggle-check": (el) => {
    const id = Number(el.dataset.id);
    if (state.checked.has(id)) state.checked.delete(id);
    else state.checked.add(id);
    renderLedgerParts();
  },

  "toggle-check-all": (el) => {
    if (el.checked) for (const t of state.ledger.transactions) state.checked.add(t.id);
    else state.checked.clear();
    renderLedgerParts();
  },

  "bulk-exclude": () => bulk({ excluded: true }, "Excluded from totals"),
  "bulk-include": () => bulk({ excluded: false }, "Back in your totals"),
  "bulk-clear": () => {
    state.checked.clear();
    renderLedgerParts();
  },

  "add-spend": () => {
    state.creating = true;
    state.selectedId = null;
    renderLedgerParts();
  },

  "cancel-edit": () => {
    state.creating = false;
    renderLedgerParts();
  },

  "delete-spend": async (el) => {
    if (!confirm("Delete this spend for good?")) return;
    const done = await guard(() => api.deleteTransaction(el.dataset.id), "Spend deleted");
    if (!done) return;
    state.selectedId = null;
    await refreshCounts();
    await loadView({ partial: true });
  },

  "apply-rules": async () => {
    const result = await guard(() => api.applyRules());
    if (!result) return;
    notify(
      result.tagged
        ? `Tagged ${result.tagged} of ${result.considered} untagged spends`
        : "No untagged spends matched a rule"
    );
    await loadView();
  },

  "delete-tag": async (el) => {
    if (!confirm(`Delete "${el.dataset.name}"? Its spends become untagged.`)) return;
    const done = await guard(() => api.deleteTag(el.dataset.id), "Tag deleted");
    if (done) await loadView();
  },

  "delete-rule": async (el) => {
    const done = await guard(() => api.deleteRule(el.dataset.id), "Rule deleted");
    if (done) await loadView();
  },

  "delete-budget": async (el) => {
    const done = await guard(() => api.deleteBudget(el.dataset.id), "Budget removed");
    if (done) await loadView();
  },

  "choose-file": () => document.getElementById("file-input")?.click(),

  "cancel-import": () => {
    state.importPreview = null;
    render();
  },

  "toggle-amount-mode": () => {
    const { mapping, headers } = state.importPreview;
    if (mapping.debit || mapping.credit) {
      mapping.debit = null;
      mapping.credit = null;
      mapping.amount = headers.find((h) => /amount|value/i.test(h)) || headers[0];
      mapping.sign = "negative_expense";
    } else {
      mapping.amount = null;
      mapping.debit = headers.find((h) => /debit|out|withdraw/i.test(h)) || headers[0];
      mapping.credit = headers.find((h) => /credit|in|deposit/i.test(h)) || headers[0];
    }
    render();
  },

  "commit-import": async () => {
    const { previewId, originalName, mapping } = state.importPreview;
    const stats = await guard(() =>
      api.commitUpload({ previewId, originalName, mapping })
    );
    if (!stats) return;
    state.importPreview = null;
    state.importResult = stats;
    notify(`Added ${stats.inserted} spends, ${stats.autoTagged} tagged automatically`);
    await refreshCounts();
    await loadView();
  },

  "load-demo": async () => {
    const stats = await guard(() => api.loadDemo());
    if (!stats) return;
    notify(`Loaded ${stats.inserted} sample spends`);
    await refreshCounts();
    setPeriod(state.periodId);
    setView("overview");
  },
};

document.addEventListener("click", (event) => {
  const target = event.target.closest("[data-action]");
  if (!target) return;
  const handler = ACTIONS[target.dataset.action];
  if (!handler) return;

  // A checkbox inside a row must not also trigger the row's own action.
  if (target.dataset.action === "select-row" && event.target.closest("input")) return;
  if (target.tagName !== "INPUT") event.preventDefault();
  handler(target);
});

const CHANGES = {
  "bulk-tag": (el) => {
    if (!el.value) return;
    bulk({ tagId: Number(el.value) }, "Tag applied");
  },

  "tag-name": async (el) => {
    const done = await guard(() => api.updateTag(el.dataset.id, { name: el.value }));
    if (done) await loadView();
  },

  "tag-color": async (el) => {
    const done = await guard(() => api.updateTag(el.dataset.id, { color: el.value }));
    if (done) await loadView();
  },

  "tag-merge": async (el) => {
    if (!el.value) return;
    const into = state.tags.find((t) => t.id === Number(el.value));
    const from = state.tags.find((t) => t.id === Number(el.dataset.id));
    if (!confirm(`Move everything from "${from.name}" into "${into.name}" and delete it?`)) {
      el.value = "";
      return;
    }
    const done = await guard(() => api.mergeTag(el.dataset.id, el.value), "Tags merged");
    if (done) await loadView();
  },

  "rule-enabled": async (el) => {
    const done = await guard(() => api.updateRule(el.dataset.id, { enabled: el.checked }));
    if (done) await loadView();
  },

  "rule-pattern": async (el) => {
    const done = await guard(() => api.updateRule(el.dataset.id, { pattern: el.value }));
    if (done) await loadView();
  },

  "rule-tag": async (el) => {
    const done = await guard(() => api.updateRule(el.dataset.id, { tagId: Number(el.value) }));
    if (done) await loadView();
  },

  "rule-priority": async (el) => {
    const done = await guard(() =>
      api.updateRule(el.dataset.id, { priority: Number(el.value) })
    );
    if (done) await loadView();
  },

  budget: async (el) => {
    if (el.value === "") return;
    const done = await guard(
      () => api.saveBudget(Number(el.dataset.id), Number(el.value)),
      "Budget saved"
    );
    if (done) await loadView();
  },

  "budget-overall": async (el) => {
    if (el.value === "") return;
    const done = await guard(() => api.saveBudget(null, Number(el.value)), "Overall cap saved");
    if (done) await loadView();
  },

  mapping: (el) => {
    const { mapping } = state.importPreview;
    mapping[el.dataset.field] = el.value || null;
    render();
  },
};

document.addEventListener("change", (event) => {
  const target = event.target.closest("[data-change]");
  if (!target) return;
  CHANGES[target.dataset.change]?.(target);
});

document.addEventListener("submit", async (event) => {
  const form = event.target;
  event.preventDefault();

  if (form.id === "spend-form") {
    await saveSpendForm(form);
    return;
  }

  if (form.id === "tag-form") {
    const name = new FormData(form).get("name");
    const done = await guard(() => api.createTag(name), "Tag added");
    if (done) {
      form.reset();
      await refreshTags();
      await loadView();
    }
    return;
  }

  if (form.id === "rule-form") {
    const data = new FormData(form);
    const done = await guard(
      () =>
        api.createRule({
          pattern: data.get("pattern"),
          matchType: data.get("matchType"),
          tagId: Number(data.get("tagId")),
        }),
      "Rule added"
    );
    if (done) {
      form.reset();
      await loadView();
    }
  }
});

/* ------------------------------------------------------------------- router */

function viewFromHash() {
  const id = window.location.hash.replace(/^#\/?/, "");
  return VIEWS.some(([v]) => v === id) ? id : "overview";
}

window.addEventListener("hashchange", () => {
  state.view = viewFromHash();
  state.checked.clear();
  window.scrollTo({ top: 0 });
  loadView();
});

async function start() {
  const boot = await guard(() => api.bootstrap());
  if (!boot) {
    viewEl.innerHTML = `<div class="card empty"><h3>Can't reach the server</h3>
      <p>Start it with <code>npm run dev</code> and reload.</p></div>`;
    return;
  }

  state.tags = boot.tags;
  state.budgets = boot.budgets;
  state.transactionCount = boot.transactionCount;
  state.bounds = boot.bounds;
  state.view = viewFromHash();
  setPeriod(state.periodId);

  await loadView();
}

start();
