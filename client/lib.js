/* Small shared helpers: HTTP, formatting, and date periods. */

async function request(method, url, body) {
  const options = { method, headers: {} };
  if (body instanceof FormData) {
    options.body = body;
  } else if (body !== undefined) {
    options.headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(payload?.error || `Request failed (${response.status})`);
  }
  return payload;
}

const query = (params) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params || {})) {
    if (value !== undefined && value !== null && value !== "") search.set(key, value);
  }
  const string = search.toString();
  return string ? `?${string}` : "";
};

export const api = {
  bootstrap: () => request("GET", "/api/bootstrap"),

  summary: (params) => request("GET", `/api/summary${query(params)}`),
  transactions: (params) => request("GET", `/api/transactions${query(params)}`),
  createTransaction: (body) => request("POST", "/api/transactions", body),
  updateTransaction: (id, body) => request("PATCH", `/api/transactions/${id}`, body),
  deleteTransaction: (id) => request("DELETE", `/api/transactions/${id}`),
  bulkTransactions: (body) => request("POST", "/api/transactions/bulk", body),
  merchants: (params) => request("GET", `/api/merchants${query(params)}`),
  renameMerchant: (from, to) => request("POST", "/api/merchants/rename", { from, to }),

  tags: () => request("GET", "/api/tags"),
  createTag: (name) => request("POST", "/api/tags", { name }),
  updateTag: (id, body) => request("PATCH", `/api/tags/${id}`, body),
  deleteTag: (id) => request("DELETE", `/api/tags/${id}`),
  mergeTag: (id, intoId) => request("POST", `/api/tags/${id}/merge`, { intoId }),

  rules: () => request("GET", "/api/rules"),
  createRule: (body) => request("POST", "/api/rules", body),
  updateRule: (id, body) => request("PATCH", `/api/rules/${id}`, body),
  deleteRule: (id) => request("DELETE", `/api/rules/${id}`),
  applyRules: () => request("POST", "/api/rules/apply", {}),

  budgets: () => request("GET", "/api/budgets"),
  saveBudget: (tagId, amount) => request("PUT", "/api/budgets", { tagId, amount }),
  deleteBudget: (id) => request("DELETE", `/api/budgets/${id}`),

  uploads: () => request("GET", "/api/uploads"),
  previewUpload: (file) => {
    const form = new FormData();
    form.append("file", file);
    return request("POST", "/api/uploads/preview", form);
  },
  commitUpload: (body) => request("POST", "/api/uploads/commit", body),
  loadDemo: () => request("POST", "/api/demo", {}),
};

/* ------------------------------------------------------------- formatting */

export function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );
}

const dollars = new Intl.NumberFormat("en-AU", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const whole = new Intl.NumberFormat("en-AU", { maximumFractionDigits: 0 });

/** Spend totals: always shown as a plain positive dollar figure. */
export function money(value) {
  return `$${dollars.format(Math.abs(Number(value) || 0))}`;
}

export function roundMoney(value) {
  return `$${whole.format(Math.round(Number(value) || 0))}`;
}

/** Ledger amounts: signed, so refunds and income read differently to outflows. */
export function signedMoney(value) {
  const n = Number(value) || 0;
  if (n > 0) return `+$${dollars.format(n)}`;
  return `\u2212$${dollars.format(Math.abs(n))}`;
}

export function percentChange(current, previous) {
  if (!previous) return null;
  return (current - previous) / previous;
}

export function formatPercent(ratio) {
  const pct = Math.round(Math.abs(ratio) * 100);
  return `${ratio >= 0 ? "+" : "\u2212"}${pct}%`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function shortDate(iso) {
  const [, m, d] = String(iso).split("-");
  return `${d} ${MONTHS[Number(m) - 1]}`;
}

export function longDate(iso) {
  const [y, m, d] = String(iso).split("-");
  return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`;
}

export function monthLabel(yearMonth) {
  const [y, m] = String(yearMonth).split("-");
  return `${MONTHS[Number(m) - 1]} ${String(y).slice(2)}`;
}

export function cadenceLabel(days) {
  if (days >= 27 && days <= 32) return "monthly";
  if (days >= 13 && days <= 16) return "fortnightly";
  return `every ${days} days`;
}

/* ---------------------------------------------------------------- periods */

const pad = (n) => String(n).padStart(2, "0");
const iso = (date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

const monthStart = (year, month) => iso(new Date(year, month, 1));
const monthEnd = (year, month) => iso(new Date(year, month + 1, 0));

const DAY = 86400000;

const dayCount = (from, to) => Math.round((Date.parse(to) - Date.parse(from)) / DAY) + 1;

/** "1–16 Aug" within one month, "Apr–Jun" across several. */
function rangeLabel(from, to) {
  const [, fromMonth, fromDay] = from.split("-").map(Number);
  const [, toMonth, toDay] = to.split("-").map(Number);
  if (fromMonth === toMonth) {
    return `${fromDay}\u2013${toDay} ${MONTHS[fromMonth - 1]}`;
  }
  return `${MONTHS[fromMonth - 1]}\u2013${MONTHS[toMonth - 1]}`;
}

/**
 * The equivalent calendar stretch before this one. Every period here is
 * month-aligned, so we step back whole months rather than sliding a window,
 * which would clip rent off the front of the comparison. When the current
 * period runs past today it is only part-way through, so the earlier range is
 * trimmed to the same number of days for a like-for-like figure.
 */
function previousRange(from, to) {
  const start = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  const months =
    (end.getFullYear() - start.getFullYear()) * 12 +
    (end.getMonth() - start.getMonth()) +
    1;

  const prevFrom = monthStart(start.getFullYear(), start.getMonth() - months);
  let prevTo = iso(new Date(Date.parse(from) - DAY));

  const today = todayIso();
  if (to > today) {
    const elapsed = Math.max(1, dayCount(from, today));
    const trimmed = iso(new Date(Date.parse(prevFrom) + (elapsed - 1) * DAY));
    if (trimmed < prevTo) prevTo = trimmed;
  }

  return { prevFrom, prevTo, prevLabel: rangeLabel(prevFrom, prevTo) };
}

export const PERIOD_OPTIONS = [
  { id: "this-month", label: "This month" },
  { id: "last-month", label: "Last month" },
  { id: "quarter", label: "3 months" },
  { id: "year", label: "This year" },
  { id: "all", label: "All" },
];

export function resolvePeriod(id, bounds) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();

  let from;
  let to;
  let label;

  if (id === "last-month") {
    from = monthStart(year, month - 1);
    to = monthEnd(year, month - 1);
    label = new Date(year, month - 1, 1).toLocaleDateString("en-AU", {
      month: "long",
      year: "numeric",
    });
  } else if (id === "quarter") {
    from = monthStart(year, month - 2);
    to = monthEnd(year, month);
    label = "Last 3 months";
  } else if (id === "year") {
    from = `${year}-01-01`;
    to = `${year}-12-31`;
    label = String(year);
  } else if (id === "all") {
    from = bounds?.min || monthStart(year, month);
    to = bounds?.max || monthEnd(year, month);
    label = "All time";
  } else {
    from = monthStart(year, month);
    to = monthEnd(year, month);
    label = now.toLocaleDateString("en-AU", { month: "long", year: "numeric" });
  }

  return { id, from, to, label, ...previousRange(from, to) };
}

export function todayIso() {
  return iso(new Date());
}

/** One calendar month, for jumping straight to a point on the trend chart. */
export function monthPeriod(yearMonth) {
  const [year, month] = yearMonth.split("-").map(Number);
  const from = monthStart(year, month - 1);
  const to = monthEnd(year, month - 1);
  return {
    id: yearMonth,
    from,
    to,
    label: new Date(year, month - 1, 1).toLocaleDateString("en-AU", {
      month: "long",
      year: "numeric",
    }),
    ...previousRange(from, to),
  };
}

export function debounce(fn, wait = 220) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}
