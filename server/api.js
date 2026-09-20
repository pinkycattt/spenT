import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import express from "express";
import multer from "multer";
import {
  ROOT,
  TMP_DIR,
  UPLOADS_DIR,
  SWATCHES,
  badRequest,
  bulkUpdate,
  countTransactions,
  createRule,
  createTag,
  createTransaction,
  createUpload,
  dateBounds,
  deleteBudget,
  deleteRule,
  deleteTag,
  deleteTransaction,
  finishUpload,
  getSettings,
  getSummary,
  getTransaction,
  insertImported,
  listBudgets,
  listMerchants,
  listRules,
  listTags,
  listTransactions,
  listUploads,
  mergeTags,
  renameMerchant,
  saveSettings,
  updateRule,
  updateTag,
  updateTransaction,
  upsertBudget,
} from "./db.js";
import { applyMapping, deriveMerchant, guessMapping, previewTable } from "./parse.js";
import { applyRules, suggestPattern } from "./rules.js";
import { recurringSummary } from "./recurring.js";

const ALLOWED_EXTENSIONS = new Set([".csv", ".xlsx", ".xls"]);
const upload = multer({ dest: TMP_DIR, limits: { fileSize: 20 * 1024 * 1024 } });

export const api = express.Router();
api.use(express.json({ limit: "2mb" }));

const wrap = (handler) => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch(next);

function requireRange(query) {
  const { from, to } = query;
  if (!from || !to) throw badRequest("A date range is required");
  return { from, to };
}

/* ------------------------------------------------------------------ startup */

api.get("/bootstrap", (req, res) => {
  res.json({
    settings: getSettings(),
    tags: listTags(),
    budgets: listBudgets(),
    swatches: SWATCHES,
    transactionCount: countTransactions(),
    bounds: dateBounds(),
  });
});

api.put(
  "/settings",
  wrap((req, res) => res.json(saveSettings(req.body || {})))
);

/* --------------------------------------------------------------------- tags */

api.get("/tags", (req, res) => res.json(listTags()));

api.post(
  "/tags",
  wrap((req, res) => res.json(createTag(req.body?.name, req.body?.color)))
);

api.patch(
  "/tags/:id",
  wrap((req, res) => res.json(updateTag(Number(req.params.id), req.body || {})))
);

api.delete(
  "/tags/:id",
  wrap((req, res) => {
    deleteTag(Number(req.params.id));
    res.json({ tags: listTags() });
  })
);

api.post(
  "/tags/:id/merge",
  wrap((req, res) => {
    mergeTags(Number(req.params.id), Number(req.body?.intoId));
    res.json({ tags: listTags() });
  })
);

/* -------------------------------------------------------------------- rules */

api.get("/rules", (req, res) => res.json(listRules()));

api.post(
  "/rules",
  wrap((req, res) => res.json(createRule(req.body || {})))
);

api.patch(
  "/rules/:id",
  wrap((req, res) => res.json(updateRule(Number(req.params.id), req.body || {})))
);

api.delete(
  "/rules/:id",
  wrap((req, res) => {
    deleteRule(Number(req.params.id));
    res.json({ rules: listRules() });
  })
);

api.post(
  "/rules/apply",
  wrap((req, res) => res.json(applyRules(req.body?.ids || null)))
);

api.get("/rules/suggest", (req, res) => {
  res.json({ pattern: suggestPattern(req.query.q || "") });
});

/* ------------------------------------------------------------------ budgets */

api.get("/budgets", (req, res) => res.json(listBudgets()));

api.put(
  "/budgets",
  wrap((req, res) => {
    const tagId = req.body?.tagId == null ? null : Number(req.body.tagId);
    res.json(upsertBudget(tagId, req.body?.amount));
  })
);

api.delete(
  "/budgets/:id",
  wrap((req, res) => res.json(deleteBudget(Number(req.params.id))))
);

/* ------------------------------------------------------------- transactions */

api.get(
  "/transactions",
  wrap((req, res) => {
    const { excluded } = req.query;
    res.json(
      listTransactions({
        from: req.query.from,
        to: req.query.to,
        q: req.query.q,
        tag: req.query.tag,
        merchant: req.query.merchant,
        untagged: req.query.untagged === "1",
        excluded: excluded === "1" ? true : excluded === "0" ? false : undefined,
        limit: req.query.limit,
        offset: req.query.offset,
      })
    );
  })
);

api.post(
  "/transactions",
  wrap((req, res) => {
    const body = req.body || {};
    const transaction = createTransaction({
      ...body,
      merchant: body.merchant || deriveMerchant(body.description),
    });
    res.json({ transaction });
  })
);

api.patch(
  "/transactions/:id",
  wrap((req, res) => {
    const id = Number(req.params.id);
    const body = { ...(req.body || {}) };
    const current = getTransaction(id);
    if (!current) throw badRequest("Spend not found");

    // Clearing the merchant would drop the spend out of every merchant view,
    // so fall back to deriving one again.
    if (body.merchant !== undefined && !String(body.merchant).trim()) {
      body.merchant = deriveMerchant(body.description ?? current.description);
    }

    // "Always tag things like this" turns the correction into a reusable rule.
    let rule = null;
    if (body.remember && body.tagId) {
      const pattern = body.pattern || suggestPattern(current.merchant || current.description);
      if (pattern) {
        rule = createRule({ pattern, tagId: Number(body.tagId), priority: 20 });
      }
    }

    res.json({ transaction: updateTransaction(id, body), rule });
  })
);

api.delete(
  "/transactions/:id",
  wrap((req, res) => {
    deleteTransaction(Number(req.params.id));
    res.json({ ok: true });
  })
);

api.post(
  "/transactions/bulk",
  wrap((req, res) => {
    const { ids, ...patch } = req.body || {};
    res.json({ updated: bulkUpdate(ids, patch) });
  })
);

api.get(
  "/merchants",
  wrap((req, res) => res.json(listMerchants(requireRange(req.query))))
);

api.post(
  "/merchants/rename",
  wrap((req, res) => {
    res.json({ updated: renameMerchant(req.body?.from, req.body?.to) });
  })
);

/* --------------------------------------------------------- summary + trends */

api.get(
  "/summary",
  wrap((req, res) => {
    const { from, to } = requireRange(req.query);
    const summary = getSummary({
      from,
      to,
      prevFrom: req.query.prevFrom,
      prevTo: req.query.prevTo,
    });
    res.json({ ...summary, recurring: recurringSummary(from, to, summary.spend) });
  })
);

api.get(
  "/recurring",
  wrap((req, res) => {
    const { from, to } = requireRange(req.query);
    const summary = getSummary({ from, to });
    res.json(recurringSummary(from, to, summary.spend));
  })
);

/* ------------------------------------------------------------------ uploads */

api.get("/uploads", (req, res) => res.json(listUploads()));

api.post(
  "/uploads/preview",
  upload.single("file"),
  wrap((req, res) => {
    if (!req.file) throw badRequest("Choose a file first");
    const extension = path.extname(req.file.originalname || "").toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(extension)) {
      fs.rmSync(req.file.path, { force: true });
      throw badRequest("Upload a CSV or Excel file");
    }

    const previewId = crypto.randomUUID();
    const staged = path.join(TMP_DIR, `${previewId}${extension}`);
    fs.renameSync(req.file.path, staged);

    try {
      const preview = previewTable(staged);
      res.json({
        previewId,
        originalName: req.file.originalname,
        ...preview,
        guessed: guessMapping(preview.headers),
      });
    } catch (error) {
      fs.rmSync(staged, { force: true });
      throw error;
    }
  })
);

api.post(
  "/uploads/commit",
  wrap((req, res) => {
    const { previewId, originalName, mapping } = req.body || {};
    if (!previewId || !/^[\w-]+$/.test(previewId)) throw badRequest("Upload the file again");

    const staged = fs.readdirSync(TMP_DIR).find((f) => f.startsWith(previewId));
    if (!staged) throw badRequest("That upload expired, please choose the file again");

    const stagedPath = path.join(TMP_DIR, staged);
    const rows = applyMapping(stagedPath, mapping);
    if (!rows.length) {
      throw badRequest("No rows could be read with that column mapping");
    }

    const safeName = path.basename(originalName || staged).replace(/[^\w.\- ]/g, "_");
    const filename = `${Date.now()}-${safeName}`;
    fs.renameSync(stagedPath, path.join(UPLOADS_DIR, filename));

    const uploadId = createUpload({ filename, originalName: safeName, mapping });
    const { inserted, skipped, ids } = insertImported(rows, uploadId);
    const tagged = applyRules(ids);
    finishUpload(uploadId, { inserted, skipped, autoTagged: tagged.tagged });

    res.json({
      parsed: rows.length,
      inserted,
      skipped,
      autoTagged: tagged.tagged,
      untagged: tagged.untagged,
    });
  })
);

api.post(
  "/demo",
  wrap((req, res) => {
    const sample = path.join(ROOT, "data", "sample.csv");
    if (!fs.existsSync(sample)) throw badRequest("The sample file is missing");

    const mapping = {
      date: "Date",
      description: "Description",
      amount: null,
      debit: "Debit",
      credit: "Credit",
      account: null,
      dateFormat: "DMY",
      sign: "debit_credit",
    };
    const rows = applyMapping(sample, mapping);
    const filename = `${Date.now()}-sample.csv`;
    fs.copyFileSync(sample, path.join(UPLOADS_DIR, filename));

    const uploadId = createUpload({ filename, originalName: "sample.csv", mapping });
    const { inserted, skipped, ids } = insertImported(rows, uploadId);
    const tagged = applyRules(ids);
    finishUpload(uploadId, { inserted, skipped, autoTagged: tagged.tagged });

    if (!listBudgets().length) {
      const byName = new Map(listTags().map((t) => [t.name, t.id]));
      upsertBudget(null, 4200);
      upsertBudget(byName.get("Housing"), 2500);
      upsertBudget(byName.get("Groceries"), 600);
      upsertBudget(byName.get("Dining"), 120);
      upsertBudget(byName.get("Subscriptions"), 40);
    }

    res.json({ inserted, skipped, autoTagged: tagged.tagged });
  })
);
