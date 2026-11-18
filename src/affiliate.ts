// Link affiliate cho bài đã đăng (money page): thư viện link theo site → agent rà bài, đề xuất
// gắn link vào lần nhắc đầu tiên của sản phẩm (chỉ bọc thẻ <a>, không đổi chữ), nút mua sau đoạn đó (tuỳ chọn),
// câu công khai đầu bài nếu chưa có → Gác cổng → anh duyệt → WordPress (plugin, thử trước + sao lưu + hoàn tác)
// hoặc Astro (pull request). Đổi link: thay URL cũ ở mọi bài. Áp dụng quá 3 trang một lần cần anh xác nhận rõ.

import { logActivity } from "./activity";
import { pingChanged } from "./indexnow";
import { b64Text, branchSha, createBranch, openPr, readFile, tree, writeFile } from "./github";
import { HttpError, json, now, readJson } from "./http";
import { readPublishProfile, parseFrontmatter } from "./publish";
import { clean } from "./recovery-extract";
import { readRules } from "./recovery-rules";
import { defaultDisclosure } from "./formats";
import { wpApply, wpGetPost, wpRestore, type WpEdit } from "./wordpress";
import type { Env, User } from "./types";

export interface AffLink { id: number; site_id: number; name: string; aliases: string[]; url: string; merchant: string; old_urls: string[]; active: number }
interface SiteRow { id: number; domain: string; platform: string; repo: string | null; publish_profile: string | null; language: string }

const canEdit = (u: User) => { if (u.role === "viewer") throw new HttpError(403, "Tài khoản chỉ xem.", "forbidden"); };
const httpsUrl = (v: unknown) => { try { const u = new URL(String(v || "").trim()); return u.protocol === "https:" ? u.href : ""; } catch { return ""; } };
const escA = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const reEsc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const DISCLOSURE_RE = /affiliate|werbung|anzeige|provision|commission|paid link|bezahlte|tiếp thị liên kết|hoa hồng|amazon associate/i;
const parseArr = (s: string) => { try { const v = JSON.parse(s); return Array.isArray(v) ? v.map(String) : []; } catch { return []; } };

async function site(env: Env, id: number): Promise<SiteRow> {
  const s = await env.DB.prepare("SELECT id, domain, platform, repo, publish_profile, language FROM sites WHERE id = ?").bind(id).first<SiteRow>();
  if (!s) throw new HttpError(404, "Không tìm thấy site.", "not_found");
  return s;
}
async function links(env: Env, siteId: number, all = false): Promise<AffLink[]> {
  const { results } = await env.DB.prepare(`SELECT * FROM affiliate_links WHERE site_id = ?${all ? "" : " AND active = 1"} ORDER BY name`).bind(siteId).all<Record<string, unknown>>();
  return results.map((r) => ({ ...(r as unknown as AffLink), aliases: parseArr(String(r.aliases)), old_urls: parseArr(String(r.old_urls)) }));
}
async function rulesOf(env: Env, siteId: number) {
  const c = await env.DB.prepare("SELECT rules FROM recovery_cases WHERE site_id = ? AND status != 'archived' ORDER BY id DESC LIMIT 1").bind(siteId).first<{ rules: string }>();
  return readRules(c?.rules || "{}");
}

// ---------------- Thư viện link ----------------

export async function apiLinks(env: Env, siteId: number): Promise<Response> {
  const s = await site(env, siteId);
  const { results } = await env.DB.prepare("SELECT * FROM affiliate_edits WHERE site_id = ? AND status IN ('proposed', 'approved', 'failed') ORDER BY page, id").bind(siteId).all<Record<string, unknown>>();
  const applies = (await env.DB.prepare("SELECT id, page, platform, pr, status, by, at FROM affiliate_applies WHERE site_id = ? ORDER BY id DESC LIMIT 20").bind(siteId).all<Record<string, unknown>>()).results;
  return json({ platform: s.platform, links: await links(env, siteId, true), edits: results.map((e) => ({ ...e, gate: e.gate ? JSON.parse(String(e.gate)) : null })), applies: applies.map((a) => ({ ...a, pr: a.pr ? JSON.parse(String(a.pr)) : null })) });
}

// POST /api/sites/:id/affiliate/links { name, aliases, url, merchant } · PUT …/links/:linkId · DELETE …/links/:linkId
export async function apiSaveLink(env: Env, req: Request, user: User, siteId: number, linkId: number | null): Promise<Response> {
  canEdit(user);
  await site(env, siteId);
  const b = await readJson<{ name?: string; aliases?: unknown; url?: string; merchant?: string; active?: boolean }>(req);
  const name = String(b.name || "").trim().slice(0, 120);
  const url = httpsUrl(b.url);
  if (name.length < 2) throw new HttpError(400, "Nhập tên sản phẩm.", "validation");
  if (!url) throw new HttpError(400, "Link affiliate phải là https.", "validation");
  const aliases = [...new Set((Array.isArray(b.aliases) ? b.aliases : String(b.aliases || "").split(/[\n,]/)).map((x) => String(x).trim()).filter((x) => x.length >= 2 && x.toLowerCase() !== name.toLowerCase()))].slice(0, 10);
  const merchant = String(b.merchant || "").trim().slice(0, 40);
  if (linkId) {
    const cur = await env.DB.prepare("SELECT url, old_urls FROM affiliate_links WHERE id = ? AND site_id = ?").bind(linkId, siteId).first<{ url: string; old_urls: string }>();
    if (!cur) throw new HttpError(404, "Không có link này.", "not_found");
    const old = cur.url !== url ? [...new Set([...parseArr(cur.old_urls), cur.url])].slice(-10) : parseArr(cur.old_urls);
    await env.DB.prepare("UPDATE affiliate_links SET name = ?, aliases = ?, url = ?, merchant = ?, old_urls = ?, active = ?, updated_at = ? WHERE id = ?").bind(name, JSON.stringify(aliases), url, merchant, JSON.stringify(old), b.active === false ? 0 : 1, now(), linkId).run();
    await logActivity(env, `user:${user.id}`, "affiliate.link", `Sửa link affiliate "${name}"${cur.url !== url ? " (đổi URL: bấm Rà bài để thay ở các bài cũ)" : ""}`, siteId);
    return json({ ok: true, id: linkId, urlChanged: cur.url !== url });
  }
  const r = await env.DB.prepare("INSERT INTO affiliate_links (site_id, name, aliases, url, merchant, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id").bind(siteId, name, JSON.stringify(aliases), url, merchant, now(), now()).first<{ id: number }>();
  await logActivity(env, `user:${user.id}`, "affiliate.link", `Thêm link affiliate "${name}"`, siteId);
  return json({ ok: true, id: r!.id }, 201);
}
export async function apiDeleteLink(env: Env, user: User, siteId: number, linkId: number): Promise<Response> {
  canEdit(user);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM affiliate_edits WHERE link_id = ? AND site_id = ? AND status IN ('proposed', 'approved')").bind(linkId, siteId),
    env.DB.prepare("DELETE FROM affiliate_links WHERE id = ? AND site_id = ?").bind(linkId, siteId)
  ]);
  return json({ ok: true });
}

// ---------------- Rà bài, đề xuất ----------------

interface Page { page: string; title: string; text: string; html: string; paras: string[] }

const sentences = (text: string) => text.split(/(?<=[.!?])\s+(?=[A-ZÄÖÜÀ-Ỹ0-9"„“])/).map((s) => s.trim()).filter(Boolean);
function count(hay: string, needle: string) { let n = 0, i = 0; while ((i = hay.indexOf(needle, i)) >= 0) { n++; i += needle.length; } return n; }

// Câu chứa lần nhắc đầu tiên của sản phẩm (chưa nằm trong link), đúng 1 lần trên trang
function firstMention(p: Page, l: AffLink, md: boolean): { sentence: string; alias: string } | null {
  for (const alias of [l.name, ...l.aliases]) {
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])(${reEsc(alias)})(?=$|[^\\p{L}\\p{N}])`, "iu");
    for (const s of p.paras.flatMap(sentences)) {
      if (s.length < 20 || s.length > 400 || !re.test(s)) continue;
      if (count(p.html, s) !== 1) continue; // phải khớp đúng 1 lần trong nội dung thật (HTML hoặc Markdown)
      if (md && /\]\(|<a\b/i.test(s)) continue;
      // Đã nằm trong thẻ link trên trang thì bỏ qua
      const linked = new RegExp(`<a\\b[^>]*>[^<]*${reEsc(alias)}[^<]*</a>`, "i").test(p.html);
      if (linked) return null;
      const m = s.match(re)!;
      return { sentence: s, alias: m[2]! };
    }
  }
  return null;
}

const anchor = (url: string, text: string) => `<a href="${escA(url)}" rel="sponsored nofollow noopener" target="_blank">${text}</a>`;
const wrapFirst = (sentence: string, alias: string, url: string) => sentence.replace(new RegExp(`(^|[^\\p{L}\\p{N}])(${reEsc(alias)})(?=$|[^\\p{L}\\p{N}])`, "u"), (_m, pre: string, a: string) => `${pre}${anchor(url, a)}`);

async function pagesWp(env: Env, s: SiteRow): Promise<Page[]> {
  const c = await env.DB.prepare("SELECT id FROM recovery_cases WHERE site_id = ? AND status != 'archived' ORDER BY id DESC LIMIT 1").bind(s.id).first<{ id: number }>();
  if (!c) throw new HttpError(409, "Site chưa được quét: thêm ở Phục hồi để app biết danh sách bài.", "no_case");
  const rows = (await env.DB.prepare("SELECT url, kind, json_extract(data, '$.title') AS title FROM recovery_pages WHERE case_id = ? AND status = 'done' AND (kind IS NULL OR kind != 'system') LIMIT 40").bind(c.id).all<{ url: string; title: string | null }>()).results;
  const out: Page[] = [];
  for (const r of rows) {
    const res = await fetch(r.url, { headers: { "User-Agent": "DuyOi/1.0 (+affiliate)" }, signal: AbortSignal.timeout(12000) }).catch(() => null);
    if (!res?.ok) continue;
    const raw = await res.text();
    const html = (raw.match(/<article[\s\S]*?<\/article>/i) || raw.match(/<main[\s\S]*?<\/main>/i) || [raw])[0].replace(/<(script|style|nav|header|footer|aside|form)[\s\S]*?<\/\1>/gi, " ");
    const paras = [...html.matchAll(/<(p|li)\b[^>]*>([\s\S]*?)<\/\1>/gi)].map((m) => m[2]!).filter((x) => !/<(a|strong|em|b|i|span|br)\b/i.test(x)).map((x) => clean(x));
    out.push({ page: r.url, title: r.title || r.url, html, text: clean(html), paras });
  }
  return out;
}

async function pagesAstro(env: Env, s: SiteRow): Promise<Page[]> {
  const p = readPublishProfile(s);
  if (!s.repo || !p) throw new HttpError(409, "Site Astro chưa có hồ sơ đăng bài: vào Bài mới › Đăng lên GitHub › Đọc repo.", "no_profile");
  const files = (await tree(env, s.repo, p.branch)).filter((f) => f.startsWith(`${p.dir}/`) && /\.mdx?$/.test(f)).slice(0, 80);
  const out: Page[] = [];
  for (const f of files) {
    const file = await readFile(env, s.repo, f, p.branch);
    if (!file) continue;
    const fm = parseFrontmatter(file.text);
    const body = fm.body.split("\n").filter((l) => !/^\s*(#|import |export |```|<[A-Z]|\||!\[)/.test(l)).join("\n");
    out.push({ page: f, title: String(fm.data.title || f), html: fm.body, text: fm.body, paras: body.split(/\n{2,}/).map((x) => x.replace(/\n/g, " ").trim()).filter(Boolean) });
  }
  return out;
}

export async function scanCore(env: Env, siteId: number, opts: { buttons: boolean }, actor: string): Promise<{ proposed: number; pages: number }> {
  const s = await site(env, siteId);
  const ls = await links(env, siteId);
  if (!ls.length) throw new HttpError(409, "Thư viện chưa có link affiliate nào.", "no_links");
  const rules = await rulesOf(env, siteId);
  const astro = s.platform === "astro";
  const pages = astro ? await pagesAstro(env, s) : await pagesWp(env, s);
  await env.DB.prepare("DELETE FROM affiliate_edits WHERE site_id = ? AND status = 'proposed'").bind(siteId).run();
  const disclosure = (rules.affiliateDisclosure || defaultDisclosure(rules.language || s.language)).trim();
  const label = (l: AffLink) => (rules.buyButtonText || (rules.language === "de" ? "Bei {merchant} ansehen" : rules.language === "vi" ? "Xem giá tại {merchant}" : "Check price at {merchant}")).replace("{merchant}", l.merchant || l.name);
  let proposed = 0;
  const add = async (pg: Page, linkId: number | null, kind: string, find: string, replace: string, gate: { ok: boolean; problems: { rule: string; level: string; message: string }[] }) => {
    await env.DB.prepare("INSERT INTO affiliate_edits (site_id, link_id, page, page_title, kind, find, replace, gate, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(siteId, linkId, pg.page, pg.title.slice(0, 200), kind, find, replace, JSON.stringify(gate), now(), now()).run();
    proposed++;
  };
  for (const pg of pages) {
    const existing = (pg.html.match(/rel="[^"]*sponsored[^"]*"/gi) || []).length;
    let room = Math.max(0, rules.maxLinksPerPage - existing);
    let added = 0;
    // Đổi link: URL cũ còn trên trang → thay bằng URL mới
    for (const l of ls) for (const old of l.old_urls) {
      if (!pg.html.includes(old)) continue;
      const blocked = rules.blocklist.find((b) => b && l.name.toLowerCase().includes(b.toLowerCase()));
      await add(pg, l.id, "replace_url", old, l.url, { ok: !blocked, problems: blocked ? [{ rule: "blocklist", level: "block", message: `Sản phẩm chứa từ cấm "${blocked}".` }] : [] });
    }
    for (const l of ls) {
      if (!room) break;
      if (pg.html.includes(l.url)) continue;
      const m = firstMention(pg, l, astro);
      if (!m) continue;
      const problems: { rule: string; level: string; message: string }[] = [];
      const blocked = rules.blocklist.find((b) => b && `${l.name} ${l.url}`.toLowerCase().includes(b.toLowerCase()));
      if (blocked) problems.push({ rule: "blocklist", level: "block", message: `Link chứa từ cấm "${blocked}".` });
      if (/amazon\.|amzn\.to/i.test(l.url)) problems.push({ rule: "amazon", level: "warn", message: "Link Amazon: site cần câu Amazon Associate; không ghi giá cố định." });
      await add(pg, l.id, "link", m.sentence, wrapFirst(m.sentence, m.alias, l.url), { ok: !problems.some((p) => p.level === "block"), problems });
      if (opts.buttons) await add(pg, l.id, "button", m.sentence, `<p class="buy-buttons">${anchor(l.url, escA(label(l)))}</p>`, { ok: !blocked, problems: [] });
      room--; added++;
    }
    if (added && !DISCLOSURE_RE.test(pg.text)) {
      const first = pg.paras.flatMap(sentences).find((x) => x.length >= 20 && count(pg.html, x) === 1) || "";
      if (first || astro) await add(pg, null, "disclosure", astro ? "" : first, `<p class="affiliate-disclosure"><em>${escA(disclosure)}</em></p>`, { ok: true, problems: [] });
    }
  }
  await logActivity(env, actor, "affiliate.scan", `Rà ${pages.length} bài: ${proposed} đề xuất link affiliate`, siteId);
  return { proposed, pages: pages.length };
}
export async function apiScan(env: Env, req: Request, user: User, siteId: number): Promise<Response> {
  canEdit(user);
  const b = await readJson<{ buttons?: boolean }>(req).catch(() => ({} as { buttons?: boolean }));
  return json(await scanCore(env, siteId, { buttons: b.buttons === true }, `user:${user.id}`));
}

// PUT /api/sites/:id/affiliate/edits { ids[], status: approved|rejected|proposed }
export async function apiDecide(env: Env, req: Request, user: User, siteId: number): Promise<Response> {
  canEdit(user);
  const b = await readJson<{ ids?: number[]; status?: string }>(req);
  const status = ["approved", "rejected", "proposed"].includes(String(b.status)) ? String(b.status) : "";
  const ids = (Array.isArray(b.ids) ? b.ids : []).map(Number).filter(Boolean).slice(0, 200);
  if (!status || !ids.length) throw new HttpError(400, "Thiếu việc hoặc trạng thái.", "validation");
  for (const id of ids) {
    const e = await env.DB.prepare("SELECT gate FROM affiliate_edits WHERE id = ? AND site_id = ?").bind(id, siteId).first<{ gate: string | null }>();
    if (!e) continue;
    if (status === "approved" && e.gate && !JSON.parse(e.gate).ok) continue; // Gác cổng chặn thì không duyệt được
    await env.DB.prepare("UPDATE affiliate_edits SET status = ?, updated_at = ? WHERE id = ? AND status IN ('proposed', 'approved', 'failed')").bind(status, now(), id).run();
  }
  return json({ ok: true });
}

// ---------------- Áp dụng ----------------

function applyToMarkdown(text: string, edits: { kind: string; find: string; replace: string }[]): { text: string; failed: string[] } {
  let out = text;
  const failed: string[] = [];
  for (const e of edits) {
    if (e.kind === "replace_url") { if (out.includes(e.find)) out = out.split(e.find).join(e.replace); else failed.push(e.find); continue; }
    if (e.kind === "disclosure") { out = out.replace(/^(---\n[\s\S]*?\n---\n)((?:import [^\n]+\n)*)/, `$1$2\n${e.replace}\n`); continue; }
    if (count(out, e.find) !== 1) { failed.push(e.find.slice(0, 60)); continue; }
    if (e.kind === "link") out = out.replace(e.find, e.replace);
    if (e.kind === "button") { const i = out.indexOf(e.find); const end = out.indexOf("\n\n", i); out = end < 0 ? `${out}\n\n${e.replace}\n` : `${out.slice(0, end)}\n\n${e.replace}${out.slice(end)}`; }
  }
  return { text: out, failed };
}

// POST /api/sites/:id/affiliate/apply { confirmBulk? } — áp dụng các đề xuất đã duyệt, gom theo trang
export async function applyCore(env: Env, siteId: number, confirmBulk: boolean, actor: string): Promise<{ pages: number; applied: number; failed: number; prs: string[] }> {
  const s = await site(env, siteId);
  const { results } = await env.DB.prepare("SELECT * FROM affiliate_edits WHERE site_id = ? AND status = 'approved' ORDER BY page, CASE kind WHEN 'disclosure' THEN 0 WHEN 'button' THEN 1 WHEN 'replace_url' THEN 2 ELSE 3 END, id").bind(siteId).all<{ id: number; page: string; page_title: string; kind: string; find: string; replace: string }>();
  if (!results.length) throw new HttpError(409, "Chưa có đề xuất nào được duyệt.", "nothing");
  const byPage = new Map<string, typeof results>();
  for (const e of results) byPage.set(e.page, [...(byPage.get(e.page) || []), e]);
  if (byPage.size > 3 && !confirmBulk) throw new HttpError(409, `Sắp sửa ${byPage.size} trang một lần: cần anh xác nhận (luật: sửa hàng loạt quá 3 trang phải duyệt rõ).`, "confirm_bulk");
  let applied = 0, failed = 0;
  const prs: string[] = [];
  const mark = async (ids: number[], status: string, applyId: number | null, error: string | null) => { for (const id of ids) await env.DB.prepare("UPDATE affiliate_edits SET status = ?, apply_id = ?, error = ?, updated_at = ? WHERE id = ?").bind(status, applyId, error, now(), id).run(); };
  if (s.platform === "astro") {
    const p = readPublishProfile(s);
    if (!s.repo || !p) throw new HttpError(409, "Site Astro chưa có hồ sơ đăng bài.", "no_profile");
    const base = await branchSha(env, s.repo, p.branch);
    if (!base) throw new HttpError(502, `Không đọc được nhánh ${p.branch}.`, "no_branch");
    const branch = `duyoi/affiliate-${Date.now().toString(36)}`;
    await createBranch(env, s.repo, branch, base);
    const done: string[] = [];
    for (const [page, eds] of byPage) {
      const file = await readFile(env, s.repo, page, branch);
      if (!file) { await mark(eds.map((e) => e.id), "failed", null, "Không còn file này trong repo."); failed += eds.length; continue; }
      const r = applyToMarkdown(file.text, eds);
      if (r.text === file.text) { await mark(eds.map((e) => e.id), "failed", null, "Không còn khớp nội dung hiện tại."); failed += eds.length; continue; }
      await writeFile(env, s.repo, page, b64Text(r.text), `Link affiliate: ${page.split("/").pop()}`, branch);
      const okIds = eds.filter((e) => !r.failed.some((f) => e.find.startsWith(f))).map((e) => e.id);
      const badIds = eds.filter((e) => !okIds.includes(e.id)).map((e) => e.id);
      done.push(page);
      const a = await env.DB.prepare("INSERT INTO affiliate_applies (site_id, page, platform, status, by, at) VALUES (?, ?, 'astro', 'pr_open', ?, ?) RETURNING id").bind(siteId, page, actor, now()).first<{ id: number }>();
      await mark(okIds, "applied", a!.id, null); await mark(badIds, "failed", a!.id, "Đoạn gốc không còn khớp đúng 1 lần.");
      applied += okIds.length; failed += badIds.length;
    }
    if (done.length) {
      const pr = await openPr(env, s.repo, branch, p.branch, `Link affiliate cho ${done.length} bài`, `Duy Ơi chèn link affiliate (rel="sponsored nofollow") và câu công khai nếu thiếu. Đã qua Gác cổng và được duyệt trong app.\n\n${done.map((d) => `- \`${d}\``).join("\n")}`);
      prs.push(pr.html_url);
      await env.DB.prepare(`UPDATE affiliate_applies SET pr = ? WHERE site_id = ? AND status = 'pr_open' AND pr IS NULL`).bind(JSON.stringify({ number: pr.number, url: pr.html_url, branch }), siteId).run();
    }
  } else {
    for (const [page, eds] of byPage) {
      try {
        const post = await wpGetPost(env, siteId, page);
        const edits: WpEdit[] = eds.map((e) => e.kind === "button" ? { find: e.find, insert: e.replace, mode: "after_block" } : e.kind === "disclosure" ? { find: e.find, insert: e.replace, mode: "before_block" } : e.kind === "replace_url" ? { find: e.find, replace: e.replace, mode: "swap_url" } : { find: e.find, replace: e.replace, mode: "wrap_link" });
        await wpApply(env, siteId, { id: post.id, expected_modified: post.modified_gmt, edits, meta: {}, dry_run: true });
        const a = await env.DB.prepare("INSERT INTO affiliate_applies (site_id, page, platform, backup, status, by, at) VALUES (?, ?, 'wordpress', ?, 'applied', ?, ?) RETURNING id")
          .bind(siteId, page, JSON.stringify({ id: post.id, content: post.content, elementor_data: post.elementor_data, modified: post.modified_gmt }), actor, now()).first<{ id: number }>();
        await wpApply(env, siteId, { id: post.id, expected_modified: post.modified_gmt, edits, meta: {} });
        await mark(eds.map((e) => e.id), "applied", a!.id, null);
        applied += eds.length;
        await pingChanged(env, siteId, page, "chèn link affiliate");
      } catch (e) {
        await mark(eds.map((x) => x.id), "failed", null, (e as Error).message.slice(0, 300));
        failed += eds.length;
      }
    }
  }
  await logActivity(env, actor, "affiliate.apply", `Chèn link affiliate: ${applied} sửa trên ${byPage.size} trang${failed ? `, ${failed} không khớp` : ""}${prs.length ? ` (pull request ${prs.join(", ")})` : ""}`, siteId);
  return { pages: byPage.size, applied, failed, prs };
}
export async function apiApply(env: Env, req: Request, user: User, siteId: number): Promise<Response> {
  canEdit(user);
  const b = await readJson<{ confirmBulk?: boolean }>(req).catch(() => ({} as { confirmBulk?: boolean }));
  return json(await applyCore(env, siteId, b.confirmBulk === true, `user:${user.id}`));
}

// POST /api/sites/:id/affiliate/applies/:applyId/rollback — WordPress: trả lại nội dung trước khi chèn
export async function apiRollback(env: Env, user: User, siteId: number, applyId: number): Promise<Response> {
  canEdit(user);
  const a = await env.DB.prepare("SELECT * FROM affiliate_applies WHERE id = ? AND site_id = ?").bind(applyId, siteId).first<{ platform: string; backup: string | null; status: string; page: string }>();
  if (!a || a.platform !== "wordpress" || a.status !== "applied" || !a.backup) throw new HttpError(409, "Không hoàn tác được lần này (Astro: đóng pull request trên GitHub).", "no_backup");
  const b = JSON.parse(a.backup) as { id: number; content: string | null; elementor_data: string | null };
  await wpRestore(env, siteId, { id: b.id, content: b.elementor_data ? null : b.content, elementor_data: b.elementor_data, meta: {} });
  await env.DB.batch([
    env.DB.prepare("UPDATE affiliate_applies SET status = 'restored' WHERE id = ?").bind(applyId),
    env.DB.prepare("UPDATE affiliate_edits SET status = 'proposed', apply_id = NULL, updated_at = ? WHERE apply_id = ?").bind(now(), applyId)
  ]);
  await logActivity(env, `user:${user.id}`, "affiliate.rollback", `Hoàn tác link affiliate trên ${a.page}`, siteId);
  return json({ ok: true });
}
