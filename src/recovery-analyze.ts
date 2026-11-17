// Bác sĩ SEO: từ dữ liệu quét, tìm nguyên nhân tụt hạng và lập việc cho đội agent.
// Chỉ dùng dữ liệu đọc được từ site (và luật anh nhập). Không bịa số liệu traffic: những gì cần Search Console thì ghi rõ là cần kiểm chứng.

import { updatesNear, type GoogleUpdate } from "./google-updates";
import type { PageData } from "./recovery-extract";
import { checkEdits, type Edit, type GateResult } from "./recovery-gate";
import type { SiteRules } from "./recovery-rules";

export type Kind = "home" | "commercial" | "conversion" | "informational" | "system";

export interface ScannedPage {
  id: number;
  url: string;
  path: string;
  lastmod: string | null;
  status: string;
  http_status: number | null;
  data: PageData | null;
}

export interface SiteChecks {
  https: boolean;
  robotsTxt: string | null;
  robotsBlocksAll: boolean;
  sitemapUrl: string | null;
  homepageStatus: number | null;
  wordpress: boolean;
  elementor: boolean;
}

export interface Finding {
  code: string;
  category: "technical" | "content" | "funnel" | "safety" | "offpage" | "timeline";
  severity: "critical" | "high" | "medium" | "low" | "info";
  title: string;
  detail: string;
  urls: string[];
}

export interface PlannedTask {
  agent: string;
  kind: string;
  title: string;
  detail: string;
  target_url: string | null;
  payload: Record<string, unknown>;
  risk: "safe" | "review" | "irreversible";
  priority: number;
  gate: GateResult | null;
}

// ---------------- Đội agent phục hồi ----------------

export const RECOVERY_AGENTS = [
  { id: "doctor", name: "Bác sĩ SEO", icon: "spark", role: "Quét site, đối chiếu thời điểm tụt với các bản cập nhật Google, chấm điểm sức khoẻ và xếp nguyên nhân." },
  { id: "guardian", name: "Gác cổng", icon: "shield", role: "Kiểm mọi đề xuất trước khi ghi: blocklist pháp lý, dấu biên tập, ngôn ngữ, số liệu không nguồn, sửa phải khớp đúng 1 chỗ, Elementor." },
  { id: "linker", name: "Nối link nội bộ", icon: "link", role: "Chèn link 'phẫu thuật' từ bài thông tin có traffic tới trang dịch vụ: tối đa 3 link mỗi trang, anchor đúng nghĩa, đổi cách viết giữa các trang." },
  { id: "funnel", name: "Phễu CTA", icon: "chart", role: "Thêm lời kêu gọi liên hệ vào bài thông tin chưa có đường dẫn tới trang thương mại." },
  { id: "editor", name: "Biên tập nội dung", icon: "pen", role: "Phân loại KEEP / FUNNEL / MERGE / PRUNE, tìm trang ăn thịt từ khoá nhau, trang mỏng. Gộp/xoá/redirect chỉ là đề xuất cho người quyết." },
  { id: "meta", name: "Meta & Schema", icon: "list", role: "Sửa title, meta description, H1, schema (Rank Math). Đếm ký tự, cho xem diff trước khi lưu." },
  { id: "tech", name: "Kỹ thuật", icon: "gear", role: "robots.txt, sitemap, noindex, canonical, lỗi 4xx/5xx, ngôn ngữ trang. Thay đổi canonical/redirect luôn cần người duyệt." },
  { id: "offpage", name: "Liên kết ngoài", icon: "globe", role: "Gỡ link chéo giữa các site của anh, lập file disavow khi thật sự cần (từng mua link hoặc bị thao tác thủ công)." },
  { id: "geo", name: "GEO (AI search)", icon: "sliders", role: "Đoạn trả lời trực tiếp đầu mỗi mục, bảng so sánh, FAQ cho truy vấn thương mại. Làm sau cùng, khi các luật an toàn đã chạy ổn." }
] as const;

// ---------------- Phân loại trang (chỉ dựa trên path, không dựa trên tên domain) ----------------

const SYSTEM_RE = /^\/(wp-|feed\/|tag\/|tags\/|category\/|kategorie\/|author\/|autor\/|page\/\d|search|cart|checkout|my-account|warenkorb|kasse)|\/(impressum|datenschutz[^/]*|privacy[^/]*|agb|terms[^/]*|cookie[^/]*|legal|disclaimer|sitemap[^/]*|danke|thank-you)\/?$/i;
const CONVERSION_RE = /\/(kontakt|contact|contact-us|angebot-anfordern|anfrage|request-a-quote|get-a-quote|quote)\/?$/i;
const COMMERCIAL_RE = /(dienstleistung|leistungen|outsourcing|services?\b|services?-|pricing|preise|loesung|lösung|solutions?|hire-|agentur|agency|scan-to-bim|bim-|cad-zeichner|offshore)/i;
const INFO_RE = /(-vs-|vergleich|comparison|compare|^\/top-|\/top-\d|best-|beste|was-ist|what-is|how-to|wie-|guide|ratgeber|tipps|tips|symbole|tutorial|\/blog\/|\/news\/|glossar|glossary|\/\d{4}\/\d{2}\/|-erklaert|explained|definition)/i;

export function classify(path: string, data: PageData | null, rules: SiteRules): Kind {
  if (path === "/" || path === "") return "home";
  if (SYSTEM_RE.test(path)) return "system";
  if (rules.commercialPaths.some((p) => path === p || path.startsWith(p))) return "commercial";
  if (CONVERSION_RE.test(path)) return "conversion";
  if (INFO_RE.test(path)) return "informational";
  const article = data?.schemaTypes.some((t) => /Article|BlogPosting|NewsArticle/i.test(t));
  if (COMMERCIAL_RE.test(path) && !article) return "commercial";
  if (rules.commercialPaths.length) return "informational";
  return article ? "informational" : COMMERCIAL_RE.test(path) ? "commercial" : "informational";
}

// ---------------- Tiện ích chữ ----------------

const STOP = new Set(("und der die das für fur mit von zu im in den dem des ein eine einer ist sind wie was the and for with of to a an your our how what why best top vs guide "
  + "cad bim de en com www html php").split(" "));
export const toks = (s: string): string[] =>
  (s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").match(/[a-z0-9äöüß]+/g) || []).filter((w) => w.length > 2 && !STOP.has(w) && !/^\d+$/.test(w));
const slugToks = (path: string): string[] => toks(path.split("/").filter(Boolean).pop() || "");
const overlap = (a: string[], b: string[]): number => {
  const B = new Set(b);
  return [...new Set(a)].filter((w) => B.has(w) || [...B].some((x) => x.length > 5 && w.length > 5 && (x.startsWith(w.slice(0, 6)) || w.startsWith(x.slice(0, 6))))).length;
};
const jaccard = (a: string[], b: string[]): number => {
  const A = new Set(a), B = new Set(b);
  const inter = [...A].filter((x) => B.has(x)).length;
  return inter / (new Set([...A, ...B]).size || 1);
};
const titleCase = (s: string) => s.replace(/\b\p{L}/gu, (c) => c.toUpperCase());
const cutAt = (s: string, max: number): string => {
  if (s.length <= max) return s;
  const cut = s.slice(0, max + 1);
  const i = Math.max(cut.lastIndexOf(" "), cut.lastIndexOf(","));
  return (i > max * 0.6 ? cut.slice(0, i) : s.slice(0, max)).replace(/[\s,;:–-]+$/, "");
};

// ---------------- Phân tích ----------------

export interface Analysis {
  findings: Finding[];
  score: number;
  diagnosis: Record<string, unknown>;
  kinds: Map<number, Kind>;
  inbound: Map<string, number>;
}

const SEV_WEIGHT = { critical: 25, high: 10, medium: 4, low: 1, info: 0 } as const;

export function analyze(pages: ScannedPage[], checks: SiteChecks, rules: SiteRules, dropMonth: string | null): Analysis {
  const findings: Finding[] = [];
  const add = (f: Finding) => findings.push({ ...f, urls: f.urls.slice(0, 200) });
  const ok = pages.filter((p) => p.status === "done" && p.data && (p.http_status ?? 0) < 400);
  const kinds = new Map<number, Kind>();
  for (const p of pages) kinds.set(p.id, classify(p.path, p.data, rules));
  const byKind = (k: Kind) => ok.filter((p) => kinds.get(p.id) === k);
  const content = ok.filter((p) => !["system"].includes(kinds.get(p.id) || ""));
  const info = byKind("informational");
  const commercial = byKind("commercial");
  const commercialPaths = new Set([...commercial.map((p) => p.path), ...rules.commercialPaths]);

  // Link nội bộ trong nội dung trỏ vào từng path
  const inbound = new Map<string, number>();
  for (const p of ok) for (const l of p.data!.internalLinks) if (l !== p.path) inbound.set(l, (inbound.get(l) || 0) + 1);

  // ---- Kỹ thuật ----
  if (checks.robotsBlocksAll) add({ code: "robots_block_all", category: "technical", severity: "critical", title: "robots.txt chặn toàn bộ site", detail: "Có dòng Disallow: / cho mọi bot. Google không thu thập được trang nào.", urls: [] });
  if (!checks.sitemapUrl) add({ code: "no_sitemap", category: "technical", severity: "medium", title: "Không tìm thấy sitemap XML", detail: "Không có sitemap trong robots.txt, /sitemap_index.xml, /sitemap.xml hay /wp-sitemap.xml. App đã quét theo link từ trang chủ.", urls: [] });
  if (!checks.https) add({ code: "no_https", category: "technical", severity: "high", title: "Site không chạy HTTPS", detail: "Trang chủ không chuyển về https.", urls: [] });
  const errors = pages.filter((p) => (p.http_status ?? 0) >= 400 || p.status === "error");
  if (errors.length) add({ code: "http_errors", category: "technical", severity: errors.length > 5 ? "high" : "medium", title: `${errors.length} URL trong sitemap bị lỗi hoặc không truy cập được`, detail: "Sitemap chỉ nên chứa trang trả về 200. Sửa link hỏng hoặc bỏ khỏi sitemap.", urls: errors.map((p) => p.url) });
  const noindex = content.filter((p) => /noindex/.test(p.data!.robots) && kinds.get(p.id) !== "system");
  if (noindex.length) add({ code: "noindex", category: "technical", severity: noindex.some((p) => kinds.get(p.id) === "commercial" || kinds.get(p.id) === "home") ? "critical" : "high", title: `${noindex.length} trang có noindex nhưng nằm trong sitemap`, detail: "Trang noindex sẽ không xuất hiện trên Google. Kiểm tra trong Rank Math xem có cố ý không.", urls: noindex.map((p) => p.url) });
  const canonOther = content.filter((p) => { const c = p.data!.canonical; if (!c) return false; try { const u = new URL(c); return u.pathname !== new URL(p.url).pathname; } catch { return false; } });
  if (canonOther.length) add({ code: "canonical_elsewhere", category: "technical", severity: "medium", title: `${canonOther.length} trang có canonical trỏ sang URL khác`, detail: "Google sẽ coi trang khác là bản chính. Đổi canonical là việc khó đảo ngược: chỉ đổi sau khi người duyệt quyết.", urls: canonOther.map((p) => `${p.url} → ${p.data!.canonical}`) });
  const noCanon = content.filter((p) => !p.data!.canonical);
  if (noCanon.length > 3) add({ code: "no_canonical", category: "technical", severity: "low", title: `${noCanon.length} trang không có thẻ canonical`, detail: "Rank Math thường tự thêm canonical; kiểm tra cấu hình.", urls: noCanon.map((p) => p.url) });
  const langMismatch = content.filter((p) => p.data!.lang && p.data!.lang !== rules.language);
  if (langMismatch.length) add({ code: "lang_attr", category: "technical", severity: "medium", title: `${langMismatch.length} trang khai báo ngôn ngữ khác "${rules.language}"`, detail: "Thuộc tính lang của thẻ <html> không khớp ngôn ngữ của site.", urls: langMismatch.map((p) => `${p.url} (lang=${p.data!.lang})`) });
  const h1Bad = content.filter((p) => p.data!.h1.length !== 1);
  if (h1Bad.length) add({ code: "h1", category: "technical", severity: "low", title: `${h1Bad.length} trang không có đúng một H1`, detail: "Mỗi trang nên có đúng một H1 nêu rõ chủ đề.", urls: h1Bad.map((p) => `${p.url} (${p.data!.h1.length} H1)`) });

  // ---- Meta ----
  const noTitle = content.filter((p) => !p.data!.title);
  const longTitle = content.filter((p) => p.data!.title.length > 60);
  const noDesc = content.filter((p) => !p.data!.metaDescription);
  const longDesc = content.filter((p) => p.data!.metaDescription.length > 155);
  if (noTitle.length) add({ code: "no_title", category: "technical", severity: "high", title: `${noTitle.length} trang thiếu title`, detail: "", urls: noTitle.map((p) => p.url) });
  if (noDesc.length) add({ code: "no_meta_desc", category: "technical", severity: "medium", title: `${noDesc.length} trang thiếu meta description`, detail: "Meta description nên ≤ 155 ký tự và có lời kêu gọi hành động.", urls: noDesc.map((p) => p.url) });
  if (longTitle.length) add({ code: "long_title", category: "technical", severity: "low", title: `${longTitle.length} title dài quá 60 ký tự`, detail: "", urls: longTitle.map((p) => `${p.url} (${p.data!.title.length})`) });
  if (longDesc.length) add({ code: "long_desc", category: "technical", severity: "low", title: `${longDesc.length} meta description dài quá 155 ký tự`, detail: "", urls: longDesc.map((p) => `${p.url} (${p.data!.metaDescription.length})`) });
  const titleMap = new Map<string, ScannedPage[]>();
  for (const p of content) if (p.data!.title) titleMap.set(p.data!.title.toLowerCase(), [...(titleMap.get(p.data!.title.toLowerCase()) || []), p]);
  const dupTitles = [...titleMap.values()].filter((g) => g.length > 1);
  if (dupTitles.length) add({ code: "dup_title", category: "content", severity: "medium", title: `${dupTitles.length} nhóm trang trùng title`, detail: "Trùng title làm Google khó chọn trang nào xếp hạng.", urls: dupTitles.flat().map((p) => `${p.url} — ${p.data!.title}`) });

  // ---- Nội dung ----
  const thin = content.filter((p) => ["informational", "commercial"].includes(kinds.get(p.id) || "") && p.data!.words < 300);
  if (thin.length) add({ code: "thin", category: "content", severity: thin.length >= 10 || thin.length / Math.max(1, content.length) > 0.25 ? "high" : "medium", title: `${thin.length} trang nội dung mỏng (dưới 300 từ)`, detail: "Ứng viên gộp (MERGE) hoặc gỡ (PRUNE) nếu không có traffic. Kiểm tra traffic trong Search Console trước khi quyết.", urls: thin.map((p) => `${p.url} (${p.data!.words} từ)`) });
  // Dấu hiệu nội dung hàng loạt: nhiều bài thông tin so với trang dịch vụ, đăng dồn trong thời gian ngắn
  const dated = info.map((p) => Date.parse(p.lastmod || "")).filter(Number.isFinite).sort((a, b) => a - b);
  let burst = 0;
  for (let i = 0, j = 0; i < dated.length; i++) { while (dated[i]! - dated[j]! > 90 * 86400000) j++; burst = Math.max(burst, i - j + 1); }
  const ratio = info.length / Math.max(1, commercial.length);
  if (info.length >= 20 && (ratio >= 4 || burst >= Math.max(20, info.length * 0.4))) {
    add({ code: "scaled_content", category: "content", severity: "high", title: "Dấu hiệu nội dung hàng loạt (scaled content)", detail: `${info.length} bài thông tin so với ${commercial.length} trang dịch vụ (tỉ lệ ${ratio.toFixed(1)}:1)${burst ? `; ${burst} bài cập nhật trong cùng 90 ngày` : ""}. Google coi việc tạo nhiều trang chủ yếu để kéo traffic là "scaled content abuse"; cập nhật spam tháng 8/2025 và 9/2026 nhắm vào kiểu này. Cách xử lý: giữ bài có traffic, gắn vào phễu; gộp bài trùng chủ đề; gỡ bài mỏng không ai đọc.`, urls: info.map((p) => p.url) });
  }
  // Ăn thịt từ khoá: các path có tập từ gần giống nhau
  const cand = content.filter((p) => kinds.get(p.id) !== "home" && slugToks(p.path).length >= 2);
  const parent = new Map<number, number>();
  const find = (x: number): number => { while (parent.get(x) !== undefined && parent.get(x) !== x) x = parent.get(x)!; return x; };
  for (const p of cand) parent.set(p.id, p.id);
  for (let i = 0; i < cand.length; i++) for (let j = i + 1; j < cand.length; j++) {
    const pi = cand[i]!, pj = cand[j]!;
    const a = slugToks(pi.path), b = slugToks(pj.path);
    const ta = toks(pi.data!.h1[0] || pi.data!.title), tb = toks(pj.data!.h1[0] || pj.data!.title);
    if (jaccard(a, b) >= 0.6 || (ta.length >= 2 && jaccard(ta, tb) >= 0.75)) parent.set(find(pi.id), find(pj.id));
  }
  const groups = new Map<number, ScannedPage[]>();
  for (const p of cand) { const r = find(p.id); groups.set(r, [...(groups.get(r) || []), p]); }
  const cannibal = [...groups.values()].filter((g) => g.length >= 2).sort((a, b) => b.length - a.length).slice(0, 25);
  if (cannibal.length) add({ code: "cannibalisation", category: "content", severity: cannibal.some((g) => g.length >= 3 || g.some((p) => kinds.get(p.id) === "commercial")) ? "high" : "medium", title: `${cannibal.length} nhóm trang có thể ăn thịt từ khoá nhau`, detail: "Nhiều URL nhắm cùng một từ khoá làm Google phân vân. Chọn một trang mạnh nhất làm trang chính, củng cố nó TRƯỚC khi gộp/redirect các trang còn lại.", urls: cannibal.map((g) => g.map((p) => p.path).join("  |  ")) });

  // ---- Phễu & link nội bộ ----
  const orphans = commercial.filter((p) => (inbound.get(p.path) || 0) < 3);
  if (orphans.length) add({ code: "orphan_commercial", category: "funnel", severity: "high", title: `${orphans.length} trang dịch vụ có ít hơn 3 link nội bộ trỏ về`, detail: "Link trong menu không tính (giống nhau trên mọi trang, ít trọng số). Trang dịch vụ cần link ngữ cảnh từ bài viết liên quan.", urls: orphans.map((p) => `${p.url} (${inbound.get(p.path) || 0} link)`) });
  const deadEnd = info.filter((p) => !p.data!.internalLinks.some((l) => commercialPaths.has(l) || [...commercialPaths].some((c) => l.startsWith(c))));
  if (deadEnd.length) add({ code: "dead_end", category: "funnel", severity: "high", title: `${deadEnd.length} bài thông tin không dẫn tới trang dịch vụ nào`, detail: "Người đọc vào bài rồi rời đi, không có đường tới trang tạo lead. Đây là việc nhanh nhất để có lead: thêm link ngữ cảnh và CTA.", urls: deadEnd.map((p) => p.url) });
  const noCta = info.filter((p) => !p.data!.ctaFound);
  if (noCta.length) add({ code: "missing_cta", category: "funnel", severity: "medium", title: `${noCta.length} bài thông tin không có lời kêu gọi liên hệ`, detail: "", urls: noCta.map((p) => p.url) });

  // ---- An toàn ----
  const blocked = ok.filter((p) => p.data!.blockHits.length);
  if (blocked.length) add({ code: "blocklist", category: "safety", severity: "critical", title: `${blocked.length} trang chứa từ trong blocklist`, detail: "Phải gỡ ngay. Agent không được ghi bất cứ nội dung nào chứa các từ này.", urls: blocked.map((p) => `${p.url} — ${p.data!.blockHits.join(", ")}`) });
  const marked = ok.filter((p) => p.data!.markers.length);
  if (marked.length) add({ code: "markers_live", category: "safety", severity: "high", title: `${marked.length} trang còn dấu biên tập hiện trên site`, detail: "Ví dụ [LINK 1], [IMAGE NEEDED…]: khách đang thấy những chữ này.", urls: marked.map((p) => `${p.url} — ${p.data!.markers.join(", ")}`) });
  const mixed = content.filter((p) => (rules.language === "de" && p.data!.lang_en > p.data!.lang_de && p.data!.words > 80) || (rules.language === "en" && p.data!.lang_de > p.data!.lang_en && p.data!.words > 80));
  if (mixed.length) add({ code: "language_mix", category: "safety", severity: "medium", title: `${mixed.length} trang có nội dung sai ngôn ngữ`, detail: `Site viết "${rules.language}" nhưng phần lớn chữ trên các trang này là ngôn ngữ khác.`, urls: mixed.map((p) => p.url) });
  const imgAlt = ok.reduce((s, p) => s + p.data!.images.missingAlt, 0);
  const imgOld = ok.reduce((s, p) => s + p.data!.images.nonWebp, 0);
  if (imgAlt > 10 || imgOld > 20) add({ code: "images", category: "technical", severity: "low", title: `Ảnh: ${imgAlt} ảnh thiếu alt, ${imgOld} ảnh chưa là WebP`, detail: "Ảnh kỹ thuật (BIM, CAD, ảnh dự án thật) không được thay bằng ảnh AI: chỉ đổi tên, alt và nén WebP < 200KB.", urls: ok.filter((p) => p.data!.images.missingAlt || p.data!.images.nonWebp).map((p) => `${p.url} (${p.data!.images.missingAlt} thiếu alt, ${p.data!.images.nonWebp} jpg/png)`) });

  // ---- Liên kết ngoài ----
  const cross = ok.filter((p) => p.data!.outboundDomains.some((d) => rules.relatedDomains.includes(d)));
  if (cross.length) add({ code: "cross_links", category: "offpage", severity: "high", title: `${cross.length} trang link sang các site khác của anh`, detail: "Link chéo dày đặc giữa các site cùng chủ là dấu vết thao túng link (link scheme). Gỡ hoặc thêm rel=\"nofollow\" theo từng đợt nhỏ.", urls: cross.map((p) => `${p.url} → ${p.data!.outboundDomains.filter((d) => rules.relatedDomains.includes(d)).join(", ")}`) });
  if (rules.toxicDomains.length) add({ code: "toxic_links", category: "offpage", severity: rules.linksBought || rules.manualAction ? "high" : "low", title: `${rules.toxicDomains.length} domain backlink xấu đã được đánh dấu`, detail: rules.linksBought || rules.manualAction
    ? "Site từng mua link / có thao tác thủ công: nên lập file disavow (dạng domain:) và anh tự nộp trong Search Console."
    : "Google nói phần lớn link rác đã bị bỏ qua tự động; chỉ nên disavow khi từng mua link hoặc có thao tác thủ công.", urls: rules.toxicDomains.map((d) => `domain:${d}`) });

  // ---- Đối chiếu thời điểm ----
  const near: GoogleUpdate[] = dropMonth ? updatesNear(dropMonth) : [];
  if (dropMonth) add({ code: "timeline", category: "timeline", severity: "info", title: near.length ? `Tháng tụt ${dropMonth} trùng với: ${near.map((u) => u.name).join(", ")}` : `Không có bản cập nhật Google nào được xác nhận gần tháng ${dropMonth}`, detail: near.map((u) => `${u.name} (${u.start} → ${u.end}): ${u.note}`).join("\n") || "Nguyên nhân có thể là thay đổi trên site (theme, plugin, xoá trang, đổi URL) hoặc đối thủ. So với lịch sử sửa site.", urls: [] });

  // ---- Điểm & chẩn đoán ----
  const perCat = new Map<string, number>();
  for (const f of findings) perCat.set(f.category, Math.min(35, (perCat.get(f.category) || 0) + SEV_WEIGHT[f.severity]));
  const score = Math.max(0, 100 - [...perCat.values()].reduce((a, b) => a + b, 0));

  const has = (code: string) => findings.find((f) => f.code === code);
  const causes: { id: string; title: string; weight: number; evidence: string[]; actions: string[] }[] = [];
  const ev = (codes: string[]) => codes.map(has).filter(Boolean).map((f) => f!.title);
  const w = (codes: string[]) => codes.map(has).filter(Boolean).reduce((s, f) => s + SEV_WEIGHT[f!.severity], 0);
  const spamNear = near.some((u) => u.kind === "spam");
  const coreNear = near.some((u) => u.kind === "core");
  causes.push({ id: "content", title: "Chất lượng nội dung: mỏng, hàng loạt, ăn thịt từ khoá", weight: w(["scaled_content", "thin", "cannibalisation", "dup_title"]) + (spamNear || coreNear ? 8 : 0), evidence: ev(["scaled_content", "thin", "cannibalisation", "dup_title"]), actions: ["Phân loại KEEP / FUNNEL / MERGE / PRUNE dựa trên traffic Search Console", "Củng cố trang chính của mỗi nhóm từ khoá trước khi gộp", "Gỡ hoặc noindex bài mỏng không có traffic (người duyệt quyết)"] });
  causes.push({ id: "funnel", title: "Liên kết nội bộ và phễu dẫn về trang dịch vụ", weight: w(["dead_end", "orphan_commercial", "missing_cta"]), evidence: ev(["dead_end", "orphan_commercial", "missing_cta"]), actions: ["Chèn link ngữ cảnh từ bài có traffic tới trang dịch vụ (tối đa 3 link/trang)", "Thêm CTA cuối bài thông tin"] });
  causes.push({ id: "offpage", title: "Hồ sơ backlink và link chéo giữa các site", weight: w(["cross_links", "toxic_links"]) + (spamNear && (rules.linksBought || rules.toxicDomains.length) ? 10 : 0), evidence: [...ev(["cross_links", "toxic_links"]), ...(rules.linksBought ? ["Anh xác nhận site từng mua link / dùng PBN"] : [])], actions: ["Gỡ link chéo theo từng đợt", "Lập file disavow nếu từng mua link hoặc có thao tác thủ công"] });
  causes.push({ id: "technical", title: "Lỗi kỹ thuật làm Google khó thu thập hoặc hiểu trang", weight: w(["robots_block_all", "noindex", "http_errors", "canonical_elsewhere", "no_https", "no_title", "no_meta_desc", "lang_attr"]), evidence: ev(["robots_block_all", "noindex", "http_errors", "canonical_elsewhere", "no_https", "no_title", "no_meta_desc", "lang_attr"]), actions: ["Sửa noindex/canonical/robots theo thứ tự rủi ro", "Bỏ URL lỗi khỏi sitemap"] });
  causes.push({ id: "safety", title: "Rủi ro pháp lý và nội dung lộ lỗi", weight: w(["blocklist", "markers_live", "language_mix"]), evidence: ev(["blocklist", "markers_live", "language_mix"]), actions: ["Gỡ ngay nội dung trong blocklist", "Xoá dấu biên tập còn sót"] });
  causes.sort((a, b) => b.weight - a.weight);

  const diagnosis = {
    summary: {
      pages: pages.length, scanned: ok.length, errors: errors.length,
      kinds: { home: byKind("home").length, commercial: commercial.length, conversion: byKind("conversion").length, informational: info.length, system: byKind("system").length },
      wordpress: checks.wordpress, elementor: checks.elementor
    },
    causes: causes.filter((c) => c.weight > 0),
    timeline: { dropMonth, updates: near, hint: spamNear ? "Tụt gần một bản cập nhật chống spam: ưu tiên kiểm tra nội dung hàng loạt và hồ sơ link." : coreNear ? "Tụt gần một bản cập nhật lõi: Google đánh giá lại chất lượng cả site; sửa xong có thể phải chờ tới bản cập nhật lõi sau mới thấy phục hồi." : dropMonth ? "Không trùng bản cập nhật nào: xem lại thay đổi trên site và đối thủ." : "Anh chưa nhập tháng tụt." },
    needsData: ["Search Console: so sánh click 2 tuần sau và trước bản cập nhật, theo từng trang, để biết trang nào mất nhiều nhất.", "Search Console › Bảo mật & Thao tác thủ công: xác nhận không có thao tác thủ công.", "GA4: lead (generate_lead) theo trang. Số liệu GA4 Data API chậm 24–48 giờ."],
    recovery: "Google cho biết thay đổi có thể có hiệu lực sau vài ngày, nhưng có khi cần vài tháng để hệ thống xác nhận cả site đã tốt lên; nhiều trường hợp phải chờ tới bản cập nhật lõi kế tiếp.",
    sources: [
      { title: "Google: core updates and your website", url: "https://developers.google.com/search/updates/core-updates" },
      { title: "Google Search Status Dashboard", url: "https://status.search.google.com/summary" },
      { title: "Google spam policies", url: "https://developers.google.com/search/docs/essentials/spam-policies" }
    ]
  };
  return { findings, score, diagnosis, kinds, inbound };
}

// ---------------- Lập việc cho đội agent ----------------

const LINK_TEMPLATES: Record<string, ((a: string) => string)[]> = {
  de: [(a) => `Mehr dazu auf unserer Seite: ${a}.`, (a) => `Passend dazu: ${a}.`, (a) => `Weitere Informationen finden Sie unter ${a}.`],
  en: [(a) => `Learn more: ${a}.`, (a) => `Related: ${a}.`, (a) => `See how we can help with ${a}.`]
};
const CTA_TEXT: Record<string, (href: string) => string> = {
  de: (h) => `Sie planen ein Projekt? <a href="${h}">Sprechen Sie mit unserem Team</a>.`,
  en: (h) => `Planning a project? <a href="${h}">Talk to our team</a>.`
};

export interface PlanInput {
  pages: ScannedPage[];
  analysis: Analysis;
  rules: SiteRules;
  elementor: boolean;
}

export function plan({ pages, analysis, rules, elementor }: PlanInput): PlannedTask[] {
  const tasks: PlannedTask[] = [];
  const lang = LINK_TEMPLATES[rules.language] ? rules.language : "en";
  const { kinds, inbound, findings } = analysis;
  const ok = pages.filter((p) => p.status === "done" && p.data && (p.http_status ?? 0) < 400);
  const byPath = new Map(ok.map((p) => [p.path, p]));
  const kindOf = (p: ScannedPage) => kinds.get(p.id);
  const f = (code: string) => findings.find((x) => x.code === code);
  const gateFor = (p: ScannedPage, edits: Edit[]) => checkEdits(edits, {
    rules,
    pageNumbers: p.data!.numbers,
    occurrences: (find) => p.data!.sections.find((s) => s.lastSentence === find)?.occurrences ?? (p.data!.title === find || p.data!.metaDescription === find ? 1 : 0),
    elementor: p.data!.elementor || rules.builder === "elementor",
    targetText: (path) => { const t = byPath.get(path); return t ? `${t.data!.h1[0] || ""} ${t.data!.title}` : path; }
  });

  // An toàn trước tiên
  const bl = f("blocklist");
  if (bl) tasks.push({ agent: "guardian", kind: "remove_blocked", title: "Gỡ nội dung trong blocklist khỏi site", detail: `${bl.urls.length} trang. Việc này anh hoặc người phụ trách làm tay, rồi bấm Quét lại để kiểm.`, target_url: null, payload: { urls: bl.urls }, risk: "review", priority: 1, gate: null });
  const mk = f("markers_live");
  if (mk) tasks.push({ agent: "guardian", kind: "remove_markers", title: "Xoá dấu biên tập còn hiện trên site", detail: "", target_url: null, payload: { urls: mk.urls }, risk: "review", priority: 2, gate: null });

  // Bác sĩ: việc kiểm chứng số liệu
  tasks.push({ agent: "doctor", kind: "verify_gsc", title: "Kiểm chứng bằng Search Console trước khi sửa lớn", detail: "So sánh click 2 tuần sau bản cập nhật nghi ngờ với 2 tuần trước, theo từng trang; xác nhận không có thao tác thủ công. Không quyết gộp/xoá trang khi chưa biết trang đó có traffic hay không.", target_url: null, payload: {}, risk: "safe", priority: 3, gate: null });

  // Kỹ thuật
  const techMap: [string, PlannedTask["risk"], number, string][] = [
    ["robots_block_all", "irreversible", 4, "Sửa robots.txt để không chặn toàn site"],
    ["noindex", "irreversible", 6, "Xem lại các trang noindex trong sitemap"],
    ["http_errors", "review", 12, "Sửa hoặc bỏ URL lỗi khỏi sitemap"],
    ["canonical_elsewhere", "irreversible", 25, "Quyết canonical cho các trang trỏ sang URL khác"],
    ["lang_attr", "review", 28, "Sửa thuộc tính ngôn ngữ của trang"],
    ["no_https", "irreversible", 5, "Bật HTTPS và chuyển hướng toàn site"],
    ["images", "review", 55, "Ảnh: thêm alt, đổi tên SEO, nén WebP < 200KB"]
  ];
  for (const [code, risk, pr, title] of techMap) { const x = f(code); if (x) tasks.push({ agent: code === "images" ? "meta" : "tech", kind: code, title, detail: x.detail, target_url: null, payload: { urls: x.urls }, risk, priority: pr, gate: null }); }

  // Nối link nội bộ: bài thông tin cụt -> trang dịch vụ liên quan nhất
  const targets = ok.filter((p) => kindOf(p) === "commercial");
  const targetToks = new Map(targets.map((t) => [t.path, toks(`${t.data!.h1[0] || ""} ${t.data!.title} ${t.path.replace(/[-/]/g, " ")}`)]));
  const anchorsFor = (t: ScannedPage): string[] => {
    const brandless = (s: string) => (s.split(/\s[|–—-]\s/)[0] ?? "").trim();
    const words = (s: string) => s.split(/\s+/).length;
    const cands = [brandless(t.data!.h1[0] || ""), brandless(t.data!.title), titleCase(slugToks(t.path).join(" "))].map((s) => cutAt(s, 60)).filter((s) => s && words(s) <= 7 && words(s) >= 1);
    return [...new Set(cands)];
  };
  const anchorUse = new Map<string, number>();
  const deadEnd = new Set((f("dead_end")?.urls || []));
  const sources = ok.filter((p) => kindOf(p) === "informational" && deadEnd.has(p.url) && p.data!.words >= 300)
    .sort((a, b) => (inbound.get(b.path) || 0) - (inbound.get(a.path) || 0) || b.data!.words - a.data!.words)
    .slice(0, 30);
  let linkTasks = 0;
  for (const src of sources) {
    if (!targets.length) break;
    const pageToks = toks(`${src.data!.title} ${src.data!.h2.join(" ")} ${src.path.replace(/[-/]/g, " ")}`);
    const ranked = targets.map((t) => ({ t, s: overlap(pageToks, targetToks.get(t.path)!) + ((inbound.get(t.path) || 0) < 3 ? 0.5 : 0) }))
      .filter((x) => x.s >= 1).sort((a, b) => b.s - a.s).slice(0, rules.maxLinksPerPage);
    const used = new Set<string>();
    const edits: Edit[] = [];
    for (const { t } of ranked) {
      const tt = targetToks.get(t.path)!;
      const sec = src.data!.sections.filter((s) => s.lastSentence && s.occurrences === 1 && !used.has(s.lastSentence))
        .map((s) => ({ s, sc: overlap(toks(`${s.heading} ${s.sample}`), tt) })).sort((a, b) => b.sc - a.sc)[0];
      if (!sec) continue;
      const anchors = anchorsFor(t);
      if (!anchors.length) continue;
      const n = anchorUse.get(t.path) || 0;
      anchorUse.set(t.path, n + 1);
      const anchor = anchors[n % anchors.length];
      const tpls = LINK_TEMPLATES[lang] ?? LINK_TEMPLATES.en!;
      const tpl = tpls[n % tpls.length]!;
      used.add(sec.s.lastSentence);
      edits.push({ type: "internal_link", section: sec.s.heading, find: sec.s.lastSentence, replace: `${sec.s.lastSentence} ${tpl(`<a href="${t.path}">${anchor}</a>`)}`, target: t.path, anchor });
    }
    if (!edits.length) continue;
    const gate = gateFor(src, edits);
    tasks.push({ agent: "linker", kind: "internal_links", title: `Chèn ${edits.length} link nội bộ vào ${src.path}`, detail: `Từ bài thông tin tới: ${edits.map((e) => e.target).join(", ")}.`, target_url: src.url, payload: { edits, elementor: src.data!.elementor, words: src.data!.words }, risk: "review", priority: 10 + linkTasks, gate });
    linkTasks++;
  }

  // Phễu CTA cho bài thông tin chưa có lời kêu gọi
  const conv = ok.find((p) => kindOf(p) === "conversion")?.path || targets[0]?.path;
  if (conv) {
    const noCta = new Set(f("missing_cta")?.urls || []);
    let n = 0;
    for (const p of ok.filter((x) => noCta.has(x.url) && x.data!.words >= 300).slice(0, 25)) {
      const last = [...p.data!.sections].reverse().find((s) => s.lastSentence && s.occurrences === 1);
      if (!last) continue;
      const edits: Edit[] = [{ type: "cta", section: last.heading, find: last.lastSentence, replace: `${last.lastSentence} ${(CTA_TEXT[lang] ?? CTA_TEXT.en!)(conv)}` }];
      tasks.push({ agent: "funnel", kind: "cta", title: `Thêm CTA vào ${p.path}`, detail: `Dẫn người đọc tới ${conv}.`, target_url: p.url, payload: { edits, elementor: p.data!.elementor }, risk: "review", priority: 20 + n++, gate: gateFor(p, edits) });
    }
  }

  // Meta: thiếu hoặc quá dài (đề xuất từ chính nội dung trang, không thêm số liệu mới)
  let m = 0;
  for (const p of ok.filter((x) => ["commercial", "informational", "home"].includes(kindOf(x) || ""))) {
    if (m >= 30) break;
    const d = p.data!;
    const edits: Edit[] = [];
    if (d.title.length > 60) edits.push({ type: "meta_title", find: d.title, replace: cutAt(d.title.split(/\s[|–—]\s/)[0] ?? d.title, 60) });
    if (!d.metaDescription && d.text) {
      const first = d.text.replace(/\s+/g, " ").split(/(?<=[.!?])\s/).slice(0, 2).join(" ");
      edits.push({ type: "meta_description", find: "", replace: cutAt(first, 155) });
    } else if (d.metaDescription.length > 155) edits.push({ type: "meta_description", find: d.metaDescription, replace: cutAt(d.metaDescription, 155) });
    if (!edits.length) continue;
    tasks.push({ agent: "meta", kind: "meta", title: `Sửa meta của ${p.path}`, detail: "Đề xuất rút gọn từ nội dung có sẵn. Người duyệt nên viết lại cho hay hơn, có từ khoá chính và lời kêu gọi.", target_url: p.url, payload: { edits, fields: { title: "rank_math_title", description: "rank_math_description" } }, risk: "review", priority: 30 + m++, gate: gateFor(p, edits) });
  }

  // Biên tập nội dung: nhóm ăn thịt từ khoá và trang mỏng
  const cg = f("cannibalisation");
  if (cg) for (const [i, g] of cg.urls.slice(0, 10).entries()) {
    const paths = g.split("  |  ");
    const strongest = paths.map((p) => byPath.get(p)).filter(Boolean).sort((a, b) => (inbound.get(b!.path) || 0) - (inbound.get(a!.path) || 0) || b!.data!.words - a!.data!.words)[0];
    tasks.push({ agent: "editor", kind: "merge", title: `Xử lý nhóm từ khoá trùng (${paths.length} trang)`, detail: `Đề xuất giữ ${strongest?.path || paths[0]} làm trang chính, củng cố nó trước; sau đó mới cân nhắc gộp/redirect các trang còn lại. Redirect là việc khó đảo ngược: người duyệt quyết.`, target_url: null, payload: { pages: paths, keep: strongest?.path || paths[0] }, risk: "irreversible", priority: 40 + i, gate: null });
  }
  const thinF = f("thin");
  if (thinF) {
    const prune = ok.filter((p) => kindOf(p) === "informational" && p.data!.words < 300 && (inbound.get(p.path) || 0) === 0);
    if (prune.length) tasks.push({ agent: "editor", kind: "prune", title: `Xem xét gỡ ${prune.length} bài mỏng không có link trỏ về`, detail: "Chỉ gỡ (hoặc noindex) bài không có traffic trong Search Console 6 tháng gần nhất. Bài có traffic thì viết lại cho đầy đủ.", target_url: null, payload: { urls: prune.map((p) => p.url) }, risk: "irreversible", priority: 50, gate: null });
  }
  const sc = f("scaled_content");
  if (sc) {
    const cls = ok.filter((p) => kindOf(p) === "informational").map((p) => ({
      url: p.url,
      words: p.data!.words,
      inbound: inbound.get(p.path) || 0,
      label: p.data!.words < 300 && !(inbound.get(p.path) || 0) ? "PRUNE" : deadEnd.has(p.url) ? "FUNNEL" : "KEEP"
    }));
    const count = (l: string) => cls.filter((c) => c.label === l).length;
    tasks.push({ agent: "editor", kind: "classify", title: "Phân loại bài thông tin: KEEP / FUNNEL / PRUNE (bản nháp)", detail: `Theo dữ liệu quét: KEEP ${count("KEEP")}, FUNNEL ${count("FUNNEL")}, PRUNE ${count("PRUNE")}. MERGE xem ở các việc "nhóm từ khoá trùng". Cần đối chiếu traffic Search Console trước khi chốt.`, target_url: null, payload: { pages: cls }, risk: "safe", priority: 35, gate: null });
  }

  // Liên kết ngoài
  const cross = f("cross_links");
  if (cross) tasks.push({ agent: "offpage", kind: "cross_links", title: "Gỡ link chéo sang các site khác của anh (theo đợt ≤ 3 trang)", detail: cross.detail, target_url: null, payload: { urls: cross.urls }, risk: "review", priority: 15, gate: null });
  if (rules.toxicDomains.length) tasks.push({ agent: "offpage", kind: "disavow", title: rules.linksBought || rules.manualAction ? `Lập file disavow (${rules.toxicDomains.length} domain)` : "Cân nhắc disavow (có thể không cần)", detail: rules.linksBought || rules.manualAction ? "Tải file ở tab Liên kết ngoài, anh tự nộp trong Search Console › Disavow links. App không tự nộp." : "Google khuyên chỉ disavow khi từng mua link hoặc có thao tác thủ công. Nếu đúng vậy, bật lựa chọn đó trong Luật an toàn.", target_url: null, payload: { domains: rules.toxicDomains }, risk: "irreversible", priority: rules.linksBought ? 16 : 70, gate: null });

  // GEO: trang dịch vụ chưa có FAQ
  const noFaq = targets.filter((t) => !t.data!.schemaTypes.some((s) => /FAQPage/i.test(s)));
  if (noFaq.length) tasks.push({ agent: "geo", kind: "geo_plan", title: `Lên kế hoạch GEO cho ${noFaq.length} trang dịch vụ chưa có FAQ`, detail: "Đoạn trả lời trực tiếp 2–4 câu đầu mỗi mục H2, bảng so sánh, 3–5 câu hỏi thương mại. Nội dung do AI soạn sẽ qua Gác cổng (không số liệu bịa) và cần duyệt.", target_url: null, payload: { urls: noFaq.map((t) => t.url) }, risk: "review", priority: 60, gate: null });

  return tasks;
}

// File disavow theo đúng định dạng Google (domain:)
export function disavowFile(siteDomain: string, domains: string[]): string {
  const day = new Date().toISOString().slice(0, 10);
  return [`# Disavow cho ${siteDomain} — tạo bởi Duy Ơi ngày ${day}`, "# Chỉ nộp khi site từng mua link / dùng PBN hoặc có thao tác thủ công về link.", ...domains.map((d) => `domain:${d}`)].join("\n") + "\n";
}
