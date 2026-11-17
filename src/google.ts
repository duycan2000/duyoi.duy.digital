// Đọc Search Console và GA4 bằng service account (JWT ký RS256 ngay trong Worker, không cần thư viện).
// Anh thêm email của service account vào property GSC (quyền Restricted là đủ) và GA4 (Viewer).

import { readSecret } from "./settings";
import type { Env } from "./types";

interface ServiceAccount { client_email: string; private_key: string; token_uri?: string }

let cached: { token: string; exp: number; email: string } | null = null;

const b64url = (data: ArrayBuffer | Uint8Array | string): string => {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data instanceof Uint8Array ? data : new Uint8Array(data);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

function pemToDer(pem: string): Uint8Array<ArrayBuffer> {
  const b = atob(pem.replace(/-----[^-]+-----/g, "").replace(/\\n/g, "").replace(/\s+/g, ""));
  const out = new Uint8Array(new ArrayBuffer(b.length));
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}

export async function hasGoogle(env: Env): Promise<boolean> {
  return Boolean(await env.DB.prepare("SELECT 1 FROM secrets WHERE key = 'google_service_account'").first());
}

export async function googleToken(env: Env): Promise<string> {
  if (cached && cached.exp > Date.now() + 60000) return cached.token;
  const raw = await readSecret(env, "google_service_account");
  if (!raw) throw new Error("Chưa nhập Google service account trong Cài đặt.");
  const sa = JSON.parse(raw) as ServiceAccount;
  const iat = Math.floor(Date.now() / 1000);
  const aud = sa.token_uri || "https://oauth2.googleapis.com/token";
  const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(JSON.stringify({ iss: sa.client_email, scope: "https://www.googleapis.com/auth/webmasters.readonly https://www.googleapis.com/auth/analytics.readonly", aud, iat, exp: iat + 3600 }));
  const key = await crypto.subtle.importKey("pkcs8", pemToDer(sa.private_key), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${head}.${claim}`));
  const res = await fetch(aud, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=${encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer")}&assertion=${head}.${claim}.${b64url(sig)}`
  });
  const data = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error_description?: string };
  if (!res.ok || !data.access_token) throw new Error(`Google từ chối service account: ${data.error_description || res.status}`);
  cached = { token: data.access_token, exp: Date.now() + (data.expires_in || 3600) * 1000, email: sa.client_email };
  return data.access_token;
}

async function gpost<T>(env: Env, url: string, body: unknown): Promise<T> {
  const token = await googleToken(env);
  const res = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(25000) });
  const data = (await res.json().catch(() => ({}))) as T & { error?: { message?: string; status?: string } };
  if (!res.ok) {
    const msg = data.error?.message || String(res.status);
    if (res.status === 403) throw new Error(`Không có quyền (${msg}). Kiểm tra: đã thêm email service account vào property chưa, và loại property có đúng không (sc-domain:ten-mien.de cho Domain property, https://ten-mien.com/ cho URL-prefix).`);
    throw new Error(msg);
  }
  return data;
}

const day = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400000);

export interface PageTraffic {
  clicks: number; impressions: number; position: number | null;     // 28 ngày gần nhất
  clicksPrev: number; impressionsPrev: number;                       // 28 ngày trước đó
  clicksBefore?: number; clicksAfter?: number;                       // 28 ngày trước và sau tháng tụt
  leads?: number; sessions?: number;                                 // GA4, 28 ngày
}

type GscRow = { keys: string[]; clicks: number; impressions: number; position: number };

async function gscByPage(env: Env, property: string, start: Date, end: Date): Promise<Map<string, GscRow>> {
  const url = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(property)}/searchAnalytics/query`;
  const r = await gpost<{ rows?: GscRow[] }>(env, url, { startDate: day(start), endDate: day(end), dimensions: ["page"], rowLimit: 5000, dataState: "final" });
  const m = new Map<string, GscRow>();
  for (const row of r.rows || []) {
    try { const p = new URL(row.keys[0] || "").pathname; const old = m.get(p); m.set(p, old ? { ...row, clicks: row.clicks + old.clicks, impressions: row.impressions + old.impressions } : row); } catch { /* bỏ qua URL lạ */ }
  }
  return m;
}

// Traffic theo path. GSC chậm khoảng 3 ngày nên kỳ gần nhất kết thúc 3 ngày trước.
export async function gscTraffic(env: Env, property: string, dropMonth: string | null): Promise<Map<string, PageTraffic>> {
  const end = addDays(new Date(), -3);
  const [cur, prev] = await Promise.all([gscByPage(env, property, addDays(end, -27), end), gscByPage(env, property, addDays(end, -55), addDays(end, -28))]);
  let before: Map<string, GscRow> | null = null, after: Map<string, GscRow> | null = null;
  if (dropMonth && /^\d{4}-\d{2}$/.test(dropMonth)) {
    const start = new Date(`${dropMonth}-01T00:00:00Z`);
    if (addDays(start, 28) < end) [before, after] = await Promise.all([gscByPage(env, property, addDays(start, -28), addDays(start, -1)), gscByPage(env, property, start, addDays(start, 27))]);
  }
  const out = new Map<string, PageTraffic>();
  const paths = new Set([...cur.keys(), ...prev.keys(), ...(before?.keys() || []), ...(after?.keys() || [])]);
  for (const p of paths) {
    const c = cur.get(p), q = prev.get(p);
    out.set(p, {
      clicks: c?.clicks || 0, impressions: c?.impressions || 0, position: c ? +c.position.toFixed(1) : null,
      clicksPrev: q?.clicks || 0, impressionsPrev: q?.impressions || 0,
      ...(before ? { clicksBefore: before.get(p)?.clicks || 0, clicksAfter: after?.get(p)?.clicks || 0 } : {})
    });
  }
  return out;
}

// Lead (sự kiện generate_lead) và phiên theo trang đích, 28 ngày. GA4 Data API chậm 24–48 giờ.
export async function ga4ByPage(env: Env, propertyId: string): Promise<Map<string, { leads: number; sessions: number }>> {
  const url = `https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(propertyId)}:runReport`;
  const range = [{ startDate: "28daysAgo", endDate: "yesterday" }];
  type Rep = { rows?: { dimensionValues: { value: string }[]; metricValues: { value: string }[] }[] };
  const [leads, sessions] = await Promise.all([
    gpost<Rep>(env, url, { dateRanges: range, dimensions: [{ name: "pagePath" }], metrics: [{ name: "eventCount" }], dimensionFilter: { filter: { fieldName: "eventName", stringFilter: { value: "generate_lead" } } }, limit: 5000 }),
    gpost<Rep>(env, url, { dateRanges: range, dimensions: [{ name: "landingPage" }], metrics: [{ name: "sessions" }], limit: 5000 })
  ]);
  const out = new Map<string, { leads: number; sessions: number }>();
  const norm = (p: string) => { const x = (p || "/").split("?")[0] || "/"; return x.endsWith("/") ? x : `${x}/`; };
  for (const r of leads.rows || []) { const p = norm(r.dimensionValues[0]?.value || ""); out.set(p, { leads: (out.get(p)?.leads || 0) + Number(r.metricValues[0]?.value || 0), sessions: out.get(p)?.sessions || 0 }); }
  for (const r of sessions.rows || []) { const p = norm(r.dimensionValues[0]?.value || ""); out.set(p, { leads: out.get(p)?.leads || 0, sessions: (out.get(p)?.sessions || 0) + Number(r.metricValues[0]?.value || 0) }); }
  return out;
}
