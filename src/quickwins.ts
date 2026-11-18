// Quick wins từ Search Console: trang đã đứng vị trí 4–15 và có nhiều hiển thị nhưng ít click.
// "Ít click" so với chính site này (trung vị CTR của các trang cùng nhóm vị trí), không dùng bảng CTR ngoài không có nguồn.
// Viết lại title/meta description (AI, qua Gác cổng), anh duyệt từng trang rồi mới ghi: WordPress qua plugin (có sao lưu, hoàn tác được),
// Astro qua pull request. Sau khi áp dụng, app đo lại CTR và vị trí từ Search Console để anh thấy hiệu quả.

import { logActivity } from "./activity";
import { aiJson, writingRules } from "./ai";
import { b64Text, branchSha, createBranch, openPr, readFile, tree, writeFile } from "./github";
import { HttpError, json, now, readJson } from "./http";
import { pingChanged } from "./indexnow";
import { parseFrontmatter, readPublishProfile } from "./publish";
import { checkEdits, type GateResult } from "./recovery-gate";
import { extractNumbers } from "./recovery-extract";
import { parseRules, readRules, type SiteRules } from "./recovery-rules";
import { fetchText } from "./web";
import { wpApply, wpCall, wpGetPost, wpRestore } from "./wordpress";
import type { Env, User } from "./types";

const DAY = 86400000;
interface SiteRow { id: number; name: string; domain: string; platform: string; language: string; repo: string | null; publish_profile: string | null }
interface Item {
  id: number; site_id: number; page: string; query: string | null; impr: number; clicks: number; ctr: number; pos: number; expected: number; kind: string; status: string;
  old_title: string | null; old_desc: string | null; new_title: string | null; new_desc: string | null; reason: string | null; gate: string | null;
  backup: string | null; pr: string | null; error: string | null; base_ctr: number | null; base_pos: number | null; applied_at: number | null;
}

const canEdit = (u: User) => { if (u.role === "viewer") throw new HttpError(403, "Tài khoản chỉ xem.", "forbidden"); };
const median = (a: number[]) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2; };
const bucket = (pos: number) => (pos < 4 ? 0 : pos <= 6 ? 1 : pos <= 10 ? 2 : pos <= 15 ? 3 : 4);
const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/\s+/g, " ").trim();
const HONESTY = /\b(we tested|tested by us|hands-on test|wir haben getestet|von uns getestet|im test|testsieger|đã test|đã thử nghiệm|#1|number one|nr\.? ?1|guaranteed|garantiert|cam kết 100)/i;

async function siteOf(env: Env, id: number): Promise<SiteRow> {
  const s = await env.DB.prepare("SELECT id, name, domain, platform, language, repo, publish_profile FROM sites WHERE id = ?").bind(id).first<SiteRow>();
  if (!s) throw new HttpError(404, "Không tìm thấy site.", "not_found");
  return s;
}
async function rulesOf(env: Env, s: SiteRow): Promise<SiteRules> {
  const c = await env.DB.prepare("SELECT rules FROM recovery_cases WHERE site_id = ? ORDER BY id DESC LIMIT 1").bind(s.id).first<{ rules: string }>();
  return c ? readRules(c.rules) : parseRules({ language: s.language });
}

// ---------------- Tìm ----------------

export async function findQuickWins(env: Env, siteId: number): Promise<{ found: number }> {
  const pages = (await env.DB.prepare("SELECT page, clicks7, impr7, pos7 FROM mon_pages WHERE site_id = ? AND impr7 > 0 AND pos7 IS NOT NULL").bind(siteId).all<{ page: string; clicks7: number; impr7: number; pos7: number }>()).results;
  // CTR "bình thường" của chính site: trung vị theo nhóm vị trí (trang có ít nhất 30 hiển thị/tuần cho đỡ nhiễu)
  const solid = pages.filter((p) => p.impr7 >= 30 && p.pos7 <= 15);
  const byB = new Map<number, number[]>();
  for (const p of solid) byB.set(bucket(p.pos7), [...(byB.get(bucket(p.pos7)) || []), p.clicks7 / p.impr7]);
  const siteMed = median(solid.map((p) => p.clicks7 / p.impr7));
  const expectedFor = (pos: number) => { const b = byB.get(bucket(pos)) || []; return b.length >= 3 ? median(b) : siteMed; };
  const t = now();
  const picks: { page: string; impr: number; clicks: number; ctr: number; pos: number; expected: number; kind: "ctr" | "push" }[] = [];
  for (const p of pages) {
    if (p.pos7 < 4 || p.pos7 > 15 || p.impr7 < 50) continue;
    const ctr = p.clicks7 / p.impr7, exp = expectedFor(p.pos7);
    // CTR thấp hơn hẳn trang cùng nhóm vị trí → viết lại title/meta; vị trí 8–15 nhiều hiển thị → đẩy bằng nội dung + link nội bộ
    if ((exp > 0 && ctr < exp * 0.6) || (p.clicks7 === 0 && p.impr7 >= 100)) picks.push({ page: p.page, impr: p.impr7, clicks: p.clicks7, ctr, pos: p.pos7, expected: exp, kind: "ctr" });
    else if (p.pos7 >= 8 && p.impr7 >= 100) picks.push({ page: p.page, impr: p.impr7, clicks: p.clicks7, ctr, pos: p.pos7, expected: exp, kind: "push" });
  }
  picks.sort((a, b) => b.impr - a.impr);
  const keep = picks.slice(0, 30);
  const topQ = async (page: string) => (await env.DB.prepare("SELECT query FROM mon_queries WHERE site_id = ? AND page = ? ORDER BY impr7 DESC LIMIT 1").bind(siteId, page).first<{ query: string }>())?.query || null;
  const stmts = [];
  for (const k of keep) {
    stmts.push(env.DB.prepare(`INSERT INTO qw_items (site_id, page, query, impr, clicks, ctr, pos, expected, kind, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?)
      ON CONFLICT(site_id, page) DO UPDATE SET query = excluded.query, impr = excluded.impr, clicks = excluded.clicks, ctr = excluded.ctr, pos = excluded.pos, expected = excluded.expected,
      kind = CASE WHEN qw_items.status IN ('new', 'rejected') THEN excluded.kind ELSE qw_items.kind END, updated_at = excluded.updated_at`)
      .bind(siteId, k.page, await topQ(k.page), k.impr, k.clicks, +k.ctr.toFixed(4), +k.pos.toFixed(1), +k.expected.toFixed(4), k.kind, t, t));
  }
  // Trang không còn đủ điều kiện mà chưa ai đụng tới: bỏ khỏi danh sách
  stmts.push(env.DB.prepare(`DELETE FROM qw_items WHERE site_id = ? AND status = 'new' AND updated_at < ?`).bind(siteId, t));
  await env.DB.batch(stmts);
  return { found: keep.length };
}

// ---------------- Viết đề xuất ----------------

async function livePage(url: string): Promise<{ title: string; desc: string; h1: string; text: string }> {
  const r = await fetchText(url, 800_000, 15000);
  if (!r || r.status >= 400) throw new HttpError(502, `Không mở được trang (${r?.status || "lỗi kết nối"}).`, "fetch");
  const h = r.text;
  const title = decode(h.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "");
  const desc = decode((h.match(/<meta[^>]+name=["']description["'][^>]*>/i)?.[0] || "").match(/content=["']([^"']*)["']/i)?.[1] || "");
  const h1 = decode((h.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || "").replace(/<[^>]+>/g, " "));
  const main = (h.match(/<article[\s\S]*?<\/article>/i) || h.match(/<main[\s\S]*?<\/main>/i) || [h])[0].replace(/<(script|style|nav|header|footer|aside|form|svg)[\s\S]*?<\/\1>/gi, " ");
  return { title, desc, h1, text: decode(main.replace(/<[^>]+>/g, " ")).slice(0, 6000) };
}

function gateMeta(it: { old_title: string | null; old_desc: string | null; new_title: string; new_desc: string; query: string | null }, rules: SiteRules, pageText: string): GateResult {
  const g = checkEdits([
    { type: "meta_title", find: it.old_title || "", replace: it.new_title },
    { type: "meta_description", find: it.old_desc || "", replace: it.new_desc }
  ], { rules, pageNumbers: extractNumbers(pageText) });
  const p = (rule: string, level: "block" | "warn", message: string) => g.problems.push({ rule, level, message });
  const both = `${it.new_title} ${it.new_desc}`;
  if (HONESTY.test(both)) p("honesty", "block", "Có lời hứa/khẳng định không kiểm chứng được (đã test, số 1, cam kết…).");
  if (it.new_title.length < 25) p("length", "warn", `Title chỉ ${it.new_title.length} ký tự.`);
  if (it.new_desc.length < 70) p("length", "warn", `Description chỉ ${it.new_desc.length} ký tự.`);
  if (/[A-ZÄÖÜ]{6,}/.test(it.new_title)) p("caps", "warn", "Title có chữ IN HOA dài.");
  if (/\p{Extended_Pictographic}/u.test(both)) p("emoji", "block", "Có emoji.");
  if (it.query) {
    const want = it.query.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
    const t = it.new_title.toLowerCase();
    if (want.length && !want.some((w) => t.includes(w.slice(0, Math.max(4, w.length - 2))))) p("query", "warn", `Title không chứa truy vấn chính "${it.query}".`);
  }
  if (it.old_title && it.new_title.trim() === it.old_title.trim() && it.old_desc && it.new_desc.trim() === it.old_desc.trim()) p("same", "block", "Đề xuất giống hệt bản đang chạy.");
  return { ok: !g.problems.some((x) => x.level === "block"), checkedAt: Date.now(), problems: g.problems };
}

async function itemOf(env: Env, id: number): Promise<Item> {
  const r = await env.DB.prepare("SELECT * FROM qw_items WHERE id = ?").bind(id).first<Item>();
  if (!r) throw new HttpError(404, "Không tìm thấy mục này.", "not_found");
  return r;
}

export async function draftCore(env: Env, id: number, actor: string): Promise<Item> {
  const it = await itemOf(env, id);
  if (["approved", "applied"].includes(it.status)) throw new HttpError(409, "Mục này đã duyệt hoặc đã áp dụng.", "state");
  const s = await siteOf(env, it.site_id);
  const rules = await rulesOf(env, s);
  const page = await livePage(it.page);
  const queries = (await env.DB.prepare("SELECT query, impr7, clicks7, pos7 FROM mon_queries WHERE site_id = ? AND page = ? ORDER BY impr7 DESC LIMIT 8").bind(s.id, it.page).all()).results;
  const out = await aiJson<{ title?: string; description?: string; reason?: string }>(env, {
    template: "quickwin_meta", task: "quickwins.meta", siteId: s.id,
    rules: writingRules(rules.language || s.language, extractNumbers(page.text), rules.blocklist),
    input: { url: it.page, language: rules.language || s.language, brand: s.name, current_title: page.title, current_description: page.desc, h1: page.h1, queries, position: it.pos, page_text: page.text.slice(0, 3000) }
  });
  const nt = String(out.title || "").replace(/\s+/g, " ").trim().slice(0, 120), nd = String(out.description || "").replace(/\s+/g, " ").trim().slice(0, 300);
  if (!nt || !nd) throw new HttpError(502, "AI không trả title/description.", "ai_empty");
  const gate = gateMeta({ old_title: page.title, old_desc: page.desc, new_title: nt, new_desc: nd, query: it.query }, rules, page.text);
  await env.DB.prepare("UPDATE qw_items SET status = 'drafted', old_title = ?, old_desc = ?, new_title = ?, new_desc = ?, reason = ?, gate = ?, error = NULL, updated_at = ? WHERE id = ?")
    .bind(page.title, page.desc, nt, nd, String(out.reason || "").slice(0, 400), JSON.stringify(gate), now(), id).run();
  await logActivity(env, actor, "quickwins.draft", `Đề xuất title/meta cho ${it.page}${gate.ok ? "" : " (Gác cổng chặn)"}`, s.id);
  return itemOf(env, id);
}

// ---------------- Áp dụng ----------------

function setFrontmatter(text: string, key: string, value: string): string | null {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  const esc = JSON.stringify(value);
  const re = new RegExp(`^(${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:).*$`, "m");
  if (!re.test(m[1]!)) return null;
  // Hàm thay thế (không dùng chuỗi) để ký tự $ trong title không bị hiểu là nhóm regex
  const fm = m[1]!.replace(re, (_all, k: string) => `${k} ${esc}`);
  return text.replace(m[1]!, () => fm);
}

export async function applyCore(env: Env, id: number, actor: string): Promise<Item> {
  const it = await itemOf(env, id);
  if (it.status !== "approved") throw new HttpError(409, "Chỉ áp dụng được mục đã duyệt.", "not_approved");
  const s = await siteOf(env, it.site_id);
  const rules = await rulesOf(env, s);
  const page = await livePage(it.page);
  // Gác cổng chạy lại ngay trước khi ghi
  const gate = gateMeta({ old_title: page.title, old_desc: page.desc, new_title: it.new_title!, new_desc: it.new_desc!, query: it.query }, rules, page.text);
  if (!gate.ok) {
    await env.DB.prepare("UPDATE qw_items SET status = 'drafted', gate = ?, updated_at = ? WHERE id = ?").bind(JSON.stringify(gate), now(), id).run();
    throw new HttpError(409, `Gác cổng chặn: ${gate.problems.filter((x) => x.level === "block").map((x) => x.message).join(" ")}`, "blocked");
  }
  const base = await env.DB.prepare("SELECT clicks7, impr7, pos7 FROM mon_pages WHERE site_id = ? AND page = ?").bind(s.id, it.page).first<{ clicks7: number; impr7: number; pos7: number }>();
  const baseCtr = base && base.impr7 ? base.clicks7 / base.impr7 : it.ctr, basePos = base?.pos7 ?? it.pos;
  if (s.platform === "astro") {
    const p = readPublishProfile(s);
    if (!s.repo || !p) throw new HttpError(409, "Site Astro chưa có hồ sơ đăng bài (Content Studio › Đăng lên GitHub › Đọc repo).", "no_profile");
    let slug = "";
    try { slug = new URL(it.page).pathname.replace(/\/+$/, "").split("/").pop() || ""; } catch { /* để trống */ }
    if (!slug) throw new HttpError(409, "Trang chủ Astro không sửa qua đây được.", "home");
    const files = (await tree(env, s.repo, p.branch)).filter((f) => /\.mdx?$/.test(f));
    const file = files.find((f) => f.replace(/\.mdx?$/, "").split("/").pop() === slug) || files.find((f) => /\/index\.mdx?$/.test(f) && f.split("/").slice(-2, -1)[0] === slug);
    if (!file) throw new HttpError(409, `Không tìm thấy file Markdown có slug "${slug}" trong repo.`, "no_file");
    const src = await readFile(env, s.repo, file, p.branch);
    if (!src) throw new HttpError(409, "Không đọc được file.", "no_file");
    const fm = parseFrontmatter(src.text).data;
    const tk = p.map.title || "title", dk = p.map.description || "description";
    let text: string | null = src.text;
    if (fm[tk] != null) text = setFrontmatter(text, tk, it.new_title!);
    if (text && fm[dk] != null) text = setFrontmatter(text, dk, it.new_desc!);
    if (!text || text === src.text) throw new HttpError(409, `Frontmatter không có ${tk}/${dk} để sửa.`, "no_field");
    const head = await branchSha(env, s.repo, p.branch);
    if (!head) throw new HttpError(502, `Không đọc được nhánh ${p.branch}.`, "no_branch");
    const branch = `duyoi/quickwin-${slug.slice(0, 40)}-${Date.now().toString(36)}`;
    await createBranch(env, s.repo, branch, head);
    await writeFile(env, s.repo, file, b64Text(text), `Title/meta: ${slug}`, branch);
    const pr = await openPr(env, s.repo, branch, p.branch, `Title và meta mới: ${slug}`, `Duy Ơi đề xuất title/meta mới cho ${it.page} (vị trí ${it.pos}, CTR thấp hơn các trang cùng nhóm vị trí). Đã qua Gác cổng và được duyệt trong app.\n\nTitle: ${it.new_title}\nDescription: ${it.new_desc}\n\nLưu ý: nếu layout dùng frontmatter title làm H1 thì H1 cũng đổi theo.`);
    await env.DB.prepare("UPDATE qw_items SET status = 'applied', pr = ?, gate = ?, base_ctr = ?, base_pos = ?, applied_at = ?, error = NULL, updated_at = ? WHERE id = ?")
      .bind(JSON.stringify({ number: pr.number, url: pr.html_url, file }), JSON.stringify(gate), baseCtr, basePos, now(), now(), id).run();
    await logActivity(env, actor, "quickwins.apply", `Mở pull request title/meta cho ${it.page}: ${pr.html_url}`, s.id);
  } else {
    const info = await wpCall<{ rankmath?: boolean }>(env, s.id, "/ping");
    if (!info.rankmath) throw new HttpError(409, "Site chưa dùng Rank Math: plugin chỉ ghi title/meta qua Rank Math.", "no_rankmath");
    const post = await wpGetPost(env, s.id, it.page);
    const meta = { rank_math_title: it.new_title!, rank_math_description: it.new_desc! };
    await wpApply(env, s.id, { id: post.id, expected_modified: post.modified_gmt, edits: [], meta, dry_run: true });
    const backup = { id: post.id, meta: { rank_math_title: String(post.meta?.rank_math_title ?? ""), rank_math_description: String(post.meta?.rank_math_description ?? "") } };
    await env.DB.prepare("UPDATE qw_items SET backup = ?, updated_at = ? WHERE id = ?").bind(JSON.stringify(backup), now(), id).run();
    await wpApply(env, s.id, { id: post.id, expected_modified: post.modified_gmt, edits: [], meta });
    await env.DB.prepare("UPDATE qw_items SET status = 'applied', gate = ?, base_ctr = ?, base_pos = ?, applied_at = ?, error = NULL, updated_at = ? WHERE id = ?").bind(JSON.stringify(gate), baseCtr, basePos, now(), now(), id).run();
    await pingChanged(env, s.id, it.page, "title/meta mới");
    await logActivity(env, actor, "quickwins.apply", `Ghi title/meta mới cho ${it.page}`, s.id);
  }
  return itemOf(env, id);
}

export async function rollbackCore(env: Env, id: number, actor: string): Promise<Item> {
  const it = await itemOf(env, id);
  if (it.status !== "applied" || !it.backup) throw new HttpError(409, "Chỉ hoàn tác được mục WordPress đã áp dụng (Astro: đóng pull request).", "state");
  const b = JSON.parse(it.backup) as { id: number; meta: Record<string, string> };
  await wpRestore(env, it.site_id, { id: b.id, content: null, elementor_data: null, meta: b.meta });
  await env.DB.prepare("UPDATE qw_items SET status = 'drafted', applied_at = NULL, updated_at = ? WHERE id = ?").bind(now(), id).run();
  await logActivity(env, actor, "quickwins.rollback", `Hoàn tác title/meta của ${it.page}`, it.site_id);
  return itemOf(env, id);
}

// ---------------- API ----------------

export async function apiQuickWins(env: Env, siteId: number | null): Promise<Response> {
  const sites = (await env.DB.prepare("SELECT s.id, s.name, s.domain, s.platform, (SELECT COUNT(*) FROM qw_items q WHERE q.site_id = s.id AND q.status IN ('new', 'drafted', 'approved')) AS open, (SELECT COUNT(*) FROM qw_items q WHERE q.site_id = s.id AND q.status = 'applied') AS applied, (SELECT MAX(updated_at) FROM mon_pages p WHERE p.site_id = s.id) AS gscAt FROM sites s WHERE s.status != 'archived' ORDER BY s.id").all<{ id: number }>()).results;
  const sid = siteId || sites[0]?.id || 0;
  const items = (await env.DB.prepare("SELECT q.*, p.clicks7 AS now_clicks, p.impr7 AS now_impr, p.pos7 AS now_pos FROM qw_items q LEFT JOIN mon_pages p ON p.site_id = q.site_id AND p.page = q.page WHERE q.site_id = ? ORDER BY CASE q.status WHEN 'approved' THEN 0 WHEN 'drafted' THEN 1 WHEN 'new' THEN 2 WHEN 'applied' THEN 3 ELSE 4 END, q.impr DESC").bind(sid).all<Item & { now_clicks: number | null; now_impr: number | null; now_pos: number | null }>()).results;
  return json({
    siteId: sid, sites,
    items: items.map((i) => ({ ...i, gate: i.gate ? JSON.parse(i.gate) : null, pr: i.pr ? JSON.parse(i.pr) : null, backup: undefined, canRollback: !!i.backup && i.status === "applied",
      after: i.applied_at && Date.now() - i.applied_at >= 7 * DAY && i.now_impr ? { ctr: +(Number(i.now_clicks) / Number(i.now_impr)).toFixed(4), pos: i.now_pos } : null }))
  });
}

export async function apiFindQuickWins(env: Env, user: User, siteId: number): Promise<Response> {
  canEdit(user);
  await siteOf(env, siteId);
  const r = await findQuickWins(env, siteId);
  await logActivity(env, `user:${user.id}`, "quickwins.find", `Tìm quick wins: ${r.found} trang`, siteId);
  return json(r);
}

// POST /api/quickwins/items/:id/(draft|approve|reject|apply|rollback), PUT … { new_title, new_desc } để anh sửa tay
export async function apiQuickWinAction(env: Env, req: Request, user: User, id: number, action: string): Promise<Response> {
  canEdit(user);
  const actor = `user:${user.id}`;
  if (action === "draft") return json({ item: await draftCore(env, id, actor) });
  if (action === "apply") return json({ item: await applyCore(env, id, actor) });
  if (action === "rollback") return json({ item: await rollbackCore(env, id, actor) });
  const it = await itemOf(env, id);
  if (action === "edit") {
    const b = await readJson<{ new_title?: string; new_desc?: string }>(req);
    const nt = String(b.new_title || "").replace(/\s+/g, " ").trim(), nd = String(b.new_desc || "").replace(/\s+/g, " ").trim();
    if (!nt || !nd) throw new HttpError(400, "Cần cả title và description.", "validation");
    if (it.status === "applied") throw new HttpError(409, "Đã áp dụng: hoàn tác trước rồi sửa.", "state");
    const s = await siteOf(env, it.site_id);
    const page = await livePage(it.page);
    const gate = gateMeta({ old_title: page.title, old_desc: page.desc, new_title: nt, new_desc: nd, query: it.query }, await rulesOf(env, s), page.text);
    await env.DB.prepare("UPDATE qw_items SET status = 'drafted', old_title = ?, old_desc = ?, new_title = ?, new_desc = ?, gate = ?, updated_at = ? WHERE id = ?").bind(page.title, page.desc, nt, nd, JSON.stringify(gate), now(), id).run();
    return json({ item: await itemOf(env, id) });
  }
  if (action === "approve") {
    if (it.status !== "drafted" || !it.new_title) throw new HttpError(409, "Chưa có đề xuất để duyệt.", "state");
    const g = it.gate ? (JSON.parse(it.gate) as GateResult) : null;
    if (!g?.ok) throw new HttpError(409, "Gác cổng đang chặn đề xuất này: sửa lại hoặc viết lại.", "blocked");
    await env.DB.prepare("UPDATE qw_items SET status = 'approved', updated_at = ? WHERE id = ?").bind(now(), id).run();
    await logActivity(env, actor, "quickwins.approve", `Duyệt title/meta mới cho ${it.page}`, it.site_id);
    return json({ item: await itemOf(env, id) });
  }
  if (action === "reject") {
    await env.DB.prepare("UPDATE qw_items SET status = 'rejected', updated_at = ? WHERE id = ?").bind(now(), id).run();
    return json({ item: await itemOf(env, id) });
  }
  throw new HttpError(400, "Việc không hợp lệ.", "validation");
}

export async function quickWinCounts(env: Env, siteId: number): Promise<{ open: number; approved: number; applied30: number }> {
  const r = await env.DB.prepare("SELECT SUM(status IN ('new', 'drafted')) AS open, SUM(status = 'approved') AS approved, SUM(status = 'applied' AND applied_at > ?) AS applied30 FROM qw_items WHERE site_id = ?").bind(now() - 30 * DAY, siteId).first<{ open: number | null; approved: number | null; applied30: number | null }>();
  return { open: r?.open || 0, approved: r?.approved || 0, applied30: r?.applied30 || 0 };
}
