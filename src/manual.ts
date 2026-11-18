// Link building làm tay: agent chuẩn bị trước (danh sách nơi, đoạn văn sẵn để dán, link tra cứu), anh tự làm rồi đánh dấu.
// Phương pháp: trả lời phóng viên, ảnh bị dùng không ghi nguồn, testimonial cho công cụ anh dùng thật, hãng/nhà cung cấp (partner, nơi bán),
// podcast, bài tổng hợp chuyên gia, hiệp hội/danh bạ ngành và địa phương, trang 404 còn backlink.
// Luật: không mua link, không tác giả giả (luôn là anh, tên thật), không bịa số/khách hàng/giải thưởng, site Đức không email lạnh.

import { logActivity } from "./activity";
import { aiJson, writingRules } from "./ai";
import { serpOrganic } from "./dataforseo";
import { readProfile } from "./docs";
import { HttpError, json, now, readJson } from "./http";
import { germanSite, readOp, siteOf } from "./offpage";
import { extractNumbers } from "./recovery-extract";
import { readRules } from "./recovery-rules";
import { emailsIn, fetchText, hostOf, linksIn, overlap } from "./web";
import type { Env, User } from "./types";

export const METHODS = {
  journalist: { label: "Trả lời phóng viên", serp: false },
  image: { label: "Ảnh của anh bị dùng không ghi nguồn", serp: false },
  testimonial: { label: "Testimonial cho công cụ anh dùng thật", serp: true },
  partner: { label: "Hãng, nhà cung cấp (partner, nơi bán, review)", serp: true },
  podcast: { label: "Làm khách podcast", serp: true },
  roundup: { label: "Bài tổng hợp ý kiến chuyên gia", serp: true },
  association: { label: "Hiệp hội, danh bạ ngành và địa phương", serp: true },
  reclaim: { label: "Trang 404 còn backlink", serp: false }
} as const;
export type Method = keyof typeof METHODS;

// Nền tảng phóng viên tìm nguồn (HARO đã đóng; đây là các nơi thay thế đang chạy)
export const JOURNALIST_PLATFORMS = [
  { name: "Source of Sources", url: "https://sosrcs.com/", note: "Miễn phí, email câu hỏi mỗi ngày, do người lập HARO cũ làm.", markets: ["US", "GB", "CA", "AU"] },
  { name: "HARO (Featured.com)", url: "https://www.helpareporter.com/", note: "HARO mở lại dưới Featured.com, có gói miễn phí.", markets: ["US", "GB", "CA", "AU"] },
  { name: "Featured.com", url: "https://featured.com/", note: "Câu hỏi đã lọc, trả lời trên web; có gói miễn phí.", markets: ["US", "GB", "CA", "AU"] },
  { name: "Qwoted", url: "https://www.qwoted.com/", note: "Phóng viên đã xác minh, gói miễn phí có giới hạn.", markets: ["US", "GB", "CA", "AU"] },
  { name: "Help a B2B Writer / MentionMatch", url: "https://helpab2bwriter.com/", note: "Chỉ chủ đề B2B, ít cạnh tranh: hợp site dịch vụ, IT.", markets: ["US", "GB", "CA", "AU"] },
  { name: "SourceBottle", url: "https://www.sourcebottle.com/", note: "Mạnh ở Úc, New Zealand, Anh.", markets: ["AU", "NZ", "GB"] },
  { name: "#journorequest trên X và Bluesky", url: "https://x.com/search?q=%23journorequest&f=live", note: "Câu hỏi đăng công khai, cần trả lời nhanh.", markets: ["US", "GB", "CA", "AU", "NZ"] }
];

const canEdit = (u: User) => { if (u.role === "viewer") throw new HttpError(403, "Tài khoản chỉ xem.", "forbidden"); };
const parse = <T>(v: string | null | undefined, d: T): T => { try { return v ? JSON.parse(v) as T : d; } catch { return d; } };

async function addTarget(env: Env, siteId: number, method: Method, url: string, title: string, detail: Record<string, unknown> = {}): Promise<boolean> {
  const r = await env.DB.prepare("INSERT OR IGNORE INTO op_manual (site_id, method, title, url, detail, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id").bind(siteId, method, title.slice(0, 200), url.slice(0, 500), JSON.stringify(detail), now(), now()).first();
  return !!r;
}

// Ảnh thật của anh: ảnh tải lên cho bài (content_ideas.images) và ảnh trong bài đã đăng (social_posts.images)
async function ownImages(env: Env, siteId: number): Promise<{ url: string; page: string | null; alt: string }[]> {
  const out = new Map<string, { url: string; page: string | null; alt: string }>();
  const ideas = (await env.DB.prepare("SELECT images, keyword FROM content_ideas WHERE site_id = ? AND images IS NOT NULL").bind(siteId).all<{ images: string; keyword: string }>()).results;
  for (const i of ideas) for (const v of Object.values(parse<Record<string, { url?: string; alt?: string; source?: string }>>(i.images, {}))) if (v?.url?.startsWith("https://") && v.source !== "ai") out.set(v.url, { url: v.url, page: null, alt: v.alt || i.keyword });
  const posts = (await env.DB.prepare("SELECT source_url, images FROM social_posts WHERE site_id = ? AND images IS NOT NULL AND variant = 0").bind(siteId).all<{ source_url: string; images: string }>()).results;
  for (const p of posts) for (const u of parse<string[]>(p.images, [])) if (u.startsWith("https://") && !out.has(u)) out.set(u, { url: u, page: p.source_url, alt: "" });
  return [...out.values()].slice(0, 60);
}
export const reverseLinks = (img: string) => ({
  google: `https://lens.google.com/uploadbyurl?url=${encodeURIComponent(img)}`,
  bing: `https://www.bing.com/images/search?view=detailv2&iss=sbi&q=imgurl:${encodeURIComponent(img)}`,
  tineye: `https://tineye.com/search?url=${encodeURIComponent(img)}`,
  yandex: `https://yandex.com/images/search?rpt=imageview&url=${encodeURIComponent(img)}`
});

// Chuẩn bị một phương pháp: tìm nơi (SERP) + soạn đoạn văn sẵn (AI)
export async function prepareCore(env: Env, siteId: number, method: Method, inputs: { vendors?: string[]; experience?: string; ownerName?: string; ownerRole?: string }, actor: string): Promise<{ targets: number; items: number; note?: string }> {
  if (!(method in METHODS)) throw new HttpError(400, "Phương pháp không hợp lệ.", "validation");
  const s = await siteOf(env, siteId);
  const { settings } = await readOp(env, s);
  const lang = s.language || "en";
  const topics = settings.topics.slice(0, 2);
  const own = s.domain.replace(/^www\./, "");
  let targets = 0, note: string | undefined;
  const serp = async (q: string, depth = 10) => (await serpOrganic(env, siteId, q, s.market, lang, "linkbuilder", `manual.${method}`, depth)).filter((h) => h.domain !== own);
  if (method === "testimonial") {
    for (const v of (inputs.vendors || []).slice(0, 8)) {
      const hits = await serp(`"${v}" testimonials OR "customer stories" OR "case studies" OR "write a review"`);
      const tok = v.toLowerCase().replace(/[^a-z0-9]/g, "");
      const h = hits.find((x) => x.domain.replace(/[^a-z0-9]/g, "").includes(tok.slice(0, 6))) || hits[0];
      if (h && await addTarget(env, siteId, method, h.url, `${v}: ${h.title}`, { vendor: v })) targets++;
    }
    if (!(inputs.vendors || []).length) note = "Nhập tên công cụ, nhà cung cấp anh dùng thật để agent tìm trang testimonial.";
  }
  if (method === "partner") {
    const brands = [...new Set([...(inputs.vendors || []), ...(await env.DB.prepare("SELECT DISTINCT merchant FROM affiliate_links WHERE site_id = ? AND merchant != ''").bind(siteId).all<{ merchant: string }>()).results.map((r) => r.merchant), ...(await readProfile(env, siteId)).products.map((p) => p.name.split(" ")[0]!)])].filter((b) => b && b.length > 2 && !/amazon/i.test(b)).slice(0, 6);
    for (const b of brands) {
      const hits = await serp(`"${b}" "where to buy" OR retailers OR "partner program" OR "become a partner" OR "review program"`);
      for (const h of hits.slice(0, 2)) if (await addTarget(env, siteId, method, h.url, `${b}: ${h.title}`, { brand: b })) targets++;
    }
    if (!brands.length) note = "Chưa có hãng: thêm link affiliate (tên hãng/cửa hàng) hoặc nhập danh sách hãng.";
  }
  if (method === "podcast") for (const t of topics) {
    const hits = [...await serp(`${t} podcast "be a guest" OR "guest application" OR "be on the show"`), ...await serp(`site:podcasts.apple.com ${t}`)];
    for (const h of hits.slice(0, 8)) if (await addTarget(env, siteId, method, h.url, h.title, { snippet: h.description })) targets++;
  }
  if (method === "roundup") for (const t of topics) {
    const hits = await serp(`${t} "expert roundup" OR "experts share" OR "we asked" OR "experts reveal"`);
    for (const h of hits.slice(0, 8)) if (await addTarget(env, siteId, method, h.url, h.title, { snippet: h.description })) targets++;
  }
  if (method === "association") {
    const qs = topics.map((t) => `${t} association "member directory" OR "find a member"`);
    if (settings.nap.city) qs.push(`${settings.nap.city} chamber of commerce member directory`);
    for (const q of qs) for (const h of (await serp(q)).slice(0, 6)) if (await addTarget(env, siteId, method, h.url, h.title, { snippet: h.description })) targets++;
    if (s.site_type !== "service") note = "Hiệp hội và danh bạ địa phương hợp nhất với site dịch vụ có doanh nghiệp thật.";
  }
  if (method === "image") {
    const imgs = await ownImages(env, siteId);
    for (const i of imgs) if (await addTarget(env, siteId, method, i.url, i.alt || i.url.split("/").pop() || "Ảnh", { page: i.page, ...reverseLinks(i.url) })) targets++;
    note = imgs.length ? "Bấm Google Lens / Bing / TinEye để tìm trang dùng ảnh, dán link trang đó vào ô bên dưới: app kiểm tra và soạn thư xin ghi nguồn." : "Chưa có ảnh thật nào (ảnh anh tải lên cho bài, ảnh trong bài đã đăng).";
  }
  if (method === "reclaim") note = "Dán danh sách trang được nhiều link nhất (Search Console › Liên kết › Các trang được liên kết nhiều nhất › Xuất) vào ô bên dưới.";
  // Đoạn văn sẵn để dán
  let items = 0;
  if (["journalist", "podcast", "roundup", "testimonial", "partner", "association"].includes(method)) {
    const profile = await readProfile(env, siteId);
    const rules = readRules((await env.DB.prepare("SELECT rules FROM recovery_cases WHERE site_id = ? AND status != 'archived' ORDER BY id DESC LIMIT 1").bind(siteId).first<{ rules: string }>())?.rules || "{}");
    const facts = [profile.summary, ...profile.facts.map((f) => f.text), inputs.experience || ""].join("\n").slice(0, 3000);
    const out = await aiJson<{ items?: { label: string; text: string }[]; owner_todo?: string[] }>(env, { template: "manual_kit", task: `manual.${method}`, siteId, rules: writingRules(lang, extractNumbers(facts), rules.blocklist),
      input: { method, brand: settings.brand, owner_name: inputs.ownerName || settings.senderName, owner_role: inputs.ownerRole || "", site: `https://${s.domain}`, profile: { summary: profile.summary, services: profile.services, facts: profile.facts.map((f) => f.text) }, topics: settings.topics, experience: inputs.experience || "", vendors: inputs.vendors || [] } });
    const kit = { items: (out.items || []).slice(0, 12).map((i) => ({ label: String(i.label || "").slice(0, 80), text: String(i.text || "").slice(0, 2500) })), owner_todo: (out.owner_todo || []).slice(0, 8).map(String), at: now() };
    items = kit.items.length;
    await env.DB.prepare("INSERT INTO op_kits (site_id, method, data, inputs, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(site_id, method) DO UPDATE SET data = excluded.data, inputs = excluded.inputs, updated_at = excluded.updated_at").bind(siteId, method, JSON.stringify(kit), JSON.stringify(inputs), now()).run();
  } else await env.DB.prepare("INSERT INTO op_kits (site_id, method, data, inputs, updated_at) VALUES (?, ?, '{}', ?, ?) ON CONFLICT(site_id, method) DO UPDATE SET inputs = excluded.inputs, updated_at = excluded.updated_at").bind(siteId, method, JSON.stringify(inputs), now()).run();
  await logActivity(env, actor, "manual.prepare", `Chuẩn bị "${METHODS[method].label}" (${s.domain}): ${targets} nơi, ${items} đoạn văn`, siteId);
  return { targets, items, note };
}

// Ảnh: anh dán trang đang dùng ảnh → kiểm tra có ảnh và có link về site không → tạo prospect image_credit cho luồng email
export async function imageFoundCore(env: Env, siteId: number, manualId: number, pageUrl: string, actor: string): Promise<{ ok: boolean; message: string; prospectId?: number }> {
  const s = await siteOf(env, siteId);
  const m = await env.DB.prepare("SELECT * FROM op_manual WHERE id = ? AND site_id = ? AND method = 'image'").bind(manualId, siteId).first<{ id: number; url: string; detail: string }>();
  if (!m) throw new HttpError(404, "Không có ảnh này.", "not_found");
  let page: URL;
  try { page = new URL(pageUrl); } catch { throw new HttpError(400, "Link trang không hợp lệ.", "validation"); }
  const own = s.domain.replace(/^www\./, "");
  if (hostOf(page.href) === own) throw new HttpError(400, "Đây là trang của chính site.", "validation");
  const r = await fetchText(page.href, 800_000, 12000);
  if (!r || r.status >= 400) return { ok: false, message: "Không mở được trang đó." };
  const file = m.url.split("/").pop()!.split("?")[0]!.replace(/\.[a-z0-9]+$/i, "");
  const usesImage = r.text.includes(m.url) || (file.length > 5 && r.text.includes(file));
  const links = linksIn(r.text, page.href);
  if (links.some((l) => hostOf(l.href) === own)) return { ok: false, message: "Trang này đã có link về site: không cần xin thêm." };
  const emails = emailsIn(r.text);
  const detail = parse<Record<string, unknown>>(m.detail, {});
  const pr = await env.DB.prepare("INSERT OR IGNORE INTO op_prospects (site_id, kind, url, domain, title, snippet, contact_email, dead_url, score, why, query, status, found_at, updated_at) VALUES (?, 'image_credit', ?, ?, ?, ?, ?, ?, 60, ?, 'reverse image', ?, ?, ?) RETURNING id")
    .bind(siteId, page.href, hostOf(page.href), (r.text.match(/<title[^>]*>([^<]*)/i)?.[1] || page.hostname).trim().slice(0, 200), `Ảnh: ${m.url}`, emails.find((e) => e.endsWith(hostOf(page.href))) || emails[0] || null, String(detail.page || `https://${s.domain}/`), usesImage ? "Dùng ảnh của anh, chưa ghi nguồn bằng link" : "Anh báo trang dùng ảnh (app chưa thấy đúng file ảnh: kiểm tra lại)", germanSite(s) || !(emails.length) ? "skipped" : "new", now(), now()).first<{ id: number }>();
  await env.DB.prepare("UPDATE op_manual SET status = 'doing', note = ?, updated_at = ? WHERE id = ?").bind(`Trang dùng ảnh: ${page.href}`, now(), manualId).run();
  await logActivity(env, actor, "manual.image", `Ảnh bị dùng không ghi nguồn: ${page.href}`, siteId);
  if (germanSite(s)) return { ok: true, message: "Đã ghi. Site Đức: app không gửi email lạnh, anh tự liên hệ qua form của trang nếu muốn.", prospectId: pr?.id };
  if (!emails.length) return { ok: true, message: "Đã ghi nhưng không thấy email trên trang: anh nhập email ở tab Prospects rồi bấm Soạn email.", prospectId: pr?.id };
  return { ok: true, message: usesImage ? "Đã thêm vào Prospects (loại ghi nguồn ảnh): bấm Soạn email ở tab Prospects, anh duyệt trước khi gửi." : "Đã thêm, nhưng app chưa thấy đúng file ảnh trên trang: kiểm tra lại trước khi soạn thư.", prospectId: pr?.id };
}

// 404 còn backlink: anh dán danh sách URL của site (xuất từ Search Console) → kiểm tra mã trả về → gợi ý trang chuyển hướng (anh tự làm redirect)
export async function reclaimCore(env: Env, siteId: number, text: string, actor: string): Promise<{ checked: number; broken: number }> {
  const s = await siteOf(env, siteId);
  const own = s.domain.replace(/^www\./, "");
  const urls = [...new Set((text.match(/https?:\/\/[^\s,;"']+/g) || []).map((u) => u.replace(/[).]+$/, "")).filter((u) => hostOf(u) === own))].slice(0, 60);
  const c = await env.DB.prepare("SELECT id FROM recovery_cases WHERE site_id = ? AND status != 'archived' ORDER BY id DESC LIMIT 1").bind(siteId).first<{ id: number }>();
  const pages = c ? (await env.DB.prepare("SELECT url, json_extract(data, '$.title') AS title FROM recovery_pages WHERE case_id = ? AND status = 'done' LIMIT 500").bind(c.id).all<{ url: string; title: string | null }>()).results : [];
  let broken = 0;
  for (const u of urls) {
    const r = await fetchText(u, 2000, 8000);
    const status = r ? r.status : 0;
    if (status && status < 400) continue;
    broken++;
    const slug = new URL(u).pathname.replace(/[-_/]+/g, " ");
    let best = { url: `https://${s.domain}/`, n: 0, title: "Trang chủ" };
    for (const p of pages) { const n = overlap(`${p.title || ""} ${p.url}`, slug); if (n > best.n) best = { url: p.url, n, title: p.title || p.url }; }
    await addTarget(env, siteId, "reclaim", u, `${new URL(u).pathname} trả ${status || "lỗi"}`, { status, suggest: best.url, suggestTitle: best.title });
  }
  await logActivity(env, actor, "manual.reclaim", `Kiểm tra ${urls.length} trang có backlink: ${broken} trang lỗi cần chuyển hướng`, siteId);
  return { checked: urls.length, broken };
}

// ---------------- API ----------------

export async function apiManualView(env: Env, siteId: number): Promise<Response> {
  const s = await siteOf(env, siteId);
  const kits = Object.fromEntries((await env.DB.prepare("SELECT method, data, inputs, updated_at FROM op_kits WHERE site_id = ?").bind(siteId).all<{ method: string; data: string; inputs: string; updated_at: number }>()).results.map((k) => [k.method, { ...parse(k.data, {}), inputs: parse(k.inputs, {}), updatedAt: k.updated_at }]));
  const rows = (await env.DB.prepare("SELECT * FROM op_manual WHERE site_id = ? ORDER BY CASE status WHEN 'todo' THEN 0 WHEN 'doing' THEN 1 WHEN 'won' THEN 2 ELSE 3 END, id DESC LIMIT 400").bind(siteId).all<Record<string, unknown>>()).results;
  const platforms = JOURNALIST_PLATFORMS.filter((p) => p.markets.includes(s.market) || s.market === "VN");
  return json({ methods: METHODS, kits, targets: rows.map((r) => ({ ...r, detail: parse(String(r.detail || ""), {}) })), platforms, german: germanSite(s), siteType: s.site_type, market: s.market });
}

export async function apiManualPrepare(env: Env, req: Request, user: User, siteId: number): Promise<Response> {
  canEdit(user);
  const b = await readJson<{ method?: string; vendors?: string; experience?: string; ownerName?: string; ownerRole?: string }>(req);
  const vendors = String(b.vendors || "").split(/[\n,]/).map((x) => x.trim()).filter((x) => x.length > 1).slice(0, 10);
  return json(await prepareCore(env, siteId, String(b.method) as Method, { vendors, experience: String(b.experience || "").slice(0, 3000), ownerName: String(b.ownerName || "").slice(0, 80), ownerRole: String(b.ownerRole || "").slice(0, 80) }, `user:${user.id}`));
}

// PUT /api/offpage/manual/:id { status?, note?, link_url? } — "won" thì đưa link vào Link Monitor
export async function apiManualItem(env: Env, req: Request, user: User, id: number): Promise<Response> {
  canEdit(user);
  const m = await env.DB.prepare("SELECT site_id, url, method FROM op_manual WHERE id = ?").bind(id).first<{ site_id: number; url: string; method: string }>();
  if (!m) throw new HttpError(404, "Không có mục này.", "not_found");
  const b = await readJson<{ status?: string; note?: string; link_url?: string; found_url?: string }>(req);
  if (b.found_url) return json(await imageFoundCore(env, m.site_id, id, String(b.found_url), `user:${user.id}`));
  const status = ["todo", "doing", "done", "won", "skip"].includes(String(b.status)) ? String(b.status) : null;
  let link: string | null = null;
  if (b.link_url) { try { link = new URL(String(b.link_url)).href; } catch { throw new HttpError(400, "Link không hợp lệ.", "validation"); } }
  await env.DB.prepare("UPDATE op_manual SET status = COALESCE(?, status), note = COALESCE(?, note), link_url = COALESCE(?, link_url), updated_at = ? WHERE id = ?").bind(status, b.note !== undefined ? String(b.note).slice(0, 500) : null, link, now(), id).run();
  if (status === "won" && link) await env.DB.prepare("INSERT OR IGNORE INTO op_links (site_id, source_url, note, status, created_at) VALUES (?, ?, ?, 'unchecked', ?)").bind(m.site_id, link, `Làm tay: ${METHODS[m.method as Method]?.label || m.method}`, now()).run();
  return json({ ok: true });
}

export async function apiReclaim(env: Env, req: Request, user: User, siteId: number): Promise<Response> {
  canEdit(user);
  const b = await readJson<{ text?: string }>(req);
  return json(await reclaimCore(env, siteId, String(b.text || "").slice(0, 100_000), `user:${user.id}`));
}

// POST /api/offpage/:siteId/pr-answer { query, notes? } — nháp trả lời phóng viên (anh sửa rồi tự gửi)
export async function apiPrAnswer(env: Env, req: Request, user: User, siteId: number): Promise<Response> {
  canEdit(user);
  const s = await siteOf(env, siteId);
  const { settings } = await readOp(env, s);
  const b = await readJson<{ query?: string; notes?: string; ownerName?: string; ownerRole?: string }>(req);
  const query = String(b.query || "").trim().slice(0, 4000);
  if (query.length < 30) throw new HttpError(400, "Dán nguyên câu hỏi của phóng viên.", "validation");
  const profile = await readProfile(env, siteId);
  const rules = readRules((await env.DB.prepare("SELECT rules FROM recovery_cases WHERE site_id = ? AND status != 'archived' ORDER BY id DESC LIMIT 1").bind(siteId).first<{ rules: string }>())?.rules || "{}");
  const facts = [profile.summary, ...profile.facts.map((f) => f.text), String(b.notes || "")].join("\n").slice(0, 3000);
  const lang = /[äöüß]|\b(und|der|die|das)\b/i.test(query) ? "de" : /\b(the|and|for|with)\b/i.test(query) ? "en" : s.language;
  const out = await aiJson<{ fit?: string; subject?: string; answer?: string; missing?: string[] }>(env, { template: "pr_answer", task: "manual.pr_answer", siteId, rules: writingRules(lang, extractNumbers(facts), rules.blocklist),
    input: { query, profile: { summary: profile.summary, services: profile.services, facts: profile.facts.map((f) => f.text) }, owner_notes: String(b.notes || "").slice(0, 2000), owner_name: String(b.ownerName || settings.senderName || ""), owner_role: String(b.ownerRole || ""), site: `https://${s.domain}` } });
  await logActivity(env, `user:${user.id}`, "manual.pr", `Soạn nháp trả lời phóng viên (${s.domain})`, siteId);
  return json({ fit: String(out.fit || ""), subject: String(out.subject || ""), answer: String(out.answer || ""), missing: (out.missing || []).map(String).slice(0, 8) });
}
