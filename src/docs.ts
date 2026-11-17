// Tài liệu site (PDF) → Hồ sơ site. Agent "Đọc tài liệu" rút dịch vụ, sản phẩm, số liệu có nguồn, giọng văn, điều cấm
// và gợi ý bài (kèm định dạng). Hồ sơ là nguồn dữ kiện cho người viết; số liệu trong hồ sơ được Gác cổng coi là có nguồn.
// File PDF không lưu lại: chỉ giữ tên, kích thước, mã băm và kết quả đọc.

import { aiJson } from "./ai";
import { logActivity } from "./activity";
import { formatOf, type FormatId } from "./formats";
import { HttpError, json, now, readJson } from "./http";
import { extractNumbers } from "./recovery-extract";
import type { Env, User } from "./types";

export const MAX_PDF_BYTES = 15 * 1024 * 1024;

export interface Profile {
  summary: string; audience: string; tone: string;
  services: string[]; products: { name: string; specs: string; notes: string }[];
  facts: { text: string; source: string }[]; banned: string[];
  ideas: { title: string; keyword: string; format: FormatId; why: string; source: string }[];
}
export const emptyProfile = (): Profile => ({ summary: "", audience: "", tone: "", services: [], products: [], facts: [], banned: [], ideas: [] });

const cut = (v: unknown, n: number) => String(v ?? "").trim().slice(0, n);
const arr = (v: unknown, max: number) => (Array.isArray(v) ? v.slice(0, max) : []);

export function cleanProfile(v: unknown): Profile {
  const b = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  return {
    summary: cut(b.summary, 2000), audience: cut(b.audience, 600), tone: cut(b.tone, 400),
    services: arr(b.services, 40).map((x) => cut(x, 160)).filter(Boolean),
    products: arr(b.products, 60).map((x) => { const p = (x || {}) as Record<string, unknown>; return { name: cut(p.name, 120), specs: cut(p.specs, 800), notes: cut(p.notes, 600) }; }).filter((p) => p.name),
    facts: arr(b.facts, 150).map((x) => { const f = (typeof x === "string" ? { text: x } : x || {}) as Record<string, unknown>; return { text: cut(f.text, 400), source: cut(f.source, 120) }; }).filter((f) => f.text),
    banned: arr(b.banned, 60).map((x) => cut(x, 120)).filter(Boolean),
    ideas: arr(b.ideas, 40).map((x) => { const i = (x || {}) as Record<string, unknown>; return { title: cut(i.title, 160), keyword: cut(i.keyword, 120).toLowerCase(), format: formatOf(String(i.format)).id, why: cut(i.why ?? i.why_vi, 300), source: cut(i.source, 120) }; }).filter((i) => i.keyword || i.title)
  };
}

export async function readProfile(env: Env, siteId: number): Promise<Profile> {
  const r = await env.DB.prepare("SELECT data FROM site_profiles WHERE site_id = ?").bind(siteId).first<{ data: string }>();
  try { return r ? cleanProfile(JSON.parse(r.data)) : emptyProfile(); } catch { return emptyProfile(); }
}
async function saveProfile(env: Env, siteId: number, p: Profile, by: string): Promise<void> {
  await env.DB.prepare("INSERT INTO site_profiles (site_id, data, updated_at, updated_by) VALUES (?, ?, ?, ?) ON CONFLICT(site_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at, updated_by = excluded.updated_by")
    .bind(siteId, JSON.stringify(p), now(), by).run();
}

const key = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
function uniq<T>(list: T[], k: (x: T) => string): T[] { const seen = new Set<string>(); return list.filter((x) => { const v = key(k(x)); if (!v || seen.has(v)) return false; seen.add(v); return true; }); }

// Gộp kết quả một tài liệu vào hồ sơ (không ghi đè phần anh đã sửa tay)
export function mergeProfile(p: Profile, r: Record<string, unknown>, source: string): Profile {
  const add = cleanProfile({
    summary: r.summary_vi, audience: r.audience, tone: r.tone, services: r.services, products: r.products, banned: r.banned,
    facts: arr(r.facts, 150).map((f) => { const x = (typeof f === "string" ? { text: f } : f || {}) as Record<string, unknown>; return { text: x.text, source: x.page ? `${source}, tr. ${x.page}` : source }; }),
    ideas: arr(r.ideas, 40).map((i) => ({ ...(i as object), source }))
  });
  return cleanProfile({
    summary: p.summary || add.summary, audience: p.audience || add.audience, tone: p.tone || add.tone,
    services: uniq([...p.services, ...add.services], (x) => x),
    products: uniq([...p.products, ...add.products], (x) => x.name),
    facts: uniq([...p.facts, ...add.facts], (x) => x.text),
    banned: uniq([...p.banned, ...add.banned], (x) => x),
    ideas: uniq([...p.ideas, ...add.ideas], (x) => x.keyword || x.title)
  });
}

// Phần hồ sơ gửi cho người viết: dữ kiện liên quan tới từ khoá trước, tối đa 30
export function profileFor(p: Profile, keyword: string) {
  const kt = new Set(keyword.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2));
  const scored = p.facts.map((f) => ({ f, s: f.text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => kt.has(w)).length }));
  const facts = scored.sort((a, b) => b.s - a.s).slice(0, 30).map((x) => x.f);
  return { summary: p.summary, audience: p.audience, tone: p.tone, services: p.services.slice(0, 20), products: p.products.slice(0, 15).map((x) => ({ name: x.name, specs: x.specs })), facts, banned: p.banned };
}
export const profileNumbers = (p: Profile): string[] => p.facts.flatMap((f) => extractNumbers(f.text)).concat(p.products.flatMap((x) => extractNumbers(`${x.name} ${x.specs}`)));

const canEdit = (u: User) => { if (u.role === "viewer") throw new HttpError(403, "Tài khoản chỉ xem.", "forbidden"); };
const b64 = (b: Uint8Array) => { let s = ""; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); };

// POST /api/sites/:id/docs?name=…&ocr=1 (thân request là file PDF)
export async function apiUploadDoc(env: Env, req: Request, user: User, siteId: number): Promise<Response> {
  canEdit(user);
  const site = await env.DB.prepare("SELECT id, domain, language FROM sites WHERE id = ?").bind(siteId).first<{ id: number; domain: string; language: string }>();
  if (!site) throw new HttpError(404, "Không tìm thấy site.", "not_found");
  const u = new URL(req.url);
  const name = cut(u.searchParams.get("name") || "tai-lieu.pdf", 120).replace(/[^\p{L}\p{N} ._()-]/gu, "_");
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.length > MAX_PDF_BYTES) throw new HttpError(413, "PDF lớn hơn 15 MB: tách nhỏ rồi tải từng phần.", "too_large");
  if (!(bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46)) throw new HttpError(400, "Chỉ nhận file PDF.", "validation");
  const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((x) => x.toString(16).padStart(2, "0")).join("");
  const dup = await env.DB.prepare("SELECT id FROM site_docs WHERE site_id = ? AND sha256 = ? AND status = 'ready'").bind(siteId, hash).first();
  if (dup) throw new HttpError(409, "Tài liệu này đã được đọc rồi.", "duplicate");
  await env.DB.prepare("DELETE FROM site_docs WHERE site_id = ? AND sha256 = ?").bind(siteId, hash).run();
  const row = await env.DB.prepare("INSERT INTO site_docs (site_id, name, size, sha256, status, created_by, created_at) VALUES (?, ?, ?, ?, 'reading', ?, ?) RETURNING id")
    .bind(siteId, name, bytes.length, hash, user.id, now()).first<{ id: number }>();
  const pages = await env.DB.prepare("SELECT p.path, json_extract(p.data, '$.title') AS title FROM recovery_pages p JOIN recovery_cases c ON c.id = p.case_id WHERE c.site_id = ? AND c.status != 'archived' ORDER BY c.id DESC LIMIT 150").bind(siteId).all<{ path: string; title: string | null }>();
  try {
    const r = await aiJson<Record<string, unknown>>(env, {
      template: "doc_profile", task: "docs.read", siteId,
      rules: "Copy numbers exactly as written in the document and never add numbers that are not in it. Reply with a single JSON object only.",
      input: { site: site.domain, site_language: site.language, file: name, existing_pages: pages.results.map((p) => `${p.path} ${p.title || ""}`.trim()) },
      files: [{ name, dataUrl: `data:application/pdf;base64,${b64(bytes)}` }],
      pdfEngine: u.searchParams.get("ocr") === "1" ? "mistral-ocr" : "pdf-text"
    });
    const kind = cut(r.doc_type, 30) || "other";
    await env.DB.prepare("UPDATE site_docs SET status = 'ready', kind = ?, result = ? WHERE id = ?").bind(kind, JSON.stringify(r), row!.id).run();
    const p = mergeProfile(await readProfile(env, siteId), r, name);
    await saveProfile(env, siteId, p, "agent:docs");
    const ideas = arr(r.ideas, 40).length;
    await logActivity(env, "agent:docs", "docs.read", `Đọc "${name}": ${arr(r.facts, 999).length} dữ kiện, ${arr(r.products, 999).length} sản phẩm, ${ideas} gợi ý bài`, siteId);
    return json({ ok: true, id: row!.id, kind, summary: cut(r.summary_vi, 2000), ideas });
  } catch (e) {
    await env.DB.prepare("UPDATE site_docs SET status = 'failed', error = ? WHERE id = ?").bind(cut((e as Error).message, 300), row!.id).run();
    throw e;
  }
}

// GET /api/sites/:id/docs → tài liệu + Hồ sơ site
export async function apiDocs(env: Env, siteId: number): Promise<Response> {
  const { results } = await env.DB.prepare("SELECT id, name, size, kind, status, error, result, created_at FROM site_docs WHERE site_id = ? ORDER BY id DESC").bind(siteId).all<Record<string, unknown>>();
  return json({
    docs: results.map((d) => { const r = d.result ? JSON.parse(String(d.result)) as Record<string, unknown> : null; return { ...d, result: undefined, title: r ? cut(r.title, 160) : null, summary: r ? cut(r.summary_vi, 2000) : null, counts: r ? { facts: arr(r.facts, 999).length, products: arr(r.products, 999).length, ideas: arr(r.ideas, 99).length } : null }; }),
    profile: await readProfile(env, siteId)
  });
}

// PUT /api/sites/:id/profile — anh sửa tay Hồ sơ site
export async function apiSaveProfile(env: Env, req: Request, user: User, siteId: number): Promise<Response> {
  canEdit(user);
  const p = cleanProfile(await readJson(req));
  await saveProfile(env, siteId, p, `user:${user.id}`);
  await logActivity(env, `user:${user.id}`, "docs.profile", `Sửa Hồ sơ site (${p.facts.length} dữ kiện, ${p.products.length} sản phẩm)`, siteId);
  return json({ ok: true, profile: p });
}

// DELETE /api/sites/:id/docs/:docId — bỏ tài liệu (Hồ sơ giữ nguyên, anh sửa tay nếu cần)
export async function apiDeleteDoc(env: Env, user: User, siteId: number, docId: number): Promise<Response> {
  canEdit(user);
  await env.DB.prepare("DELETE FROM site_docs WHERE id = ? AND site_id = ?").bind(docId, siteId).run();
  return json({ ok: true });
}
