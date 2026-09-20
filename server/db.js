import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.join(__dirname, "..");

/**
 * Where the OS expects per-user application data to live. Keeping spending data
 * out of ROOT means a stray `git add -f` cannot commit it, and a checkout of
 * this repo never carries anyone's transactions with it.
 */
function platformDataDir() {
  const home = os.homedir();
  if (process.platform === "darwin") {
    return path.join(home, "Library", "Application Support", "spenT");
  }
  if (process.platform === "win32") {
    const roaming = process.env.APPDATA || path.join(home, "AppData", "Roaming");
    return path.join(roaming, "spenT");
  }
  const xdg = process.env.XDG_DATA_HOME || path.join(home, ".local", "share");
  return path.join(xdg, "spent");
}

/** Set SPENT_DATA_DIR to run against a second profile or a mounted volume. */
export const DATA_DIR = process.env.SPENT_DATA_DIR
  ? path.resolve(process.env.SPENT_DATA_DIR)
  : platformDataDir();
export const UPLOADS_DIR = path.join(DATA_DIR, "uploads");
export const TMP_DIR = path.join(DATA_DIR, "tmp");

/** Tag swatches, drawn from the app's stone / denim / oxblood palette. */
export const SWATCHES = [
  "#2f4a6e",
  "#9b2c2c",
  "#1c1f24",
  "#4c6b8a",
  "#6d7480",
  "#7a5230",
  "#3f6152",
  "#5b4a72",
  "#8a6d3b",
  "#3d5a7a",
];

const SEED_TAGS = [
  ["Groceries", "#2f4a6e"],
  ["Dining", "#9b2c2c"],
  ["Coffee", "#7a5230"],
  ["Transport", "#4c6b8a"],
  ["Housing", "#1c1f24"],
  ["Utilities", "#6d7480"],
  ["Health", "#3f6152"],
  ["Shopping", "#5b4a72"],
  ["Entertainment", "#8a6d3b"],
  ["Subscriptions", "#3d5a7a"],
  ["Travel", "#3d5a7a"],
];

const SEED_RULES = [
  ["woolworths", "Groceries", 10],
  ["coles", "Groceries", 10],
  ["aldi", "Groceries", 10],
  ["iga", "Groceries", 8],
  ["uber trip", "Transport", 12],
  ["opal", "Transport", 10],
  ["netflix", "Subscriptions", 10],
  ["spotify", "Subscriptions", 10],
  ["apple.com/bill", "Subscriptions", 10],
  ["icloud", "Subscriptions", 8],
  ["origin energy", "Utilities", 10],
  ["telstra", "Utilities", 10],
  ["optus", "Utilities", 8],
  ["rent", "Housing", 12],
  ["chemist", "Health", 8],
  ["guzman", "Dining", 10],
  ["menulog", "Dining", 10],
  ["doordash", "Dining", 10],
  ["mcdonald", "Dining", 8],
  ["starbucks", "Coffee", 10],
  ["gloria jean", "Coffee", 8],
  ["coffee", "Coffee", 6],
  ["bunnings", "Shopping", 8],
  ["kmart", "Shopping", 8],
  ["event cinemas", "Entertainment", 10],
  ["qantas", "Travel", 10],
];

fs.mkdirSync(UPLOADS_DIR, { recursive: true });
fs.mkdirSync(TMP_DIR, { recursive: true });

export const db = new Database(path.join(DATA_DIR, "spent.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  color TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS uploads (
  id INTEGER PRIMARY KEY,
  filename TEXT NOT NULL,
  original_name TEXT NOT NULL,
  mapping TEXT NOT NULL,
  inserted INTEGER NOT NULL DEFAULT 0,
  skipped INTEGER NOT NULL DEFAULT 0,
  auto_tagged INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL,
  description TEXT NOT NULL,
  merchant TEXT NOT NULL DEFAULT '',
  amount REAL NOT NULL,
  account TEXT,
  notes TEXT NOT NULL DEFAULT '',
  excluded INTEGER NOT NULL DEFAULT 0,
  tag_id INTEGER REFERENCES tags(id) ON DELETE SET NULL,
  tag_source TEXT NOT NULL DEFAULT 'manual' CHECK(tag_source IN ('auto','manual')),
  source_file_id INTEGER REFERENCES uploads(id),
  row_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS rules (
  id INTEGER PRIMARY KEY,
  pattern TEXT NOT NULL,
  match_type TEXT NOT NULL DEFAULT 'contains' CHECK(match_type IN ('contains','equals','regex')),
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  priority INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS budgets (
  id INTEGER PRIMARY KEY,
  tag_id INTEGER UNIQUE REFERENCES tags(id) ON DELETE CASCADE,
  amount REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_txn_date ON transactions(date);
CREATE INDEX IF NOT EXISTS idx_txn_tag ON transactions(tag_id);
CREATE INDEX IF NOT EXISTS idx_txn_merchant ON transactions(merchant);
`);

const nowIso = () => new Date().toISOString();

/**
 * Spend, in positive dollars. Outflows count up; refunds (positive amounts that
 * kept a tag) count back down. Untagged income and excluded rows contribute nothing.
 */
const SPEND = `-SUM(CASE
    WHEN t.excluded = 1 THEN 0
    WHEN t.amount < 0 THEN t.amount
    WHEN t.tag_id IS NOT NULL THEN t.amount
    ELSE 0 END)`;

const INCOME = `SUM(CASE
    WHEN t.excluded = 1 THEN 0
    WHEN t.amount > 0 AND t.tag_id IS NULL THEN t.amount
    ELSE 0 END)`;

/* ---------------------------------------------------------------- settings */

function getSetting(key, fallback = null) {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key);
  return row ? row.value : fallback;
}

function setSetting(key, value) {
  db.prepare(
    `INSERT INTO settings(key, value) VALUES(?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, String(value));
}

if (!getSetting("currency")) setSetting("currency", "AUD");

export function getSettings() {
  return { currency: getSetting("currency", "AUD") };
}

export function saveSettings(patch) {
  if (patch.currency) setSetting("currency", patch.currency);
  return getSettings();
}

/* -------------------------------------------------------------------- tags */

export function listTags() {
  return db
    .prepare(
      `SELECT tg.id, tg.name, tg.color,
              (SELECT COUNT(*) FROM transactions t WHERE t.tag_id = tg.id) AS useCount
       FROM tags tg ORDER BY tg.name`
    )
    .all();
}

export function getTag(id) {
  return db.prepare("SELECT id, name, color FROM tags WHERE id = ?").get(id) || null;
}

export function createTag(name, color) {
  const trimmed = String(name || "").trim();
  if (!trimmed) throw badRequest("Tag name is required");
  const existing = db
    .prepare("SELECT id, name, color FROM tags WHERE lower(name) = lower(?)")
    .get(trimmed);
  if (existing) return existing;
  const taken = new Set(db.prepare("SELECT color FROM tags").all().map((r) => r.color));
  const picked = color || SWATCHES.find((c) => !taken.has(c)) || SWATCHES[0];
  const { lastInsertRowid } = db
    .prepare("INSERT INTO tags(name, color, created_at) VALUES(?, ?, ?)")
    .run(trimmed, picked, nowIso());
  return getTag(lastInsertRowid);
}

export function updateTag(id, patch) {
  const current = getTag(id);
  if (!current) throw badRequest("Tag not found");
  db.prepare("UPDATE tags SET name = ?, color = ? WHERE id = ?").run(
    patch.name?.trim() || current.name,
    patch.color || current.color,
    id
  );
  return getTag(id);
}

export function deleteTag(id) {
  db.prepare("DELETE FROM tags WHERE id = ?").run(id);
}

export function mergeTags(fromId, intoId) {
  if (Number(fromId) === Number(intoId)) throw badRequest("Cannot merge a tag into itself");
  if (!getTag(intoId)) throw badRequest("Target tag not found");
  db.transaction(() => {
    db.prepare("UPDATE transactions SET tag_id = ? WHERE tag_id = ?").run(intoId, fromId);
    db.prepare("UPDATE rules SET tag_id = ? WHERE tag_id = ?").run(intoId, fromId);
    db.prepare("DELETE FROM budgets WHERE tag_id = ?").run(fromId);
    db.prepare("DELETE FROM tags WHERE id = ?").run(fromId);
  })();
}

/* ------------------------------------------------------------------- rules */

export function listRules() {
  return db
    .prepare(
      `SELECT r.id, r.pattern, r.match_type AS matchType, r.tag_id AS tagId,
              r.priority, r.enabled, tg.name AS tagName, tg.color AS tagColor
       FROM rules r JOIN tags tg ON tg.id = r.tag_id
       ORDER BY r.priority DESC, r.id`
    )
    .all()
    .map((r) => ({ ...r, enabled: Boolean(r.enabled) }));
}

export function enabledRules() {
  return db
    .prepare("SELECT * FROM rules WHERE enabled = 1 ORDER BY priority DESC, id")
    .all();
}

export function createRule({ pattern, matchType = "contains", tagId, priority = 0 }) {
  const p = String(pattern || "").trim();
  if (!p) throw badRequest("Rule pattern is required");
  if (!getTag(tagId)) throw badRequest("Rule needs a valid tag");
  if (!["contains", "equals", "regex"].includes(matchType)) {
    throw badRequest("Unknown match type");
  }
  if (matchType === "regex") {
    try {
      new RegExp(p, "i");
    } catch {
      throw badRequest("That regular expression is not valid");
    }
  }
  const dupe = db
    .prepare(
      "SELECT id FROM rules WHERE lower(pattern) = lower(?) AND match_type = ? AND tag_id = ?"
    )
    .get(p, matchType, tagId);
  if (dupe) return listRules().find((r) => r.id === dupe.id);
  const { lastInsertRowid } = db
    .prepare(
      `INSERT INTO rules(pattern, match_type, tag_id, priority, enabled, created_at)
       VALUES(?, ?, ?, ?, 1, ?)`
    )
    .run(p, matchType, tagId, Number(priority) || 0, nowIso());
  return listRules().find((r) => r.id === Number(lastInsertRowid));
}

export function updateRule(id, patch) {
  const current = db.prepare("SELECT * FROM rules WHERE id = ?").get(id);
  if (!current) throw badRequest("Rule not found");
  db.prepare(
    `UPDATE rules SET pattern = ?, match_type = ?, tag_id = ?, priority = ?, enabled = ?
     WHERE id = ?`
  ).run(
    patch.pattern?.trim() || current.pattern,
    patch.matchType || current.match_type,
    patch.tagId || current.tag_id,
    patch.priority ?? current.priority,
    patch.enabled === undefined ? current.enabled : patch.enabled ? 1 : 0,
    id
  );
  return listRules().find((r) => r.id === Number(id));
}

export function deleteRule(id) {
  db.prepare("DELETE FROM rules WHERE id = ?").run(id);
}

/* ----------------------------------------------------------------- budgets */

export function listBudgets() {
  return db
    .prepare(
      `SELECT b.id, b.tag_id AS tagId, b.amount, tg.name AS tagName, tg.color AS tagColor
       FROM budgets b LEFT JOIN tags tg ON tg.id = b.tag_id
       ORDER BY CASE WHEN b.tag_id IS NULL THEN 0 ELSE 1 END, tg.name`
    )
    .all();
}

export function upsertBudget(tagId, amount) {
  const n = Number(amount);
  if (!Number.isFinite(n) || n < 0) throw badRequest("Budget must be zero or more");
  if (tagId == null) {
    const existing = db.prepare("SELECT id FROM budgets WHERE tag_id IS NULL").get();
    if (existing) db.prepare("UPDATE budgets SET amount = ? WHERE id = ?").run(n, existing.id);
    else db.prepare("INSERT INTO budgets(tag_id, amount) VALUES(NULL, ?)").run(n);
  } else {
    if (!getTag(tagId)) throw badRequest("Budget needs a valid tag");
    db.prepare(
      `INSERT INTO budgets(tag_id, amount) VALUES(?, ?)
       ON CONFLICT(tag_id) DO UPDATE SET amount = excluded.amount`
    ).run(tagId, n);
  }
  return listBudgets();
}

export function deleteBudget(id) {
  db.prepare("DELETE FROM budgets WHERE id = ?").run(id);
  return listBudgets();
}

/* ------------------------------------------------------------ transactions */

const TXN_COLUMNS = `t.id, t.date, t.description, t.merchant, t.amount, t.account,
  t.notes, t.excluded, t.tag_id AS tagId, t.tag_source AS tagSource,
  tg.name AS tagName, tg.color AS tagColor`;

function mapTxn(row) {
  if (!row) return null;
  return { ...row, excluded: Boolean(row.excluded) };
}

export function getTransaction(id) {
  return mapTxn(
    db
      .prepare(
        `SELECT ${TXN_COLUMNS} FROM transactions t
         LEFT JOIN tags tg ON tg.id = t.tag_id WHERE t.id = ?`
      )
      .get(id)
  );
}

export function listTransactions(opts = {}) {
  const where = [];
  const params = {};
  if (opts.from) {
    where.push("t.date >= @from");
    params.from = opts.from;
  }
  if (opts.to) {
    where.push("t.date <= @to");
    params.to = opts.to;
  }
  if (opts.q) {
    where.push("(t.description LIKE @q OR t.merchant LIKE @q OR t.notes LIKE @q)");
    params.q = `%${opts.q}%`;
  }
  if (opts.tag) {
    where.push("t.tag_id = @tag");
    params.tag = Number(opts.tag);
  }
  if (opts.merchant) {
    where.push("t.merchant = @merchant");
    params.merchant = opts.merchant;
  }
  if (opts.untagged) where.push("t.tag_id IS NULL");
  if (opts.excluded === true) where.push("t.excluded = 1");
  if (opts.excluded === false) where.push("t.excluded = 0");

  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const limit = Math.min(Number(opts.limit) || 400, 2000);
  const offset = Number(opts.offset) || 0;

  const totals = db
    .prepare(
      `SELECT COUNT(*) AS count, ${SPEND} AS spend FROM transactions t ${clause}`
    )
    .get(params);
  const transactions = db
    .prepare(
      `SELECT ${TXN_COLUMNS} FROM transactions t
       LEFT JOIN tags tg ON tg.id = t.tag_id
       ${clause}
       ORDER BY t.date DESC, t.id DESC
       LIMIT @limit OFFSET @offset`
    )
    .all({ ...params, limit, offset })
    .map(mapTxn);

  return {
    total: totals.count,
    spend: totals.spend || 0,
    transactions,
  };
}

export function createTransaction(input) {
  const row = normaliseInput(input);
  const { lastInsertRowid } = db
    .prepare(
      `INSERT INTO transactions
        (date, description, merchant, amount, account, notes, excluded,
         tag_id, tag_source, source_file_id, row_hash, created_at)
       VALUES(@date, @description, @merchant, @amount, @account, @notes, @excluded,
              @tagId, @tagSource, NULL, @rowHash, @createdAt)`
    )
    .run({ ...row, createdAt: nowIso() });
  return getTransaction(lastInsertRowid);
}

function normaliseInput(input) {
  const date = String(input.date || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw badRequest("A valid date is required");
  const description = String(input.description || "").trim();
  if (!description) throw badRequest("A description is required");
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount === 0) {
    throw badRequest("Amount must be a non-zero number");
  }
  const tagId = input.tagId ? Number(input.tagId) : null;
  if (tagId && !getTag(tagId)) throw badRequest("That tag no longer exists");
  return {
    date,
    description,
    merchant: String(input.merchant || description).trim(),
    amount,
    account: input.account ? String(input.account).trim() : null,
    notes: String(input.notes || "").trim(),
    excluded: input.excluded ? 1 : 0,
    tagId,
    tagSource: "manual",
    rowHash: `manual:${date}:${description}:${amount}:${Date.now()}:${Math.random()}`,
  };
}

export function updateTransaction(id, patch) {
  const current = getTransaction(id);
  if (!current) throw badRequest("Spend not found");

  const next = {
    date: patch.date === undefined ? current.date : String(patch.date).slice(0, 10),
    description:
      patch.description === undefined
        ? current.description
        : String(patch.description).trim(),
    merchant:
      patch.merchant === undefined ? current.merchant : String(patch.merchant).trim(),
    amount: patch.amount === undefined ? current.amount : Number(patch.amount),
    notes: patch.notes === undefined ? current.notes : String(patch.notes),
    excluded:
      patch.excluded === undefined ? (current.excluded ? 1 : 0) : patch.excluded ? 1 : 0,
    tagId: patch.tagId === undefined ? current.tagId : patch.tagId,
  };

  if (!/^\d{4}-\d{2}-\d{2}$/.test(next.date)) throw badRequest("A valid date is required");
  if (!next.description) throw badRequest("A description is required");
  if (!Number.isFinite(next.amount) || next.amount === 0) {
    throw badRequest("Amount must be a non-zero number");
  }
  if (next.tagId != null) {
    next.tagId = Number(next.tagId);
    if (!getTag(next.tagId)) throw badRequest("That tag no longer exists");
  }

  // Any hand-edit of the tag makes it manual, so rules stop overwriting it.
  const tagSource =
    patch.tagId !== undefined && Number(patch.tagId || 0) !== Number(current.tagId || 0)
      ? "manual"
      : current.tagSource;

  db.prepare(
    `UPDATE transactions SET date = @date, description = @description, merchant = @merchant,
       amount = @amount, notes = @notes, excluded = @excluded, tag_id = @tagId,
       tag_source = @tagSource
     WHERE id = @id`
  ).run({ ...next, tagSource, id });

  return getTransaction(id);
}

export function deleteTransaction(id) {
  db.prepare("DELETE FROM transactions WHERE id = ?").run(id);
}

export function bulkUpdate(ids, patch) {
  const list = (ids || []).map(Number).filter(Boolean);
  if (!list.length) throw badRequest("Select at least one spend");
  const placeholders = list.map(() => "?").join(",");
  db.transaction(() => {
    if (patch.tagId !== undefined) {
      const tagId = patch.tagId == null ? null : Number(patch.tagId);
      if (tagId != null && !getTag(tagId)) throw badRequest("That tag no longer exists");
      db.prepare(
        `UPDATE transactions SET tag_id = ?, tag_source = 'manual' WHERE id IN (${placeholders})`
      ).run(tagId, ...list);
    }
    if (patch.excluded !== undefined) {
      db.prepare(
        `UPDATE transactions SET excluded = ? WHERE id IN (${placeholders})`
      ).run(patch.excluded ? 1 : 0, ...list);
    }
    if (patch.merchant !== undefined) {
      db.prepare(
        `UPDATE transactions SET merchant = ? WHERE id IN (${placeholders})`
      ).run(String(patch.merchant).trim(), ...list);
    }
  })();
  return list.length;
}

/** Rewrite one merchant name everywhere it appears. */
export function renameMerchant(from, to) {
  const target = String(to || "").trim();
  if (!target) throw badRequest("Merchant name is required");
  const { changes } = db
    .prepare("UPDATE transactions SET merchant = ? WHERE merchant = ?")
    .run(target, from);
  return changes;
}

export function insertImported(rows, uploadId) {
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO transactions
      (date, description, merchant, amount, account, notes, excluded,
       tag_id, tag_source, source_file_id, row_hash, created_at)
     VALUES(?, ?, ?, ?, ?, '', 0, NULL, 'auto', ?, ?, ?)`
  );
  return db.transaction((items) => {
    const ids = [];
    for (const row of items) {
      const info = stmt.run(
        row.date,
        row.description,
        row.merchant,
        row.amount,
        row.account || null,
        uploadId,
        row.hash,
        nowIso()
      );
      if (info.changes) ids.push(Number(info.lastInsertRowid));
    }
    return { inserted: ids.length, skipped: items.length - ids.length, ids };
  })(rows);
}

export function untaggedIds(ids = null) {
  if (ids?.length) {
    const placeholders = ids.map(() => "?").join(",");
    return db
      .prepare(
        `SELECT id, description, merchant FROM transactions
         WHERE tag_id IS NULL AND id IN (${placeholders})`
      )
      .all(...ids);
  }
  return db
    .prepare("SELECT id, description, merchant FROM transactions WHERE tag_id IS NULL")
    .all();
}

export function applyTagFromRule(txnId, tagId) {
  db.prepare(
    "UPDATE transactions SET tag_id = ?, tag_source = 'auto' WHERE id = ? AND tag_id IS NULL"
  ).run(tagId, txnId);
}

/* ----------------------------------------------------------------- uploads */

export function createUpload({ filename, originalName, mapping }) {
  const { lastInsertRowid } = db
    .prepare(
      `INSERT INTO uploads(filename, original_name, mapping, created_at)
       VALUES(?, ?, ?, ?)`
    )
    .run(filename, originalName, JSON.stringify(mapping), nowIso());
  return Number(lastInsertRowid);
}

export function finishUpload(id, { inserted, skipped, autoTagged }) {
  db.prepare(
    "UPDATE uploads SET inserted = ?, skipped = ?, auto_tagged = ? WHERE id = ?"
  ).run(inserted, skipped, autoTagged, id);
}

export function listUploads() {
  return db
    .prepare(
      `SELECT id, original_name AS filename, inserted, skipped,
              auto_tagged AS autoTagged, created_at AS createdAt
       FROM uploads ORDER BY id DESC LIMIT 20`
    )
    .all();
}

/* ----------------------------------------------------------------- summary */

export function dateBounds() {
  return db
    .prepare("SELECT MIN(date) AS min, MAX(date) AS max FROM transactions")
    .get();
}

export function countTransactions() {
  return db.prepare("SELECT COUNT(*) AS n FROM transactions").get().n;
}

export function getSummary({ from, to, prevFrom, prevTo }) {
  const period = db
    .prepare(
      `SELECT ${SPEND} AS spend, ${INCOME} AS income,
              COUNT(*) AS count,
              SUM(CASE WHEN t.excluded = 1 THEN 1 ELSE 0 END) AS excludedCount
       FROM transactions t WHERE t.date BETWEEN ? AND ?`
    )
    .get(from, to);

  const previous = prevFrom
    ? db
        .prepare(
          `SELECT ${SPEND} AS spend FROM transactions t WHERE t.date BETWEEN ? AND ?`
        )
        .get(prevFrom, prevTo)
    : { spend: 0 };

  const byTag = db
    .prepare(
      `SELECT tg.id, tg.name, tg.color, ${SPEND} AS spend, COUNT(*) AS count
       FROM transactions t JOIN tags tg ON tg.id = t.tag_id
       WHERE t.date BETWEEN ? AND ? AND t.excluded = 0
       GROUP BY tg.id HAVING spend > 0
       ORDER BY spend DESC`
    )
    .all(from, to);

  const untagged = db
    .prepare(
      `SELECT ${SPEND} AS spend, COUNT(*) AS count
       FROM transactions t
       WHERE t.date BETWEEN ? AND ? AND t.excluded = 0
         AND t.tag_id IS NULL AND t.amount < 0`
    )
    .get(from, to);

  const monthly = db
    .prepare(
      `SELECT substr(t.date, 1, 7) AS month, ${SPEND} AS spend
       FROM transactions t GROUP BY month ORDER BY month`
    )
    .all();

  const topMerchants = db
    .prepare(
      `SELECT t.merchant AS name, ${SPEND} AS spend, COUNT(*) AS count
       FROM transactions t
       WHERE t.date BETWEEN ? AND ? AND t.excluded = 0
       GROUP BY t.merchant HAVING spend > 0
       ORDER BY spend DESC LIMIT 8`
    )
    .all(from, to);

  const spendByTag = new Map(byTag.map((t) => [t.id, t.spend]));
  const budgets = listBudgets().map((b) => ({
    ...b,
    spend: b.tagId == null ? period.spend || 0 : spendByTag.get(b.tagId) || 0,
  }));

  return {
    from,
    to,
    spend: period.spend || 0,
    income: period.income || 0,
    count: period.count || 0,
    excludedCount: period.excludedCount || 0,
    previousSpend: previous.spend || 0,
    byTag,
    untagged: { spend: untagged.spend || 0, count: untagged.count || 0 },
    monthly,
    topMerchants,
    budgets,
  };
}

export function listMerchants({ from, to }) {
  return db
    .prepare(
      `SELECT t.merchant AS name, ${SPEND} AS spend, COUNT(*) AS count,
              MAX(t.date) AS lastDate
       FROM transactions t
       WHERE t.date BETWEEN ? AND ? AND t.excluded = 0 AND t.merchant <> ''
       GROUP BY t.merchant HAVING spend > 0
       ORDER BY spend DESC`
    )
    .all(from, to);
}

/** Every non-excluded outflow, for recurring detection. */
export function merchantCharges() {
  return db
    .prepare(
      `SELECT merchant, date, -amount AS amount
       FROM transactions
       WHERE excluded = 0 AND amount < 0 AND merchant <> ''
       ORDER BY merchant, date`
    )
    .all();
}

export function spendBetweenForMerchants(from, to, merchants) {
  if (!merchants.length) return 0;
  const placeholders = merchants.map(() => "?").join(",");
  const row = db
    .prepare(
      `SELECT ${SPEND} AS spend FROM transactions t
       WHERE t.date BETWEEN ? AND ? AND t.merchant IN (${placeholders})`
    )
    .get(from, to, ...merchants);
  return row.spend || 0;
}

/* ------------------------------------------------------------------- seeds */

if (db.prepare("SELECT COUNT(*) AS n FROM tags").get().n === 0) {
  db.transaction(() => {
    const insertTag = db.prepare(
      "INSERT INTO tags(name, color, created_at) VALUES(?, ?, ?)"
    );
    const insertRule = db.prepare(
      `INSERT INTO rules(pattern, match_type, tag_id, priority, enabled, created_at)
       VALUES(?, 'contains', ?, ?, 1, ?)`
    );
    const ids = {};
    for (const [name, color] of SEED_TAGS) {
      ids[name] = Number(insertTag.run(name, color, nowIso()).lastInsertRowid);
    }
    for (const [pattern, tagName, priority] of SEED_RULES) {
      insertRule.run(pattern, ids[tagName], priority, nowIso());
    }
  })();
}

export function badRequest(message) {
  return Object.assign(new Error(message), { status: 400 });
}
