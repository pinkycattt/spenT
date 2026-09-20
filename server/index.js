import fs from "node:fs";
import path from "node:path";
import express from "express";
import { api } from "./api.js";
import { DATA_DIR, ROOT, TMP_DIR } from "./db.js";

const PORT = Number(process.env.PORT) || 3456;

/**
 * Loopback only. The API has no authentication, so binding every interface would
 * put the whole ledger on the local network for anyone who knows the port. Set
 * HOST=0.0.0.0 deliberately, and only behind something that does authenticate.
 */
const HOST = process.env.HOST || "127.0.0.1";
const DAY = 24 * 60 * 60 * 1000;

// Staged uploads only matter until the mapping is confirmed.
try {
  for (const name of fs.readdirSync(TMP_DIR)) {
    const file = path.join(TMP_DIR, name);
    if (Date.now() - fs.statSync(file).mtimeMs > DAY) fs.rmSync(file, { force: true });
  }
} catch {
  /* nothing staged yet */
}

const app = express();
app.use("/api", api);

if (process.env.NODE_ENV === "production") {
  const dist = path.join(ROOT, "dist");
  app.use(express.static(dist));
  app.get("*", (req, res) => res.sendFile(path.join(dist, "index.html")));
}

app.use((error, req, res, _next) => {
  if (!error.status) console.error(error);
  res.status(error.status || 500).json({
    error: error.status ? error.message : "Something went wrong on the server",
  });
});

app.listen(PORT, HOST, () => {
  console.log(`spenT api listening on http://${HOST}:${PORT}`);
  console.log(`spending data: ${DATA_DIR}`);
});
