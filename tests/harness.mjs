// Chạy Worker ngay trong Node để kiểm thử: biên dịch TypeScript, giả lập D1 bằng node:sqlite, giả lập ASSETS bằng thư mục public/.
// Không cần wrangler hay mạng.

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync, statSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, ".test-build");

export async function loadWorker() {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  execFileSync("tsc", ["-p", ROOT, "--outDir", OUT, "--rootDir", join(ROOT, "src"), "--noEmit", "false", "--declaration", "false"], { stdio: "inherit" });
  // Node ESM cần đuôi .js trong import tương đối
  for (const f of readdirSync(OUT)) {
    if (!f.endsWith(".js")) continue;
    const p = join(OUT, f);
    writeFileSync(p, readFileSync(p, "utf8").replace(/from "(\.\/[^"]+?)"/g, (_m, s) => `from "${s.endsWith(".js") ? s : s + ".js"}"`));
  }
  return (await import(pathToFileURL(join(OUT, "index.js")).href + `?t=${Date.now()}`)).default;
}

// ---------- D1 giả lập ----------
class Stmt {
  constructor(db, sql) { this.db = db; this.sql = sql; this.params = []; }
  bind(...v) { const s = new Stmt(this.db, this.sql); s.params = v.map((x) => (typeof x === "boolean" ? Number(x) : x === undefined ? null : x)); return s; }
  first() { const r = this.db.prepare(this.sql).get(...this.params); return Promise.resolve(r ? { ...r } : null); }
  all() { const rows = this.db.prepare(this.sql).all(...this.params).map((r) => ({ ...r })); return Promise.resolve({ results: rows, success: true, meta: {} }); }
  run() {
    const info = this.db.prepare(this.sql).run(...this.params);
    return Promise.resolve({ results: [], success: true, meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } });
  }
}

export function makeDb() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const f of readdirSync(join(ROOT, "migrations")).sort()) db.exec(readFileSync(join(ROOT, "migrations", f), "utf8"));
  return {
    raw: db,
    prepare: (sql) => new Stmt(db, sql),
    async batch(stmts) {
      db.exec("BEGIN");
      try { const out = []; for (const s of stmts) out.push(await s.run()); db.exec("COMMIT"); return out; }
      catch (e) { db.exec("ROLLBACK"); throw e; }
    }
  };
}

// ---------- ASSETS giả lập (SPA fallback như Workers static assets) ----------
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".txt": "text/plain" };
export const assets = {
  async fetch(req) {
    const url = new URL(req.url);
    let p = join(ROOT, "public", decodeURIComponent(url.pathname));
    if (!p.startsWith(join(ROOT, "public"))) return new Response("bad path", { status: 400 });
    if (!existsSync(p) || statSync(p).isDirectory()) p = join(ROOT, "public", "index.html");
    return new Response(readFileSync(p), { headers: { "Content-Type": TYPES[extname(p)] || "application/octet-stream" } });
  }
};

function fakeR2() {
  const objects = new Map();
  return {
    objects,
    async put(key, value, options) { objects.set(key, { bytes: new Uint8Array(value), options }); return { key }; },
    async head(key) { return objects.has(key) ? { key } : null; }
  };
}

export function makeEnv(overrides = {}) {
  return {
    DB: makeDb(),
    ASSETS: assets,
    APP_NAME: "Duy Ơi",
    SETUP_TOKEN: "test-setup-token-123",
    ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
    MEDIA: fakeR2(),
    ...overrides
  };
}
