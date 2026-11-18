// Bộ đo riêng cho site tĩnh (Astro trên Cloudflare): lượt xem, thời gian đọc thật, độ cuộn, click link affiliate, link ra ngoài, CTA, tốc độ (LCP).
// - Mỗi tên miền một đường dẫn ngẫu nhiên (/_xxxxxxxx/) và một Worker riêng gắn route trên chính tên miền đó: không cookie, không lưu IP,
//   không tên miền dùng chung giữa các site (không lộ liên hệ giữa các site).
// - Thêm được tên miền khi site CHƯA có: anh dán 1 dòng script vào layout ngay; Worker được dựng khi tên miền vào tài khoản Cloudflare
//   (cron tự thử lại mỗi giờ). Trước đó script chỉ 404 lặng lẽ, không ảnh hưởng site.
// - Dữ liệu thô ở Workers Analytics Engine (giữ 3 tháng); cron gộp theo ngày vào D1 để giữ lâu và cho agent đọc.

import { logActivity } from "./activity";
import { cf, creds } from "./cfmedia";
import { HttpError, json, now, readJson } from "./http";
import type { DbStatement, Env, User } from "./types";

export const DATASET = "duyoi_events";
const MARKER = "duyoi-stats-v1";
const slug = (d: string) => d.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
export const statsWorkerName = (domain: string) => `duyoi-st-${slug(domain)}`.slice(0, 63).replace(/-$/, "");
// Astro xử lý mọi thẻ <script> lúc build: phải có is:inline để giữ nguyên thẻ (file s.js chỉ có trên Cloudflare, không có trong repo)
export const snippetFor = (path: string) => `<script is:inline defer src="${path}/s.js"></script>`;
export const htmlSnippetFor = (path: string) => `<script defer src="${path}/s.js"></script>`;

export function normDomain(v: unknown): string {
  let s = String(v || "").trim().toLowerCase();
  if (!s) return "";
  if (!/^https?:\/\//.test(s)) s = `https://${s}`;
  try {
    const h = new URL(s).hostname.replace(/^www\./, "");
    return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(h) ? h : "";
  } catch { return ""; }
}

// Script chạy trong trình duyệt khách (khoảng 1,3 KB). Gửi: pv (vào trang), leave (thời gian đọc khi tab đang mở, độ cuộn lớn nhất, LCP),
// aff (click link rel="sponsored" hoặc data-dy-aff), out (link ra ngoài), cta (link trong vùng data-dy-cta).
export function trackerJs(path: string): string {
  return `/*${MARKER}*/(function(){var n=navigator;if(n.webdriver||/bot|crawl|spider|headless|lighthouse|preview/i.test(n.userAgent))return;
var E=${JSON.stringify(path)}+"/e",P=location.pathname,H=location.hostname,v=document.visibilityState==="visible"?Date.now():0,g=0,m=0,l=0,f=1;
function S(o){var b=JSON.stringify(o);try{if(n.sendBeacon&&n.sendBeacon(E,b))return}catch(e){}try{fetch(E,{method:"POST",body:b,keepalive:true})}catch(e){}}
var r="";try{if(document.referrer){var u=new URL(document.referrer);if(u.hostname!==H)r=u.hostname.replace(/^www\\./,"")}}catch(e){}
var q=new URLSearchParams(location.search).get("utm_source");if(q)r="utm:"+q.slice(0,40);S({t:"pv",p:P,r:r});
function sc(){var h=document.documentElement,s=Math.round(100*(scrollY+innerHeight)/Math.max(h.scrollHeight,1));if(s>m)m=Math.min(100,s)}
addEventListener("scroll",sc,{passive:true});sc();
try{new PerformanceObserver(function(x){var e=x.getEntries();if(e.length)l=Math.round(e[e.length-1].startTime)}).observe({type:"largest-contentful-paint",buffered:true})}catch(e){}
function out(){if(v){g+=Date.now()-v;v=0}if(g<500&&!f)return;S({t:"leave",p:P,s:Math.min(3600,Math.round(g/1000)),d:m,l:l,f:f});f=0;g=0}
document.addEventListener("visibilitychange",function(){if(document.visibilityState==="hidden")out();else v=Date.now()});
addEventListener("pagehide",out);
function ck(e){var a=e.target&&e.target.closest?e.target.closest("a[href]"):null;if(!a)return;var u;try{u=new URL(a.href,location.href)}catch(x){return}
var rel=(a.getAttribute("rel")||"").toLowerCase(),k=/sponsored/.test(rel)||a.hasAttribute("data-dy-aff")?"aff":u.hostname!==H?"out":a.closest("[data-dy-cta]")?"cta":"";
if(!k)return;S({t:k,p:P,u:(u.hostname.replace(/^www\\./,"")+u.pathname).slice(0,300),x:(a.textContent||"").replace(/\\s+/g," ").trim().slice(0,80)})}
document.addEventListener("click",ck,true);document.addEventListener("auxclick",ck,true)})();`;
}

// Worker thu dữ liệu, dựng riêng cho từng tên miền. Chỉ nhận đường dẫn bí mật của tên miền đó; ngoài ra chuyển tiếp về site.
export function statsWorker(domain: string, path: string): string {
  return `const P = ${JSON.stringify(path)}, HOST = ${JSON.stringify(domain)}, JS = ${JSON.stringify(trackerJs(path))};
const BOT = /bot|crawl|spider|slurp|headless|lighthouse|preview|facebookexternalhit|curl|wget|python|go-http|java\\//i;
const T = { pv: 1, leave: 1, aff: 1, out: 1, cta: 1 };
const s = (v, n) => String(v == null ? "" : v).slice(0, n);
const num = (v, max) => { const x = Number(v); return Number.isFinite(x) && x >= 0 ? Math.min(x, max) : 0; };
export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (!url.pathname.startsWith(P + "/")) return fetch(req);
    const rest = url.pathname.slice(P.length);
    if (rest === "/s.js" && (req.method === "GET" || req.method === "HEAD")) return new Response(req.method === "HEAD" ? null : JS, { headers: { "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "public, max-age=3600", "X-Content-Type-Options": "nosniff" } });
    if (rest !== "/e" || req.method !== "POST") return new Response("Not found", { status: 404 });
    const ok = new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
    const ua = req.headers.get("User-Agent") || "";
    if (!ua || BOT.test(ua)) return ok;
    const origin = req.headers.get("Origin");
    if (origin) { try { if (new URL(origin).hostname.replace(/^www\\./, "") !== HOST) return ok; } catch { return ok; } }
    let e;
    try { e = JSON.parse((await req.text()).slice(0, 2048)); } catch { return ok; }
    if (!e || !T[e.t]) return ok;
    const path = s(e.p, 200).split("?")[0] || "/";
    env.AE.writeDataPoint({
      indexes: [HOST],
      blobs: [e.t, path, e.t === "pv" ? s(e.r, 80) : s(e.u, 300), s(e.x, 80), /Mobi|Android|iPhone|iPad/i.test(ua) ? "m" : "d", s(req.cf && req.cf.country, 2)],
      doubles: [e.t === "leave" ? (e.f ? 1 : 0) : 1, num(e.s, 3600), num(e.d, 100), num(e.l, 60000)]
    });
    return ok;
  }
};
`;
}

interface Row { id: number; domain: string; path: string; status: string; message: string | null; last_try: number | null; verified_at: number | null; last_event_at: number | null; created_at: number }
const canEdit = (u: User) => { if (u.role === "viewer") throw new HttpError(403, "Tài khoản chỉ xem.", "forbidden"); };
const randPath = () => `/_${[...crypto.getRandomValues(new Uint8Array(4))].map((b) => b.toString(16).padStart(2, "0")).join("")}`;

async function addDomain(env: Env, domain: string): Promise<Row> {
  const cur = await env.DB.prepare("SELECT * FROM stats_domains WHERE domain = ?").bind(domain).first<Row>();
  if (cur) return cur;
  for (let i = 0; i < 5; i++) {
    const r = await env.DB.prepare("INSERT OR IGNORE INTO stats_domains (domain, path, created_at) VALUES (?, ?, ?) RETURNING *").bind(domain, randPath(), now()).first<Row>();
    if (r) return r;
    const again = await env.DB.prepare("SELECT * FROM stats_domains WHERE domain = ?").bind(domain).first<Row>();
    if (again) return again;
  }
  throw new HttpError(500, "Không tạo được đường dẫn bộ đo.", "path");
}

// Dựng Worker + route + kiểm tra. Không ném lỗi: ghi trạng thái để cron thử lại.
export async function installCore(env: Env, d: Row): Promise<{ ok: boolean; status: string; message: string }> {
  const done = async (status: string, message: string, verified = false) => {
    await env.DB.prepare(`UPDATE stats_domains SET status = ?, message = ?, last_try = ?${verified ? ", verified_at = ?" : ""} WHERE id = ?`).bind(...(verified ? [status, message, now(), now(), d.id] : [status, message, now(), d.id])).run();
    return { ok: status === "verified", status, message };
  };
  let account: string;
  try { account = (await creds(env)).account; } catch (e) { return done("pending", (e as Error).message); }
  try {
    const zones = await cf<{ id: string; name: string }[]>(env, `/zones?name=${encodeURIComponent(d.domain)}`);
    const zone = zones?.[0];
    if (!zone) return done("pending", `Tên miền ${d.domain} chưa có trong tài khoản Cloudflare. App tự thử lại mỗi giờ; script đã dán sẵn sẽ tự chạy khi xong.`);
    const worker = statsWorkerName(d.domain);
    const fd = new FormData();
    fd.append("metadata", new Blob([JSON.stringify({ main_module: "worker.js", compatibility_date: "2026-11-01", bindings: [{ type: "analytics_engine", name: "AE", dataset: DATASET }] })], { type: "application/json" }));
    fd.append("worker.js", new Blob([statsWorker(d.domain, d.path)], { type: "application/javascript+module" }), "worker.js");
    await cf(env, `/accounts/${account}/workers/scripts/${worker}`, { method: "PUT", body: fd });
    const existing = (await cf<{ pattern: string; script: string }[]>(env, `/zones/${zone.id}/workers/routes`)) || [];
    for (const pattern of [`${d.domain}${d.path}/*`, `www.${d.domain}${d.path}/*`]) {
      const r = existing.find((x) => x.pattern === pattern);
      if (r && r.script === worker) continue;
      if (r) return done("error", `Route ${pattern} đang thuộc Worker ${r.script}.`);
      await cf(env, `/zones/${zone.id}/workers/routes`, { method: "POST", json: { pattern, script: worker } });
    }
    const res = await fetch(`https://${d.domain}${d.path}/s.js`, { headers: { "User-Agent": "DuyOi/1.0 (+stats check)" }, signal: AbortSignal.timeout(15000) }).catch(() => null);
    const body = res?.ok ? await res.text() : "";
    if (body.includes(MARKER)) return done("verified", "Bộ đo đang chạy.", true);
    if (!res) return done("installed", "Đã dựng Worker và route nhưng chưa mở được site (site chưa lên mạng?). App tự kiểm tra lại.");
    return done("installed", `Đã dựng Worker và route; ${d.domain}${d.path}/s.js trả về ${res.status}. Route cần 1–2 phút, app tự kiểm tra lại.`);
  } catch (e) {
    return done("error", (e as Error).message.slice(0, 300));
  }
}

// ---------------- Gộp dữ liệu từ Analytics Engine vào D1 ----------------

async function aeQuery<T>(env: Env, sql: string): Promise<T[]> {
  const { token, account } = await creds(env);
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/analytics_engine/sql`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: `${sql} FORMAT JSON`, signal: AbortSignal.timeout(30000) });
  const text = await res.text();
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) throw new HttpError(502, "Cloudflare từ chối đọc số liệu: token cần thêm quyền Account › Account Analytics Read.", "cf_auth");
    if (/unknown table|does not exist/i.test(text)) return []; // chưa có sự kiện nào, dataset chưa được tạo
    throw new HttpError(502, `Analytics Engine báo lỗi: ${text.slice(0, 200)}`, "ae_error");
  }
  try { return ((JSON.parse(text) as { data?: T[] }).data || []); } catch { return []; }
}

interface AeRow { domain: string; d: number | string; t: string; p: string; u: string; x: string; n: number | string; s: number | string; sc: number | string; l: number | string; ln: number | string; mo: number | string }
const dayOf = (d: number) => new Date(d * 86400000).toISOString().slice(0, 10);

export async function rollupCore(env: Env, days: number): Promise<{ rows: number }> {
  const doms = new Set((await env.DB.prepare("SELECT domain FROM stats_domains").all<{ domain: string }>()).results.map((r) => r.domain));
  if (!doms.size) return { rows: 0 };
  const rows = await aeQuery<AeRow>(env, `SELECT index1 AS domain, intDiv(toUInt32(timestamp), 86400) AS d, blob1 AS t, blob2 AS p, blob3 AS u, blob4 AS x,
    SUM(_sample_interval * double1) AS n, SUM(_sample_interval * double2) AS s, SUM(_sample_interval * double3 * double1) AS sc,
    SUM(_sample_interval * double4 * double1) AS l, SUM(_sample_interval * IF(double4 > 0, double1, 0)) AS ln, SUM(_sample_interval * IF(blob5 = 'm', double1, 0)) AS mo
    FROM ${DATASET} WHERE timestamp > NOW() - INTERVAL '${Math.max(1, Math.min(90, days))}' DAY GROUP BY domain, d, t, p, u, x LIMIT 20000`);
  type Daily = { views: number; visits: number; engaged: number; scroll: number; aff: number; outbound: number; cta: number; lcp: number; lcp_n: number; mobile: number };
  const daily = new Map<string, Daily>(), clicks = new Map<string, { n: number; label: string }>(), sources = new Map<string, number>(), last = new Map<string, string>();
  const N = (v: number | string) => Number(v) || 0;
  for (const r of rows) {
    if (!doms.has(r.domain)) continue;
    const day = dayOf(N(r.d));
    if ((last.get(r.domain) || "") < day) last.set(r.domain, day);
    const k = `${r.domain}\t${day}\t${r.p}`;
    const a = daily.get(k) || { views: 0, visits: 0, engaged: 0, scroll: 0, aff: 0, outbound: 0, cta: 0, lcp: 0, lcp_n: 0, mobile: 0 };
    if (r.t === "pv") {
      a.views += N(r.n); a.mobile += N(r.mo);
      const src = r.u || "(trực tiếp)";
      sources.set(`${r.domain}\t${day}\t${src}`, (sources.get(`${r.domain}\t${day}\t${src}`) || 0) + N(r.n));
    } else if (r.t === "leave") {
      a.visits += N(r.n); a.engaged += N(r.s); a.scroll += N(r.sc); a.lcp += N(r.l); a.lcp_n += N(r.ln);
    } else if (r.t === "aff" || r.t === "out" || r.t === "cta") {
      if (r.t === "aff") a.aff += N(r.n); else if (r.t === "out") a.outbound += N(r.n); else a.cta += N(r.n);
      const ck = `${k}\t${r.t}\t${r.u}`;
      const c = clicks.get(ck) || { n: 0, label: r.x || "" };
      c.n += N(r.n);
      clicks.set(ck, c);
    }
    daily.set(k, a);
  }
  const stmts: DbStatement[] = [];
  const cutoff = dayOf(Math.floor(Date.now() / 86400000) - Math.max(1, Math.min(90, days)) + 1);
  for (const dom of doms) {
    stmts.push(env.DB.prepare("DELETE FROM stats_daily WHERE domain = ? AND day >= ?").bind(dom, cutoff));
    stmts.push(env.DB.prepare("DELETE FROM stats_clicks WHERE domain = ? AND day >= ?").bind(dom, cutoff));
    stmts.push(env.DB.prepare("DELETE FROM stats_sources WHERE domain = ? AND day >= ?").bind(dom, cutoff));
  }
  for (const [k, a] of daily) {
    const [dom, day, path] = k.split("\t");
    if (day! < cutoff) continue;
    stmts.push(env.DB.prepare("INSERT OR REPLACE INTO stats_daily (domain, day, path, views, visits, engaged, scroll, aff, outbound, cta, lcp, lcp_n, mobile) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(dom, day, path, a.views, a.visits, a.engaged, a.scroll, a.aff, a.outbound, a.cta, a.lcp, a.lcp_n, a.mobile));
  }
  for (const [k, c] of clicks) {
    const [dom, day, path, kind, target] = k.split("\t");
    if (day! < cutoff) continue;
    stmts.push(env.DB.prepare("INSERT OR REPLACE INTO stats_clicks (domain, day, path, kind, target, label, n) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(dom, day, path, kind, target, c.label, c.n));
  }
  for (const [k, v] of sources) {
    const [dom, day, source] = k.split("\t");
    if (day! < cutoff) continue;
    stmts.push(env.DB.prepare("INSERT OR REPLACE INTO stats_sources (domain, day, source, views) VALUES (?, ?, ?, ?)").bind(dom, day, source, v));
  }
  for (const [dom, day] of last) stmts.push(env.DB.prepare("UPDATE stats_domains SET last_event_at = MAX(COALESCE(last_event_at, 0), ?) WHERE domain = ?").bind(Date.parse(`${day}T12:00:00Z`), dom));
  for (let i = 0; i < stmts.length; i += 80) await env.DB.batch(stmts.slice(i, i + 80));
  await env.DB.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('stats_rolled_at', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at").bind(JSON.stringify(now()), now()).run();
  return { rows: rows.length };
}

// Cron: mọi site đang chạy đều có dòng bộ đo; tên miền chưa xong thì thử dựng lại mỗi giờ; gộp số liệu mỗi giờ.
export async function processStats(env: Env, deadline: number): Promise<void> {
  const sites = (await env.DB.prepare("SELECT domain FROM sites WHERE status = 'active'").all<{ domain: string }>()).results;
  for (const s of sites) { const d = normDomain(s.domain); if (d) await addDomain(env, d); }
  const todo = (await env.DB.prepare("SELECT * FROM stats_domains WHERE status != 'verified' AND COALESCE(last_try, 0) < ? ORDER BY COALESCE(last_try, 0) LIMIT 3").bind(now() - 3600000).all<Row>()).results;
  for (const d of todo) { if (Date.now() > deadline) return; await installCore(env, d); }
  const anyLive = await env.DB.prepare("SELECT COUNT(*) AS n FROM stats_domains WHERE status IN ('verified', 'installed')").first<{ n: number }>();
  if (!anyLive?.n || Date.now() > deadline) return;
  const rolled = await env.DB.prepare("SELECT value FROM settings WHERE key = 'stats_rolled_at'").first<{ value: string }>();
  const at = rolled ? Number(JSON.parse(rolled.value)) : 0;
  if (now() - at < 3600000) return;
  await rollupCore(env, at ? 2 : 90).catch((e) => console.error("stats rollup", (e as Error).message));
}

// ---------------- API ----------------

const since = (days: number) => new Date(Date.now() - (days - 1) * 86400000).toISOString().slice(0, 10);

export async function apiStats(env: Env): Promise<Response> {
  const rows = (await env.DB.prepare(`SELECT d.*, s.id AS site_id, s.name AS site_name, s.platform,
      (SELECT SUM(views) FROM stats_daily x WHERE x.domain = d.domain AND x.day >= ?) AS views7, (SELECT SUM(aff) FROM stats_daily x WHERE x.domain = d.domain AND x.day >= ?) AS aff7
    FROM stats_domains d LEFT JOIN sites s ON lower(replace(s.domain, 'www.', '')) = d.domain AND s.status != 'archived' ORDER BY d.domain`).bind(since(7), since(7)).all<Record<string, unknown>>()).results;
  const rolled = await env.DB.prepare("SELECT value FROM settings WHERE key = 'stats_rolled_at'").first<{ value: string }>();
  let cfReady = true;
  try { await creds(env); } catch { cfReady = false; }
  return json({ cfReady, rolledAt: rolled ? Number(JSON.parse(rolled.value)) : null, domains: rows.map((r) => ({ ...r, snippet: snippetFor(String(r.path)), html: htmlSnippetFor(String(r.path)), worker: statsWorkerName(String(r.domain)) })) });
}

export async function apiAddStatsDomain(env: Env, req: Request, user: User): Promise<Response> {
  canEdit(user);
  const b = await readJson<{ domain?: string }>(req);
  const domain = normDomain(b.domain);
  if (!domain) throw new HttpError(400, "Tên miền không hợp lệ (ví dụ: ten-mien.de).", "validation");
  const d = await addDomain(env, domain);
  const r = await installCore(env, d);
  await logActivity(env, `user:${user.id}`, "stats.add", `Thêm bộ đo cho ${domain}: ${r.message}`);
  return json({ id: d.id, snippet: snippetFor(d.path), ...r }, 201);
}

async function rowById(env: Env, id: number): Promise<Row> {
  const d = await env.DB.prepare("SELECT * FROM stats_domains WHERE id = ?").bind(id).first<Row>();
  if (!d) throw new HttpError(404, "Không có tên miền này trong bộ đo.", "not_found");
  return d;
}
export async function apiInstallStats(env: Env, user: User, id: number): Promise<Response> {
  canEdit(user);
  return json(await installCore(env, await rowById(env, id)));
}
export async function apiDeleteStats(env: Env, user: User, id: number): Promise<Response> {
  if (user.role !== "admin") throw new HttpError(403, "Chỉ admin được xoá.", "forbidden");
  const d = await rowById(env, id);
  await env.DB.batch(["stats_daily", "stats_clicks", "stats_sources"].map((t) => env.DB.prepare(`DELETE FROM ${t} WHERE domain = ?`).bind(d.domain)).concat(env.DB.prepare("DELETE FROM stats_domains WHERE id = ?").bind(id)));
  await logActivity(env, `user:${user.id}`, "stats.delete", `Xoá bộ đo của ${d.domain} (Worker ${statsWorkerName(d.domain)} vẫn còn trên Cloudflare, xoá tay nếu cần)`);
  return json({ ok: true, worker: statsWorkerName(d.domain) });
}
export async function apiRefreshStats(env: Env, user: User): Promise<Response> {
  canEdit(user);
  return json(await rollupCore(env, 2));
}

export async function reportCore(env: Env, domain: string, days: number) {
  const from = since(days);
  const pages = (await env.DB.prepare(`SELECT path, SUM(views) AS views, SUM(visits) AS visits, SUM(engaged) AS engaged, SUM(scroll) AS scroll, SUM(aff) AS aff, SUM(outbound) AS outbound, SUM(cta) AS cta, SUM(lcp) AS lcp, SUM(lcp_n) AS lcp_n, SUM(mobile) AS mobile
    FROM stats_daily WHERE domain = ? AND day >= ? GROUP BY path ORDER BY views DESC LIMIT 200`).bind(domain, from).all<Record<string, number | string>>()).results.map((p) => {
    const v = Number(p.views) || 0, vi = Number(p.visits) || 0;
    return { path: String(p.path), views: Math.round(v), avgSec: vi ? Math.round(Number(p.engaged) / vi) : null, scroll: vi ? Math.round(Number(p.scroll) / vi) : null, aff: Math.round(Number(p.aff)), affRate: v ? Math.round((1000 * Number(p.aff)) / v) / 10 : 0, outbound: Math.round(Number(p.outbound)), cta: Math.round(Number(p.cta)), lcp: Number(p.lcp_n) ? Math.round(Number(p.lcp) / Number(p.lcp_n)) : null, mobile: v ? Math.round((100 * Number(p.mobile)) / v) : null };
  });
  const series = (await env.DB.prepare("SELECT day, SUM(views) AS views, SUM(aff) AS aff FROM stats_daily WHERE domain = ? AND day >= ? GROUP BY day ORDER BY day").bind(domain, from).all<{ day: string; views: number; aff: number }>()).results;
  const clicks = (await env.DB.prepare("SELECT kind, target, MAX(label) AS label, SUM(n) AS n, COUNT(DISTINCT path) AS pages FROM stats_clicks WHERE domain = ? AND day >= ? GROUP BY kind, target ORDER BY n DESC LIMIT 40").bind(domain, from).all<{ kind: string; target: string; label: string; n: number; pages: number }>()).results;
  const sources = (await env.DB.prepare("SELECT source, SUM(views) AS views FROM stats_sources WHERE domain = ? AND day >= ? GROUP BY source ORDER BY views DESC LIMIT 15").bind(domain, from).all<{ source: string; views: number }>()).results;
  const t = pages.reduce((a, p) => ({ views: a.views + p.views, aff: a.aff + p.aff, cta: a.cta + p.cta }), { views: 0, aff: 0, cta: 0 });
  const tot = await env.DB.prepare("SELECT SUM(engaged) AS e, SUM(visits) AS v, SUM(scroll) AS s FROM stats_daily WHERE domain = ? AND day >= ?").bind(domain, from).first<{ e: number | null; v: number | null; s: number | null }>();
  return {
    domain, days, totals: { ...t, avgSec: tot?.v ? Math.round((tot.e || 0) / tot.v) : null, scroll: tot?.v ? Math.round((tot.s || 0) / tot.v) : null, affRate: t.views ? Math.round((1000 * t.aff) / t.views) / 10 : 0 },
    series: series.map((s) => ({ day: s.day, views: Math.round(s.views), aff: Math.round(s.aff) })), pages, clicks: clicks.map((c) => ({ ...c, n: Math.round(c.n) })), sources: sources.map((s) => ({ source: s.source, views: Math.round(s.views) }))
  };
}
export async function apiStatsReport(env: Env, url: URL): Promise<Response> {
  const domain = normDomain(url.searchParams.get("domain"));
  const days = [7, 28, 90].includes(Number(url.searchParams.get("days"))) ? Number(url.searchParams.get("days")) : 28;
  if (!domain) throw new HttpError(400, "Thiếu tên miền.", "validation");
  return json(await reportCore(env, domain, days));
}

// Tóm tắt cho Trưởng nhóm: trang nhiều người đọc nhưng ít click affiliate, trang người đọc bỏ sớm.
export async function statsForLead(env: Env, domain: string) {
  const d = normDomain(domain);
  const has = await env.DB.prepare("SELECT 1 FROM stats_daily WHERE domain = ? LIMIT 1").bind(d).first();
  if (!has) return null;
  const r = await reportCore(env, d, 28);
  return {
    last_28_days: { views: r.totals.views, avg_engaged_seconds: r.totals.avgSec, avg_scroll_percent: r.totals.scroll, affiliate_clicks: r.totals.aff, affiliate_click_rate_percent: r.totals.affRate },
    top_pages: r.pages.slice(0, 10).map((p) => ({ path: p.path, views: p.views, avg_engaged_seconds: p.avgSec, scroll_percent: p.scroll, affiliate_clicks: p.aff, affiliate_click_rate_percent: p.affRate })),
    top_affiliate_links: r.clicks.filter((c) => c.kind === "aff").slice(0, 8).map((c) => ({ target: c.target, clicks: c.n }))
  };
}
