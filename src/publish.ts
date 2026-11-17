// Đăng bài lên site Astro qua GitHub. Mỗi theme khác nhau nên mỗi site có "hồ sơ đăng bài" tự đọc từ repo:
// thư mục bài, frontmatter (tên trường, kiểu, bắt buộc), md hay mdx, cách đặt tên file, chỗ để ảnh, component nút mua.
// Bài viết một lần (HTML chung có token) → lúc đăng mới "mặc áo" theo hồ sơ → nhánh mới + pull request (draft) →
// Cloudflare Workers Builds build thử theme thật → app đọc kết quả, tự sửa lỗi frontmatter nếu được → anh merge.

import { logActivity } from "./activity";
import { b64Bytes, b64Text, branchSha, buildState, createBranch, openPr, prState, readFile, repoInfo, tree, writeFile, type BuildState } from "./github";
import { HttpError, json, now, readJson } from "./http";
import type { Env, User } from "./types";

export interface Field { name: string; type: "string" | "date" | "image" | "array" | "boolean" | "number" | "enum" | "reference" | "object"; required: boolean; enumValues?: string[]; example?: string }
export interface PublishProfile {
  repo: string; branch: string; collection: string; dir: string; ext: "md" | "mdx"; naming: "file" | "folder-index" | "date-prefix";
  fields: Field[]; map: Record<string, string>; values: Record<string, string>;
  dateStyle: "date" | "iso"; imageMode: "assets" | "public" | "url"; imageDir: string;
  components: { name: string; import: string; example: string }[]; buyTemplate: string; buyImport: string; authorName: string;
  sample: string; warnings: string[]; detectedAt: number;
}

// ---------------- Đọc content config của Astro ----------------

function block(src: string, from: number, open = "(", close = ")"): string {
  let depth = 0;
  for (let i = from; i < src.length; i++) {
    const ch = src[i];
    if (ch === open) depth++;
    else if (ch === close) { depth--; if (depth === 0) return src.slice(from + 1, i); }
  }
  return src.slice(from + 1);
}
function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0, cur = "", q = "";
  for (const ch of s) {
    if (q) { cur += ch; if (ch === q) q = ""; continue; }
    if (ch === "'" || ch === "\"" || ch === "`") { q = ch; cur += ch; continue; }
    if ("({[".includes(ch)) depth++;
    if (")}]".includes(ch)) depth--;
    if (ch === "," && depth === 0) { out.push(cur); cur = ""; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}
function fieldOf(entry: string): Field | null {
  const m = entry.trim().match(/^["']?([A-Za-z_$][\w$]*)["']?\s*:\s*([\s\S]+)$/);
  if (!m) return null;
  const expr = m[2]!.replace(/\s+/g, " ");
  const type: Field["type"] = /\bimage\(\)/.test(expr) ? "image" : /z\.(coerce\.)?date\(/.test(expr) ? "date" : /z\.array\(/.test(expr) ? "array" : /z\.boolean\(/.test(expr) ? "boolean"
    : /z\.(coerce\.)?number\(/.test(expr) ? "number" : /z\.enum\(/.test(expr) ? "enum" : /reference\(/.test(expr) ? "reference" : /z\.object\(/.test(expr) ? "object" : "string";
  const enumValues = type === "enum" ? [...(expr.match(/z\.enum\(\s*\[([^\]]*)\]/)?.[1] || "").matchAll(/["']([^"']+)["']/g)].map((x) => x[1]!) : undefined;
  return { name: m[1]!, type, required: !/\.optional\(\)|\.default\(|\.nullish\(\)|\.nullable\(\)/.test(expr), ...(enumValues ? { enumValues } : {}) };
}

export function parseContentConfig(src: string): { name: string; dir: string; fields: Field[] }[] {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const out: { name: string; dir: string; fields: Field[] }[] = [];
  const re = /(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*defineCollection\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    const body = block(code, m.index + m[0].length - 1);
    const base = body.match(/base\s*:\s*["'`]([^"'`]+)["'`]/)?.[1];
    const dir = (base ? base : `src/content/${m[1]}`).replace(/^\.\//, "").replace(/\/$/, "");
    const zi = body.indexOf("z.object(");
    const fields = zi >= 0 ? splitTop(block(body, zi + "z.object".length).replace(/^\s*\{|\}\s*$/g, "")).map(fieldOf).filter((f): f is Field => !!f) : [];
    out.push({ name: m[1]!, dir, fields });
  }
  return out;
}

// Frontmatter YAML đơn giản (đủ cho bài mẫu)
export function parseFrontmatter(text: string): { data: Record<string, string | string[]>; body: string } {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { data: {}, body: text };
  const data: Record<string, string | string[]> = {};
  let last = "";
  for (const line of m[1]!.split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (kv) {
      last = kv[1]!;
      const v = kv[2]!.trim();
      if (v.startsWith("[")) data[last] = v.replace(/^\[|\]$/g, "").split(",").map((x) => x.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
      else data[last] = v.replace(/^["']|["']$/g, "");
      continue;
    }
    const li = line.match(/^\s+-\s+(.*)$/);
    if (li && last) { const prev = data[last]; data[last] = [...(Array.isArray(prev) ? prev : prev ? [] : []), li[1]!.trim().replace(/^["']|["']$/g, "")]; }
  }
  return { data, body: m[2]! };
}

const NAMES: Record<string, string[]> = {
  title: ["title", "name", "heading"],
  description: ["description", "excerpt", "summary", "metaDescription", "seoDescription", "subtitle"],
  date: ["pubDate", "date", "publishDate", "published", "pubDatetime", "publishedAt", "createdAt"],
  updated: ["updatedDate", "modDatetime", "updated", "lastModified", "updatedAt"],
  image: ["heroImage", "image", "cover", "coverImage", "featuredImage", "thumbnail", "ogImage", "hero"],
  imageAlt: ["heroImageAlt", "imageAlt", "coverAlt", "alt", "heroAlt"],
  tags: ["tags", "categories", "keywords"],
  author: ["author", "authors"],
  draft: ["draft", "isDraft"]
};

const posix = { dirname: (p: string) => p.split("/").slice(0, -1).join("/"), join: (...p: string[]) => p.join("/").replace(/\/+/g, "/") };
function resolveRel(fromDir: string, rel: string): string {
  const parts = fromDir.split("/").filter(Boolean);
  for (const seg of rel.split("/")) { if (seg === "..") parts.pop(); else if (seg !== ".") parts.push(seg); }
  return parts.join("/");
}
function relPath(fromDir: string, to: string): string {
  const a = fromDir.split("/").filter(Boolean), b = to.split("/").filter(Boolean);
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const up = a.slice(i).map(() => "..");
  return [...(up.length ? up : ["."]), ...b.slice(i)].join("/");
}

export async function detectProfile(env: Env, repo: string, prev: PublishProfile | null): Promise<PublishProfile> {
  const info = await repoInfo(env, repo);
  const branch = info.default_branch;
  const files = await tree(env, repo, branch);
  const warnings: string[] = [];
  const cfgPath = ["src/content.config.ts", "src/content.config.mts", "src/content.config.js", "src/content/config.ts", "src/content/config.mts", "src/content/config.js"].find((p) => files.includes(p));
  let cols: { name: string; dir: string; fields: Field[] }[] = [];
  if (cfgPath) cols = parseContentConfig((await readFile(env, repo, cfgPath, branch))?.text || "");
  else warnings.push("Không thấy file content config của Astro: đoán thư mục bài từ cấu trúc repo.");
  const isPost = (p: string) => /\.(md|mdx)$/i.test(p) && !/(^|\/)(README|CHANGELOG|LICENSE)/i.test(p) && !p.startsWith("node_modules/");
  if (!cols.length) {
    const dirs = new Map<string, number>();
    files.filter(isPost).filter((p) => /^src\/(content|pages)\//.test(p)).forEach((p) => { const d = posix.dirname(p.replace(/\/[^/]+\/index\.mdx?$/i, "/x.md")); dirs.set(d, (dirs.get(d) || 0) + 1); });
    cols = [...dirs.entries()].sort((a, b) => b[1] - a[1]).map(([dir]) => ({ name: dir.split("/").pop() || "blog", dir, fields: [] }));
  }
  const count = (d: string) => files.filter((p) => p.startsWith(`${d}/`) && isPost(p)).length;
  const col = cols.find((c) => /blog|post|article|news|ratgeber|magazin|guide|review/i.test(c.name) && count(c.dir) > 0) || [...cols].sort((a, b) => count(b.dir) - count(a.dir))[0];
  if (!col) throw new HttpError(409, "Không tìm thấy thư mục bài viết trong repo (src/content/…).", "no_collection");
  const posts = files.filter((p) => p.startsWith(`${col.dir}/`) && isPost(p)).sort().reverse();
  const samplePath = posts[0] || "";
  const sample = samplePath ? (await readFile(env, repo, samplePath, branch))?.text || "" : "";
  const fm = parseFrontmatter(sample);
  if (!samplePath) warnings.push("Thư mục bài chưa có bài nào để làm mẫu: kiểm tra kỹ phần frontmatter.");
  // Trường: lấy từ schema; không có schema thì từ bài mẫu
  let fields: Field[] = col.fields.length ? col.fields : Object.keys(fm.data).map((k) => ({ name: k, type: Array.isArray(fm.data[k]) ? "array" : /^\d{4}-\d{2}-\d{2}/.test(String(fm.data[k])) ? "date" : /^(true|false)$/.test(String(fm.data[k])) ? "boolean" : "string", required: true } as Field));
  fields = fields.map((f) => ({ ...f, ...(fm.data[f.name] !== undefined ? { example: Array.isArray(fm.data[f.name]) ? (fm.data[f.name] as string[]).join(", ") : String(fm.data[f.name]).slice(0, 200) } : {}) }));
  const map: Record<string, string> = {};
  for (const [k, names] of Object.entries(NAMES)) { const f = names.map((n) => fields.find((x) => x.name === n)).find(Boolean); if (f) map[k] = f.name; }
  const ext = samplePath.endsWith(".mdx") ? "mdx" : posts.some((p) => p.endsWith(".mdx")) && !posts.some((p) => p.endsWith(".md")) ? "mdx" : "md";
  const naming = /\/index\.mdx?$/i.test(samplePath) ? "folder-index" : /\/\d{4}-\d{2}-\d{2}-[^/]+$/.test(samplePath) ? "date-prefix" : "file";
  const dateEx = map.date ? String(fm.data[map.date] || "") : "";
  const imgField = fields.find((f) => f.name === map.image);
  const imgEx = map.image ? String(fm.data[map.image] || "") : "";
  let imageMode: PublishProfile["imageMode"] = imgField?.type === "image" ? "assets" : /^https?:/.test(imgEx) ? "url" : imgEx.startsWith("/") ? "public" : imgField ? "url" : "url";
  let imageDir = "src/assets/blog";
  if (imageMode === "assets" && imgEx && !/^https?:|^\//.test(imgEx)) imageDir = posix.dirname(resolveRel(posix.dirname(samplePath), imgEx)) || imageDir;
  if (imgEx.startsWith("/")) { imageMode = "public"; imageDir = `public${posix.dirname(imgEx)}`; }
  const components = [...sample.matchAll(/^import\s+([A-Z][\w]*)\s+from\s+["']([^"']+)["'];?\s*$/gm)].map((m) => {
    const ex = sample.match(new RegExp(`<${m[1]}\\b[^>]*?(?:/>|>[\\s\\S]*?</${m[1]}>)`))?.[0] || "";
    return { name: m[1]!, import: m[0].trim(), example: ex.slice(0, 300) };
  });
  const buy = components.find((c) => /affiliate|buy|button|cta|product|deal|shop/i.test(c.name) && c.example);
  const buyTemplate = prev?.buyTemplate || (buy ? buy.example.replace(/href=["'][^"']*["']/, "href=\"{url}\"").replace(/(label|text|title)=["'][^"']*["']/, "$1=\"{label}\"").replace(/>([^<>]+)</, ">{label}<") : "");
  // Import của component dùng đường dẫn tương đối tính từ bài mẫu: đổi sang đường dẫn từ bài mới (cùng thư mục, trừ kiểu thư mục/index)
  const buyImport = prev?.buyImport || (buy ? buy.import : "");
  return {
    repo, branch, collection: col.name, dir: prev?.dir || col.dir, ext: prev?.ext || ext, naming: prev?.naming || naming,
    fields, map: { ...map, ...(prev?.map || {}) }, values: prev?.values || {},
    dateStyle: /T\d{2}:/.test(dateEx) ? "iso" : "date", imageMode: prev?.imageMode || imageMode, imageDir: prev?.imageDir || imageDir,
    components, buyTemplate, buyImport, authorName: prev?.authorName || "",
    sample: samplePath, warnings, detectedAt: now()
  };
}

// ---------------- HTML chung → Markdown/MDX theo hồ sơ ----------------

const dec = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/&amp;/g, "&");
function inlineMd(h: string, mdx: boolean): string {
  let s = h
    .replace(/<strong>([\s\S]*?)<\/strong>/g, "**$1**").replace(/<em>([\s\S]*?)<\/em>/g, "*$1*")
    .replace(/<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g, (_m, u: string, t: string) => `[${t.replace(/<[^>]+>/g, "")}](${dec(u)})`)
    .replace(/<br\s*\/?>/g, "  \n").replace(/<[^>]+>/g, "");
  s = dec(s);
  if (mdx) s = s.replace(/[{}]/g, (c) => `\\${c}`).replace(/<(?=[A-Za-z!/])/g, "&lt;");
  return s.trim();
}
const attr = (tag: string, name: string) => dec((tag.match(new RegExp(`${name}="([^"]*)"`)) || [])[1] || "");

export function htmlToMarkdown(html: string, o: { mdx: boolean; buyTemplate: string }): string {
  const out: string[] = [];
  const re = /<(h2|h3|p|ul|ol|table|figure)\b([^>]*)>([\s\S]*?)<\/\1>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const [, tag, attrs, inner] = m as unknown as [string, string, string, string];
    if (tag === "h2") out.push(`## ${inlineMd(inner, o.mdx)}`);
    else if (tag === "h3") out.push(`### ${inlineMd(inner, o.mdx)}`);
    else if (tag === "p" && /class="buy-buttons"/.test(attrs)) {
      const links = [...inner.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map((a) => ({ url: attr(a[1]!, "href"), label: dec(a[2]!.replace(/<[^>]+>/g, "")) }));
      out.push(links.map((l) => o.buyTemplate ? o.buyTemplate.replace(/\{url\}/g, l.url.replace(/"/g, "%22")).replace(/\{label\}/g, l.label.replace(/[<>{}"]/g, "")) : `<a href="${l.url.replace(/"/g, "%22")}" rel="sponsored nofollow noopener" target="_blank">${l.label.replace(/[<>{}]/g, "")}</a>`).join("\n"));
    } else if (tag === "p" && /class="affiliate-disclosure"/.test(attrs)) out.push(`<p class="affiliate-disclosure"><em>${inlineMd(inner, o.mdx).replace(/^\*|\*$/g, "")}</em></p>`);
    else if (tag === "p") { const t = inlineMd(inner, o.mdx); if (t) out.push(t); }
    else if (tag === "ul" || tag === "ol") out.push([...inner.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((li, n) => `${tag === "ol" ? `${n + 1}.` : "-"} ${inlineMd(li[1]!, o.mdx)}`).join("\n"));
    else if (tag === "table") {
      const rows = [...inner.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map((r) => [...r[1]!.matchAll(/<t[hd]>([\s\S]*?)<\/t[hd]>/g)].map((c) => inlineMd(c[1]!, o.mdx).replace(/\|/g, "\\|")));
      if (rows.length) out.push([`| ${rows[0]!.join(" | ")} |`, `| ${rows[0]!.map(() => "---").join(" | ")} |`, ...rows.slice(1).map((r) => `| ${r.join(" | ")} |`)].join("\n"));
    } else if (tag === "figure") {
      const img = inner.match(/<img\b[^>]*>/)?.[0] || "";
      const cap = inner.match(/<figcaption>([\s\S]*?)<\/figcaption>/)?.[1] || "";
      if (img) out.push(`![${attr(img, "alt").replace(/[[\]]/g, "")}](${attr(img, "src")})${cap ? `\n*${inlineMd(cap, o.mdx)}*` : ""}`);
    }
  }
  return out.join("\n\n") + "\n";
}

const yamlVal = (f: Field, v: unknown): string => {
  if (f.type === "boolean") return v === true || v === "true" ? "true" : "false";
  if (f.type === "number") return String(Number(v) || 0);
  if (f.type === "date") return String(v);
  if (f.type === "array") return `[${(Array.isArray(v) ? v : String(v).split(",")).map((x) => JSON.stringify(String(x).trim())).filter((x) => x !== "\"\"").join(", ")}]`;
  return JSON.stringify(String(v));
};

export interface PostInput { title: string; description: string; slug: string; html: string; keyword: string; hero: { url: string; alt: string } | null }
export interface BuiltPost { path: string; content: string; missing: string[]; image: { url: string; path: string } | null }

export function buildPost(p: PublishProfile, post: PostInput, today = new Date()): BuiltPost {
  const day = today.toISOString().slice(0, 10);
  const slug = post.slug || post.keyword.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const path = p.naming === "folder-index" ? `${p.dir}/${slug}/index.${p.ext}` : p.naming === "date-prefix" ? `${p.dir}/${day}-${slug}.${p.ext}` : `${p.dir}/${slug}.${p.ext}`;
  let image: BuiltPost["image"] = null;
  let imageValue = "";
  if (post.hero) {
    if (p.imageMode === "url") imageValue = post.hero.url;
    else {
      const extn = (post.hero.url.match(/\.(jpe?g|png|webp)(?:$|\?)/i)?.[1] || "jpg").toLowerCase();
      const file = `${p.imageDir}/${slug}-hero.${extn}`;
      image = { url: post.hero.url, path: file };
      imageValue = p.imageMode === "public" ? `/${file.replace(/^public\//, "")}` : relPath(posix.dirname(path), file);
    }
  }
  const auto: Record<string, unknown> = {
    [p.map.title || "title"]: post.title, [p.map.description || "description"]: post.description,
    ...(p.map.date ? { [p.map.date]: p.dateStyle === "iso" ? today.toISOString() : day } : {}),
    ...(p.map.image && imageValue ? { [p.map.image]: imageValue } : {}),
    ...(p.map.imageAlt && post.hero ? { [p.map.imageAlt]: post.hero.alt } : {}),
    ...(p.map.author && p.authorName ? { [p.map.author]: p.authorName } : {}),
    ...(p.map.draft ? { [p.map.draft]: true } : {}),
    ...(p.map.tags ? { [p.map.tags]: [] } : {})
  };
  const missing: string[] = [];
  const lines: string[] = [];
  const fields = p.fields.length ? p.fields : [{ name: "title", type: "string", required: true }, { name: "description", type: "string", required: true }] as Field[];
  for (const f of fields) {
    const v = p.values[f.name] !== undefined && p.values[f.name] !== "" ? p.values[f.name] : auto[f.name];
    if (v === undefined || v === "" || (Array.isArray(v) && !v.length && f.required)) {
      if (f.required && !(f.type === "array" && Array.isArray(v))) missing.push(f.enumValues?.length ? `${f.name} (phải là: ${f.enumValues.join(", ")})` : f.name);
      if (Array.isArray(v) && f.type === "array") lines.push(`${f.name}: []`);
      continue;
    }
    if (f.type === "enum" && f.enumValues?.length && !f.enumValues.includes(String(v))) { missing.push(`${f.name} (phải là: ${f.enumValues.join(", ")})`); continue; }
    lines.push(`${f.name}: ${yamlVal(f, v)}`);
  }
  const mdx = p.ext === "mdx";
  const body = htmlToMarkdown(post.html, { mdx, buyTemplate: mdx ? p.buyTemplate : "" });
  const imports = mdx && p.buyTemplate && p.buyImport && /\{url\}/.test(p.buyTemplate) && body.includes(p.buyTemplate.split(/\s/)[0]!) ? `${fixImport(p.buyImport, p.sample, path)}\n\n` : "";
  return { path, content: `---\n${lines.join("\n")}\n---\n\n${imports}${body}`, missing, image };
}

// Import tương đối lấy từ bài mẫu: tính lại theo vị trí bài mới
function fixImport(imp: string, samplePath: string, newPath: string): string {
  const m = imp.match(/from\s+["'](\.{1,2}\/[^"']+)["']/);
  if (!m || !samplePath) return imp;
  const abs = resolveRel(posix.dirname(samplePath), m[1]!);
  return imp.replace(m[1]!, relPath(posix.dirname(newPath), abs).replace(/^(?!\.)/, "./"));
}

// ---------------- API ----------------

const canEdit = (u: User) => { if (u.role === "viewer") throw new HttpError(403, "Tài khoản chỉ xem.", "forbidden"); };
interface SiteRow { id: number; domain: string; platform: string; repo: string | null; publish_profile: string | null }
async function siteRow(env: Env, id: number): Promise<SiteRow> {
  const s = await env.DB.prepare("SELECT id, domain, platform, repo, publish_profile FROM sites WHERE id = ?").bind(id).first<SiteRow>();
  if (!s) throw new HttpError(404, "Không tìm thấy site.", "not_found");
  return s;
}
export const readPublishProfile = (s: { publish_profile: string | null }): PublishProfile | null => { try { return s.publish_profile ? JSON.parse(s.publish_profile) : null; } catch { return null; } };

// POST /api/sites/:id/publish/detect
export async function apiDetectProfile(env: Env, user: User, id: number): Promise<Response> {
  canEdit(user);
  const s = await siteRow(env, id);
  if (!s.repo) throw new HttpError(400, "Site chưa có repo GitHub (Site › sửa site › Repo GitHub).", "no_repo");
  const p = await detectProfile(env, s.repo, readPublishProfile(s));
  await env.DB.prepare("UPDATE sites SET publish_profile = ?, updated_at = ? WHERE id = ?").bind(JSON.stringify(p), now(), id).run();
  await logActivity(env, `user:${user.id}`, "publish.detect", `Đọc repo ${s.repo}: bài ở ${p.dir} (.${p.ext}), ${p.fields.length} trường frontmatter`, id);
  return json({ ok: true, profile: p });
}

// GET /api/sites/:id/publish
export async function apiGetProfile(env: Env, id: number): Promise<Response> {
  const s = await siteRow(env, id);
  return json({ repo: s.repo, platform: s.platform, profile: readPublishProfile(s) });
}

// PUT /api/sites/:id/publish — anh sửa hồ sơ (giá trị cố định cho trường, tác giả, mẫu nút mua…)
export async function apiSaveProfile(env: Env, req: Request, user: User, id: number): Promise<Response> {
  canEdit(user);
  const s = await siteRow(env, id);
  const cur = readPublishProfile(s);
  if (!cur) throw new HttpError(409, "Bấm Đọc repo trước.", "no_profile");
  const b = await readJson<Partial<PublishProfile>>(req);
  const str = (v: unknown, n: number) => String(v ?? "").slice(0, n);
  const next: PublishProfile = {
    ...cur,
    dir: b.dir ? str(b.dir, 200).replace(/^\.?\/|\/$/g, "") : cur.dir,
    ext: b.ext === "md" || b.ext === "mdx" ? b.ext : cur.ext,
    naming: (["file", "folder-index", "date-prefix"] as const).find((x) => x === b.naming) || cur.naming,
    imageMode: (["assets", "public", "url"] as const).find((x) => x === b.imageMode) || cur.imageMode,
    imageDir: b.imageDir ? str(b.imageDir, 200).replace(/^\.?\/|\/$/g, "") : cur.imageDir,
    authorName: b.authorName !== undefined ? str(b.authorName, 120).trim() : cur.authorName,
    buyTemplate: b.buyTemplate !== undefined ? str(b.buyTemplate, 400) : cur.buyTemplate,
    buyImport: b.buyImport !== undefined ? str(b.buyImport, 300) : cur.buyImport,
    map: b.map && typeof b.map === "object" ? Object.fromEntries(Object.entries(b.map).filter(([k, v]) => k in NAMES && cur.fields.some((f) => f.name === v)).map(([k, v]) => [k, String(v)])) : cur.map,
    values: b.values && typeof b.values === "object" ? Object.fromEntries(Object.entries(b.values).filter(([k]) => cur.fields.some((f) => f.name === k)).map(([k, v]) => [k, str(v, 300)])) : cur.values
  };
  await env.DB.prepare("UPDATE sites SET publish_profile = ?, updated_at = ? WHERE id = ?").bind(JSON.stringify(next), now(), id).run();
  return json({ ok: true, profile: next });
}

// ---------------- Pull request của từng bài ----------------

export interface PrInfo { number: number; url: string; branch: string; path: string; sha: string; state: "open" | "merged" | "closed"; check: BuildState | null; fixes: number; at: number }

// Bài đã qua Gác cổng → nhánh mới, ghi ảnh + bài, mở PR
export async function createPostPr(env: Env, siteId: number, post: PostInput, ideaId: number): Promise<{ pr: PrInfo; built: BuiltPost }> {
  const s = await siteRow(env, siteId);
  const p = readPublishProfile(s);
  if (!s.repo || !p) throw new HttpError(409, "Site chưa có hồ sơ đăng bài: vào Bài mới › Đăng lên GitHub › Đọc repo.", "no_profile");
  if (p.map.author && p.fields.find((f) => f.name === p.map.author)?.required && !p.authorName && !p.values[p.map.author]) throw new HttpError(409, "Theme cần tác giả: điền tên tác giả thật ở hồ sơ đăng bài.", "need_author");
  const built = buildPost(p, post);
  if (built.missing.length) throw new HttpError(409, `Theme cần thêm: ${built.missing.join(", ")}. Điền giá trị ở hồ sơ đăng bài.`, "missing_fields");
  const files = await tree(env, s.repo, p.branch);
  if (files.includes(built.path)) throw new HttpError(409, `Repo đã có file ${built.path}: đổi slug hoặc sửa bài cũ.`, "exists");
  const base = await branchSha(env, s.repo, p.branch);
  if (!base) throw new HttpError(502, `Không đọc được nhánh ${p.branch}.`, "no_branch");
  const branch = `duyoi/${post.slug.slice(0, 50) || "bai"}-${ideaId}-${Date.now().toString(36)}`;
  await createBranch(env, s.repo, branch, base);
  if (built.image) {
    const res = await fetch(built.image.url, { signal: AbortSignal.timeout(20000) }).catch(() => null);
    if (!res?.ok) throw new HttpError(502, "Không tải được ảnh đại diện để đưa vào repo.", "image_fetch");
    await writeFile(env, s.repo, built.image.path, b64Bytes(new Uint8Array(await res.arrayBuffer())), `Ảnh: ${post.title}`, branch);
  }
  const sha = await writeFile(env, s.repo, built.path, b64Text(built.content), `Bài mới (nháp): ${post.title}`, branch);
  const body = [
    `Bài do Duy Ơi chuẩn bị, đã qua Gác cổng và Biên tập viên.`, "",
    `- File: \`${built.path}\``, built.image ? `- Ảnh: \`${built.image.path}\`` : "", p.map.draft ? `- \`${p.map.draft}: true\`: đổi thành false khi muốn hiện bài` : "- Theme không có trường draft: merge là bài lên site", "",
    "Trước khi merge: xem bản build thử, kiểm tra tác giả, ảnh, link mua."
  ].filter((l) => l !== "").join("\n");
  const pr = await openPr(env, s.repo, branch, p.branch, `Bài mới: ${post.title}`, body);
  return { pr: { number: pr.number, url: pr.html_url, branch, path: built.path, sha, state: "open", check: null, fixes: 0, at: now() }, built };
}

// Lỗi schema của Astro thường nêu tên trường: tự sửa frontmatter được thì sửa (tối đa 2 lần)
export function fixFrontmatter(content: string, error: string, p: PublishProfile): { content: string; changed: string[] } {
  const fm = content.match(/^---\n([\s\S]*?)\n---\n/);
  if (!fm) return { content, changed: [] };
  let head = fm[1]!;
  const changed: string[] = [];
  const names = new Set([...error.matchAll(/(?:^|[\s"'`→>*-])([A-Za-z_][\w]*)\*{0,2}\s*:\s*(?:Required|Expected|Invalid)/gm)].map((m) => m[1]!));
  for (const name of names) {
    const f = p.fields.find((x) => x.name === name);
    if (!f) continue;
    const has = new RegExp(`^${name}:`, "m").test(head);
    const fallback = p.values[name] || f.example || (f.type === "date" ? new Date().toISOString().slice(0, 10) : f.type === "boolean" ? "true" : f.type === "array" ? "" : f.enumValues?.[0] || "");
    if (!fallback && f.type !== "array") continue;
    const line = `${name}: ${yamlVal(f, fallback)}`;
    head = has ? head.replace(new RegExp(`^${name}:.*$`, "m"), line) : `${head}\n${line}`;
    changed.push(name);
  }
  return { content: content.replace(fm[0], `---\n${head}\n---\n`), changed };
}

export async function syncPr(env: Env, siteId: number, pr: PrInfo, autoFix = true): Promise<PrInfo & { fixed?: string[]; note?: string }> {
  const s = await siteRow(env, siteId);
  const p = readPublishProfile(s);
  if (!s.repo || !p) return pr;
  const st = await prState(env, s.repo, pr.number);
  if (st.merged) return { ...pr, state: "merged" };
  if (st.state === "closed") return { ...pr, state: "closed" };
  const check = await buildState(env, s.repo, st.head.sha);
  let next: PrInfo & { fixed?: string[]; note?: string } = { ...pr, sha: st.head.sha, check };
  if (autoFix && check.state === "failure" && pr.fixes < 2) {
    const file = await readFile(env, s.repo, pr.path, pr.branch);
    if (file) {
      const f = fixFrontmatter(file.text, check.error, p);
      if (f.changed.length) {
        const sha = await writeFile(env, s.repo, pr.path, b64Text(f.content), `Sửa frontmatter: ${f.changed.join(", ")}`, pr.branch);
        next = { ...next, sha, fixes: pr.fixes + 1, check: { ...check, state: "pending" }, fixed: f.changed };
      } else next.note = "Lỗi build không phải ở frontmatter app sửa được: xem chi tiết build.";
    }
  }
  return next;
}
