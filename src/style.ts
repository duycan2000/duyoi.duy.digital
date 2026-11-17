// Văn như người viết + định dạng chuẩn:
// 1) Câu sáo hay gặp ở văn AI (de/en/vi): báo cho người viết tránh, Gác cổng đếm và chặn khi lạm dụng.
// 2) Kiểm cấu trúc từng định dạng bằng code (không trông vào AI tự giác): thiếu phần chính thì chặn, kèm cách sửa.
// 3) Chuyển Markdown (bài anh viết bằng Claude) sang HTML gọn.

import type { FormatId, Products, Slot } from "./formats";
import type { GateProblem } from "./recovery-gate";

// ---------------- Câu sáo ----------------

export const CLICHES: Record<string, string[]> = {
  en: [
    "in today's fast-paced world", "in today's digital age", "in the ever-evolving", "ever-changing landscape", "delve into", "let's dive in", "dive deep into",
    "it's important to note", "it is worth noting", "in conclusion", "in summary", "unlock the power", "unleash", "game-changer", "a testament to",
    "navigate the complexities", "look no further", "whether you're a beginner or", "elevate your", "seamlessly", "embark on a journey", "tapestry",
    "at the end of the day", "plays a crucial role", "a myriad of", "revolutionize", "harness the power"
  ],
  de: [
    "in der heutigen digitalen welt", "in der heutigen schnelllebigen zeit", "in der heutigen zeit", "zusammenfassend lässt sich sagen", "abschließend lässt sich sagen",
    "es ist wichtig zu beachten", "es ist erwähnenswert", "tauchen wir ein", "eintauchen in", "spielt eine entscheidende rolle", "eine schlüsselrolle",
    "nicht zuletzt", "von entscheidender bedeutung", "auf die nächste stufe", "das volle potenzial", "revolutioniert", "nahtlos", "facettenreich",
    "ob anfänger oder profi", "eine vielzahl von", "im großen und ganzen", "last but not least"
  ],
  vi: [
    "trong thời đại công nghệ số", "trong thời đại ngày nay", "trong bối cảnh hiện nay", "không thể phủ nhận rằng", "tóm lại", "có thể nói rằng", "đóng vai trò quan trọng",
    "hãy cùng tìm hiểu", "khám phá ngay", "bước lên một tầm cao mới", "nâng tầm", "một cách liền mạch", "dù bạn là người mới hay", "vô vàn", "đáng chú ý là"
  ]
};
export const clichesFor = (lang: string) => CLICHES[lang] || CLICHES.en!;

export function clicheHits(text: string, lang: string): string[] {
  const t = text.toLowerCase().replace(/\s+/g, " ");
  return clichesFor(lang).filter((c) => t.includes(c));
}

export function checkVoice(html: string, lang: string): GateProblem[] {
  const text = html.replace(/<[^>]+>/g, " ");
  const hits = clicheHits(text, lang);
  const out: GateProblem[] = [];
  if (hits.length >= 3) out.push({ rule: "cliche", level: "block", message: `Văn có dấu hiệu AI, ${hits.length} câu sáo: "${hits.slice(0, 5).join('", "')}". Viết lại cụ thể hơn.` });
  else if (hits.length) out.push({ rule: "cliche", level: "warn", message: `Câu sáo nên bỏ: "${hits.join('", "')}".` });
  // Câu quá đều (văn máy): đo độ lệch độ dài câu
  const sentences = text.split(/(?<=[.!?])\s+/).map((s) => s.trim().split(/\s+/).length).filter((n) => n >= 3);
  if (sentences.length >= 20) {
    const avg = sentences.reduce((a, b) => a + b, 0) / sentences.length;
    const sd = Math.sqrt(sentences.reduce((a, b) => a + (b - avg) ** 2, 0) / sentences.length);
    if (sd / avg < 0.3) out.push({ rule: "rhythm", level: "warn", message: "Câu dài ngắn quá đều (dễ đọc như văn máy): xen câu ngắn, câu dài." });
  }
  const longP = (html.match(/<p>[\s\S]*?<\/p>/g) || []).filter((p) => p.replace(/<[^>]+>/g, " ").trim().split(/\s+/).length > 120).length;
  if (longP) out.push({ rule: "paragraph", level: "warn", message: `${longP} đoạn dài hơn 120 từ: tách nhỏ cho dễ đọc.` });
  return out;
}

// ---------------- Kiểm cấu trúc theo định dạng ----------------

const FAQ_RE = /faq|häufig|frequently|fragen|câu hỏi|questions/i;
const VERDICT_RE = /fazit|verdict|bottom line|kết luận|conclusion|urteil|empfehlung|our pick|unsere wahl|summary|zusammenfassung|lời khuyên/i;
const DRAWBACK_RE = /nachteil|drawback|cons\b|nhược|schwäche|minus|downside|limitation|hạn chế|was uns stört|weniger gut/i;
const NEED_RE = /what you need|you'll need|benötig|brauchen|material|werkzeug|chuẩn bị|cần có|voraussetzung|tools/i;
const STEP_RE = /^(step|schritt|bước)\s*\d+/i;
const TAKEAWAY_RE = /key takeaway|takeaways|das wichtigste|kurz gesagt|auf einen blick|tl;dr|ý chính|tóm tắt nhanh|highlights|überblick/i;
const PROSCONS_RE = /pros|cons|vorteile|nachteile|ưu|nhược|plus|minus/i;

interface Sec { h: string; body: string }
function sections(html: string): { intro: string; h2: Sec[] } {
  const parts = html.split(/<h2>/i);
  const intro = parts.shift() || "";
  return { intro, h2: parts.map((p) => { const end = p.indexOf("</h2>"); return { h: p.slice(0, end).replace(/<[^>]+>/g, "").trim(), body: p.slice(end + 5) }; }) };
}

export function checkStructure(format: FormatId, raw: string, products: Products, slots: Slot[]): GateProblem[] {
  const out: GateProblem[] = [];
  const need = (ok: boolean, message: string, level: "block" | "warn" = "block") => { if (!ok) out.push({ rule: "structure", level, message }); };
  const { intro, h2 } = sections(raw);
  const has = (re: RegExp) => h2.some((s) => re.test(s.h));
  need(/<p>/.test(intro) && intro.replace(/<[^>]+>/g, " ").trim().split(/\s+/).length >= 15, "Thiếu đoạn mở bài trả lời thẳng câu hỏi trước tiêu đề H2 đầu tiên.");
  need(h2.length >= 3, `Bài chỉ có ${h2.length} mục H2: cần đủ các phần của định dạng.`);
  if (format !== "article") need(has(FAQ_RE), "Thiếu mục FAQ (câu hỏi thường gặp).");
  const tokens = (s: string, t: string) => s.includes(t);
  if (format === "roundup" || format === "comparison") {
    const first = products.items[0] ? raw.toLowerCase().search(new RegExp(`<h2>[^<]*${products.items[0].name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`)) : -1;
    const tableAt = raw.search(/<table>/i);
    need(tableAt >= 0 && (first < 0 || tableAt < first), format === "roundup" ? "Thiếu bảng chọn nhanh ở đầu bài (trước mục sản phẩm đầu tiên)." : "Thiếu bảng so sánh tổng quan ở đầu bài.");
    products.items.forEach((p, i) => {
      const n = i + 1;
      const sec = h2.find((s) => s.h.toLowerCase().includes(p.name.toLowerCase()));
      need(!!sec, `Thiếu mục riêng (H2) cho sản phẩm "${p.name}".`);
      if (!sec) return;
      need(tokens(sec.body, `[[BUY:${n}]]`) || tokens(raw, `[[BUY:${n}]]`), `Thiếu nút mua cho "${p.name}".`);
      if (format === "roundup") need(DRAWBACK_RE.test(sec.body), `Mục "${p.name}" thiếu phần nhược điểm.`);
    });
    need(has(VERDICT_RE), "Thiếu phần kết luận: chọn cái nào cho trường hợp nào.");
    if (format === "roundup") need((raw.match(/<table>/gi) || []).length >= 2, "Nên có bảng so sánh thông số giữa các sản phẩm.", "warn");
  }
  if (format === "review") {
    need(h2.slice(0, 3).some((s) => PROSCONS_RE.test(s.h) || (s.body.match(/<ul>/gi) || []).length >= 2), "Thiếu phần ưu/nhược ở đầu bài.");
    need(has(VERDICT_RE), "Thiếu phần kết luận cuối bài.");
    need(products.items.length < 2 || products.items.slice(1).every((_, i) => tokens(raw, `[[BUY:${i + 2}]]`)), "Thiếu nút mua cho sản phẩm thay thế.", "warn");
    need(tokens(raw, "[[BUY:1]]"), "Thiếu nút mua cho sản phẩm chính.");
  }
  if (format === "how_to") {
    const needSec = h2.find((s) => NEED_RE.test(s.h));
    need(!!needSec && /<ul>/i.test(needSec.body), "Thiếu mục \"cần chuẩn bị\" dạng danh sách.");
    const stepH3 = (raw.match(/<h3>([\s\S]*?)<\/h3>/gi) || []).filter((h) => STEP_RE.test(h.replace(/<[^>]+>/g, "").trim())).length;
    const olItems = (raw.match(/<ol>[\s\S]*?<\/ol>/i)?.[0].match(/<li>/gi) || []).length;
    need(stepH3 >= 3 || olItems >= 3, "Thiếu các bước đánh số (ít nhất 3 bước: H3 \"Bước 1…\" hoặc danh sách có thứ tự).");
    need(has(/mistake|fehler|lỗi|troubleshoot|problem|sự cố/i), "Nên có mục lỗi thường gặp / xử lý sự cố.", "warn");
  }
  if (format === "guide") {
    need(h2.slice(0, 2).some((s) => TAKEAWAY_RE.test(s.h) && /<ul>/i.test(s.body)), "Thiếu mục ý chính (key takeaways) dạng danh sách ở đầu bài.");
    need(has(/checklist|check|kiểm tra|prüf|liste/i), "Nên có danh sách kiểm tra khi chọn/làm.", "warn");
  }
  const missingImg = slots.filter((s) => s.required && !raw.includes(`[[IMG:${s.key}]]`) && !/^p\d+$/.test(s.key) && s.key !== "hero");
  need(!missingImg.length, `Bài chưa có chỗ đặt ảnh: ${missingImg.map((s) => s.key).join(", ")}.`, "warn");
  return out;
}

// ---------------- Markdown → HTML (bài anh viết bằng Claude) ----------------

const escHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
function inline(s: string): string {
  return escHtml(s)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*(?!\s)(.+?)\*(?!\*)/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, t: string, u: string) => `<a href="${u.replace(/"/g, "")}">${t}</a>`);
}

export function markdownToHtml(md: string): { title: string; html: string } {
  const lines = md.replace(/\r/g, "").split("\n");
  let title = "";
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const l = lines[i]!.trimEnd();
    const t = l.trim();
    if (!t) { i++; continue; }
    if (/^---+$/.test(t) && i === 0) { i++; while (i < lines.length && !/^---+$/.test(lines[i]!.trim())) i++; i++; continue; }
    let m: RegExpMatchArray | null;
    if ((m = t.match(/^#\s+(.+)/))) { if (!title) title = m[1]!.trim(); else out.push(`<h2>${inline(m[1]!)}</h2>`); i++; continue; }
    if ((m = t.match(/^##\s+(.+)/))) { out.push(`<h2>${inline(m[1]!)}</h2>`); i++; continue; }
    if ((m = t.match(/^#{3,6}\s+(.+)/))) { out.push(`<h3>${inline(m[1]!)}</h3>`); i++; continue; }
    if (/^\[\[[A-Z]+(?::[a-z0-9]+)?\]\]$/i.test(t)) { out.push(t); i++; continue; }
    if (/^\|.*\|$/.test(t)) {
      const rows: string[][] = [];
      while (i < lines.length && /^\|.*\|$/.test(lines[i]!.trim())) { rows.push(lines[i]!.trim().slice(1, -1).split("|").map((c) => c.trim())); i++; }
      const body = rows.filter((r) => !r.every((c) => /^:?-{2,}:?$/.test(c)));
      const [head, ...rest] = body;
      out.push(`<table><thead><tr>${(head || []).map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>${rest.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`);
      continue;
    }
    if (/^[-*+]\s+/.test(t)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i]!)) { items.push(lines[i]!.trim().replace(/^[-*+]\s+/, "")); i++; }
      out.push(`<ul>${items.map((x) => `<li>${inline(x)}</li>`).join("")}</ul>`);
      continue;
    }
    if (/^\d+[.)]\s+/.test(t)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i]!)) { items.push(lines[i]!.trim().replace(/^\d+[.)]\s+/, "")); i++; }
      out.push(`<ol>${items.map((x) => `<li>${inline(x)}</li>`).join("")}</ol>`);
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i]!.trim() && !/^(#|\||[-*+]\s|\d+[.)]\s|\[\[)/.test(lines[i]!.trim())) { para.push(lines[i]!.trim()); i++; }
    if (para.length) out.push(`<p>${inline(para.join(" "))}</p>`);
    else i++;
  }
  return { title, html: out.join("\n") };
}
