import crypto from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import { parse as parseCsv } from "csv-parse/sync";
import { badRequest } from "./db.js";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx");

/**
 * Card-network and channel noise that sits in front of the real merchant.
 * Matched longest-first against whole words, after punctuation is stripped.
 */
const NOISE = [
  "eftpos purchase",
  "visa debit purchase",
  "visa purchase",
  "mastercard purchase",
  "card purchase",
  "direct debit",
  "osko payment",
  "eftpos",
  "bpay",
  "paypal",
  "pos",
  "sq",
  "sp",
  "tfr",
].sort((a, b) => b.length - a.length);

/** Trailing words that describe the transaction, not the merchant. */
const TAIL_NOISE = new Set([
  "refund",
  "refunded",
  "reversal",
  "reversed",
  "rebate",
  "credit",
  "adjustment",
  "chargeback",
]);

/** Words a merchant name should never end on when we truncate. */
const CONNECTORS = new Set(["to", "at", "the", "of", "and", "for", "from", "pty", "ltd"]);

const clean = (v) =>
  String(v ?? "")
    .replace(/^\uFEFF/, "")
    .trim();

const lower = (v) => clean(v).toLowerCase();

function findHeader(headers, needles) {
  return headers.find((h) => needles.some((n) => lower(h).includes(n))) || null;
}

export function guessMapping(headers) {
  const debit = findHeader(headers, ["debit", "withdrawal", "money out", "outflow", "paid out"]);
  const credit = findHeader(headers, ["credit", "deposit", "money in", "inflow", "paid in"]);
  let amount = findHeader(headers, ["amount", "value", "aud", "nzd", "usd", "total"]);
  if (debit && credit) amount = null;
  else if (amount && (amount === debit || amount === credit)) amount = null;

  return {
    date: findHeader(headers, ["date", "posted", "processed"]),
    description: findHeader(headers, [
      "description",
      "details",
      "merchant",
      "narrative",
      "particulars",
      "memo",
      "reference",
    ]),
    amount,
    debit: amount ? null : debit,
    credit: amount ? null : credit,
    account: findHeader(headers, ["account", "card", "source"]),
    dateFormat: "DMY",
    sign: amount ? "negative_expense" : "debit_credit",
  };
}

/** Mostly-digit tokens are store or reference numbers, not part of the name. */
function isStoreNumber(token) {
  const digits = (token.match(/\d/g) || []).length;
  return digits > 0 && digits / token.length >= 0.5;
}

/**
 * Collapse a bank description into a merchant we can group on, so
 * "WOOLWORTHS 1234 SURRY HILLS" and "WOOLWORTHS 8892" land together.
 */
export function deriveMerchant(description) {
  let s = clean(description).replace(/[*#]+/g, " ").replace(/\s+/g, " ").trim();
  if (!s) return "";

  // Statements sometimes stack two of these, e.g. "EFTPOS SQ *THE ...".
  for (let pass = 0; pass < 2; pass += 1) {
    const lowered = s.toLowerCase();
    const noise = NOISE.find((n) => lowered.startsWith(`${n} `));
    if (!noise) break;
    s = s.slice(noise.length).trim();
  }

  let tokens = s.split(" ").filter(Boolean);

  // Some statements stamp the transaction date in front, e.g. "12MAR NETFLIX.COM".
  while (tokens.length > 1 && /^\d{1,2}[a-z]{3}\d{0,4}$/i.test(tokens[0])) tokens.shift();

  // Cut at the first store-number-ish token, since everything from there on is
  // branch detail. "7-ELEVEN" survives; "1234", "P123" and "QF412" do not.
  const storeNumberAt = tokens.findIndex((t, i) => i > 0 && isStoreNumber(t));
  if (storeNumberAt > 0) tokens = tokens.slice(0, storeNumberAt);

  tokens = tokens.filter((t) => !/^[-–—/\\.,]+$/.test(t));

  // "KMART ALEXANDRIA REFUND" is the same merchant as "KMART ALEXANDRIA".
  while (tokens.length > 1 && TAIL_NOISE.has(tokens[tokens.length - 1].toLowerCase())) {
    tokens.pop();
  }

  // A long tail is nearly always a suburb, so keep the leading brand words,
  // but never leave the name dangling on a connector.
  if (tokens.length > 3) {
    let keep = 2;
    while (keep < tokens.length && CONNECTORS.has(tokens[keep - 1].toLowerCase())) keep += 1;
    tokens = tokens.slice(0, keep);
  }

  const merchant = tokens.join(" ").replace(/[-–—/,\s]+$/, "").trim();
  return (merchant || s).toUpperCase();
}

function excelSerialToIso(n) {
  return new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86400000)
    .toISOString()
    .slice(0, 10);
}

const pad = (n) => String(n).padStart(2, "0");

function ymd(year, month, day) {
  const y = Number(year) < 100 ? 2000 + Number(year) : Number(year);
  const m = Number(month);
  const d = Number(day);
  if (!y || m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

export function parseDate(value, format = "DMY") {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  }
  if (typeof value === "number" && value > 20000 && value < 80000) {
    return excelSerialToIso(value);
  }
  const s = clean(value);
  if (!s) return null;

  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return ymd(iso[1], iso[2], iso[3]);

  const parts = s.match(/^(\d{1,2})[/\-. ](\d{1,2}|[A-Za-z]{3,})[/\-. ](\d{2,4})/);
  if (!parts) return null;

  const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const monthWord = months.indexOf(lower(parts[2]).slice(0, 3));
  if (monthWord >= 0) return ymd(parts[3], monthWord + 1, parts[1]);

  const a = Number(parts[1]);
  const b = Number(parts[2]);
  if (format === "MDY") return ymd(parts[3], a, b);
  if (a > 12) return ymd(parts[3], b, a);
  if (b > 12) return ymd(parts[3], a, b);
  return ymd(parts[3], b, a);
}

export function parseAmount(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  let s = clean(value);
  if (!s) return null;

  const negative = /^\(.*\)$/.test(s) || s.trim().startsWith("-") || /-$/.test(s.trim());
  s = s.replace(/[()$£€A-Za-z\s]/g, "").replace(/-/g, "");
  if (!s) return null;

  if (s.includes(",") && s.includes(".")) s = s.replace(/,/g, "");
  else if (/^\d{1,3}(,\d{3})+$/.test(s)) s = s.replace(/,/g, "");
  else if (s.includes(",")) s = s.replace(",", ".");

  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return negative ? -Math.abs(n) : n;
}

export function readTable(filePath) {
  const name = filePath.toLowerCase();
  if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
    const workbook = XLSX.readFile(filePath, { cellDates: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: "" });
    return rows.filter((r) => r.some((c) => clean(c) !== ""));
  }
  const rows = parseCsv(fs.readFileSync(filePath), {
    bom: true,
    relaxColumnCount: true,
    relaxQuotes: true,
    skipEmptyLines: true,
  });
  return rows.filter((r) => r.some((c) => clean(c) !== ""));
}

function headersOf(table) {
  return table[0].map((h, i) => clean(h) || `Column ${i + 1}`);
}

export function previewTable(filePath, maxRows = 8) {
  const table = readTable(filePath);
  if (!table.length) throw badRequest("That file has no rows");
  const headers = headersOf(table);
  const rows = table.slice(1, 1 + maxRows).map((r) => headers.map((_, i) => clean(r[i])));
  return { headers, rows, totalRows: Math.max(0, table.length - 1) };
}

export function validateMapping(mapping) {
  if (!mapping?.date) throw badRequest("Choose which column holds the date");
  if (!mapping?.description) throw badRequest("Choose which column holds the description");
  const split = mapping.debit || mapping.credit;
  if (split && !(mapping.debit && mapping.credit)) {
    throw badRequest("Map both debit and credit, or use a single amount column");
  }
  if (!split && !mapping.amount) throw badRequest("Choose which column holds the amount");
}

export function applyMapping(filePath, mapping) {
  validateMapping(mapping);
  const table = readTable(filePath);
  if (!table.length) return [];

  const headers = headersOf(table);
  const indexOf = new Map(headers.map((h, i) => [h, i]));
  const cell = (row, header) => {
    if (!header) return "";
    const i = indexOf.get(header);
    return i == null ? "" : row[i];
  };

  const rows = [];
  const seen = new Set();

  for (const raw of table.slice(1)) {
    const date = parseDate(cell(raw, mapping.date), mapping.dateFormat || "DMY");
    const description = clean(cell(raw, mapping.description));
    if (!date || !description) continue;

    let amount;
    if (mapping.debit || mapping.credit) {
      const debit = Math.abs(parseAmount(cell(raw, mapping.debit)) || 0);
      const credit = Math.abs(parseAmount(cell(raw, mapping.credit)) || 0);
      if (!debit && !credit) continue;
      amount = credit - debit;
    } else {
      amount = parseAmount(cell(raw, mapping.amount));
      if (amount == null || amount === 0) continue;
      if (mapping.sign === "positive_expense") amount = -Math.abs(amount);
    }

    const account = clean(cell(raw, mapping.account));
    const hash = crypto
      .createHash("sha256")
      .update(
        `${date}|${description.replace(/\s+/g, " ").toUpperCase()}|${amount.toFixed(2)}|${account}`
      )
      .digest("hex");
    if (seen.has(hash)) continue;
    seen.add(hash);

    rows.push({
      date,
      description,
      merchant: deriveMerchant(description),
      amount,
      account,
      hash,
    });
  }
  return rows;
}
