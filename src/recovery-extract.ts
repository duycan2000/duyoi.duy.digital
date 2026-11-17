// Đọc HTML một trang và rút ra những gì cần cho chẩn đoán SEO. Chỉ đọc, không sửa gì.
// Dùng regex thay vì thư viện để Worker không có dependency; đủ chính xác cho phân tích (không dùng để ghi đè trang).

import type { SiteRules } from "./recovery-rules";

export interface PageSection {
  heading: string;
  lastSentence: string;   // câu cuối của đoạn văn cuối trong mục — chỗ chèn link "phẫu thuật"
  occurrences: number;    // số lần câu đó xuất hiện trong nội dung (phải đúng 1 mới được sửa)
  firstSentence?: string; // câu đầu của đoạn văn đầu — chỗ chèn đoạn trả lời trực tiếp (GEO) phía trước
  firstOccurrences?: number;
  sample: string;         // đầu mục, để so chủ đề
  words: number;
}

export interface PageData {
  finalUrl: string;
  title: string;
  metaDescription: string;
  robots: string;
  canonical: string;
  lang: string;
  h1: string[];
  h2: string[];
  words: number;
  sections: PageSection[];
  internalLinks: string[];       // path các link nội bộ trong phần nội dung (không tính menu/footer)
  navLinkCount: number;
  outboundDomains: string[];     // domain bên ngoài được link trong nội dung
  schemaTypes: string[];
  images: { total: number; missingAlt: number; nonWebp: number; files: string[] };
  hasForm: boolean;
  ctaFound: boolean;
  elementor: boolean;
  wordpress: boolean;
  markers: string[];             // dấu biên tập còn sót ([LINK 1], [IMAGE NEEDED…)
  blockHits: string[];           // từ trong blocklist xuất hiện trên trang
  numbers: string[];             // các con số có trên trang (để kiểm tra số liệu không có nguồn)
  lang_en: number;               // tỉ lệ từ chức năng tiếng Anh trong nội dung
  lang_de: number;
  text: string;                  // đoạn đầu nội dung (để đọc nhanh)
}

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…", rsquo: "’", lsquo: "‘",
  rdquo: "”", ldquo: "“", bdquo: "„", auml: "ä", ouml: "ö", uuml: "ü", Auml: "Ä", Ouml: "Ö", Uuml: "Ü", szlig: "ß", eacute: "é", euro: "€", copy: "©", reg: "®"
};

export function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[e] ?? ENTITIES[e.toLowerCase()] ?? m;
  });
}

export const clean = (s: string): string => decode(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g)) out[(m[1] ?? "").toLowerCase()] = decode(m[3] ?? m[4] ?? m[5] ?? "");
  return out;
}

const stripBlocks = (html: string, tags: string[]): string =>
  tags.reduce((h, t) => h.replace(new RegExp(`<${t}\\b[\\s\\S]*?</${t}>`, "gi"), " "), html);

const EN_WORDS = new Set("the and of to in is for that with are on this as be it by you your our from or can an at we have more which will not".split(" "));
const DE_WORDS = new Set("der die das und ist in zu den von mit für sich des auf dem nicht eine ein als auch es an werden aus er hat dass sie nach wird bei oder wir ihr ihre unsere sind".split(" "));

export const MARKER_RE = /\[(?:IMAGE NEEDED|PRICING: owner to confirm|LINK \d+|TODO|PLACEHOLDER)[^\]]*\]|NEEDS REAL IMAGE/gi;
const CTA_RE = /(kontakt|anfrage|anfragen|angebot|beratung|termin|jetzt|contact us|get a quote|request a quote|free quote|book a call|schedule a call|get in touch|hire|talk to)/i;

export function wordCount(text: string): number {
  return (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length;
}

export function langRatios(text: string): { en: number; de: number } {
  const words = text.toLowerCase().match(/\p{L}+/gu) || [];
  if (!words.length) return { en: 0, de: 0 };
  let en = 0, de = 0;
  for (const w of words) { if (EN_WORDS.has(w)) en++; if (DE_WORDS.has(w)) de++; }
  return { en: +(en / words.length).toFixed(3), de: +(de / words.length).toFixed(3) };
}

// Số liệu: con số kèm đơn vị (%, €, $…) hoặc số có từ 2 chữ số
export function extractNumbers(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/(?:[€$]\s?)?\d+(?:[.,]\d+)*\s?(?:%|€|\$|eur\b|euro\b|usd\b)?/gi)) {
    const v = m[0].replace(/\s+/g, "").toLowerCase();
    if (/^\d$/.test(v)) continue; // bỏ số đơn lẻ 0–9 (danh sách, bước…)
    out.add(v);
    if (out.size >= 300) break;
  }
  return [...out];
}

// Số trong tên chuẩn / phiên bản phần mềm (DIN 1356, ISO 128, LOD 400, Revit 2025) không phải số liệu bịa
export function standardNumbers(text: string): string[] {
  return [...text.matchAll(/\b(?:DIN|ISO|VDI|EN|LOD|IFC|BS|ANSI|Revit|AutoCAD|ArchiCAD|Inventor|SolidWorks|Navisworks|Tekla)\s?(?:EN\s?)?(\d+(?:[.,-]\d+)*)/gi)].map((m) => (m[1] || "").toLowerCase());
}

const hostOf = (h: string) => h.toLowerCase().replace(/^www\./, "");

function splitSentences(text: string): string[] {
  return text.split(/(?<=[.!?…])\s+(?=[\p{Lu}0-9„“"(])/u).map((s) => s.trim()).filter(Boolean);
}

function countOccurrences(hay: string, needle: string): number {
  if (!needle) return 0;
  let n = 0, i = 0;
  while ((i = hay.indexOf(needle, i)) !== -1) { n++; i += needle.length; }
  return n;
}

export function blockHitsIn(text: string, files: string[], rules: Pick<SiteRules, "blocklist" | "blockedFilenames">): string[] {
  const hits = new Set<string>();
  const low = text.toLowerCase();
  for (const term of rules.blocklist) if (term && low.includes(term.toLowerCase())) hits.add(term);
  for (const pat of rules.blockedFilenames) {
    const p = pat.toLowerCase();
    const re = p.endsWith("*") ? (f: string) => f.startsWith(p.slice(0, -1)) : (f: string) => f === p;
    for (const f of files) if (re(f.toLowerCase())) hits.add(`ảnh: ${f}`);
  }
  return [...hits];
}

export function extractPage(html: string, pageUrl: string, rules: SiteRules): PageData {
  const base = new URL(pageUrl);
  const host = hostOf(base.hostname);
  const noComments = html.replace(/<!--[\s\S]*?-->/g, " ");
  const head = (noComments.match(/<head\b[\s\S]*?<\/head>/i) || [""])[0];
  const schemaTypes = new Set<string>();
  for (const m of noComments.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const walk = (n: unknown): void => {
        if (Array.isArray(n)) return n.forEach(walk);
        if (n && typeof n === "object") {
          const o = n as Record<string, unknown>;
          const t = o["@type"];
          if (typeof t === "string") schemaTypes.add(t);
          if (Array.isArray(t)) t.forEach((x) => typeof x === "string" && schemaTypes.add(x));
          if (o["@graph"]) walk(o["@graph"]);
          if (o.mainEntity) walk(o.mainEntity);
        }
      };
      walk(JSON.parse(m[1] ?? "null"));
    } catch { /* JSON-LD hỏng: bỏ qua */ }
  }
  const body0 = stripBlocks(noComments, ["script", "style", "noscript", "svg", "template", "iframe"]);
  let title = "", metaDescription = "", robots = "", canonical = "";
  const t = head.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (t) title = clean(t[1] ?? "");
  for (const m of noComments.matchAll(/<meta\b[^>]*>/gi)) {
    const a = attrs(m[0]);
    const name = (a.name || a.property || "").toLowerCase();
    if (name === "description" && !metaDescription) metaDescription = (a.content || "").trim();
    if (name === "robots") robots = (a.content || "").toLowerCase();
  }
  for (const m of noComments.matchAll(/<link\b[^>]*>/gi)) {
    const a = attrs(m[0]);
    if ((a.rel || "").toLowerCase() === "canonical" && a.href) { try { canonical = new URL(a.href, base).href; } catch { /* bỏ qua */ } }
  }
  const htmlTag = noComments.match(/<html\b[^>]*>/i);
  const lang = htmlTag ? (attrs(htmlTag[0]).lang || "").toLowerCase().slice(0, 2) : "";

  // Vùng nội dung chính: <main> hoặc <article>, nếu không có thì body bỏ header/nav/footer/aside
  let content = (body0.match(/<main\b[\s\S]*<\/main>/i) || body0.match(/<article\b[\s\S]*<\/article>/i) || [""])[0];
  if (!content) content = (body0.match(/<body\b[\s\S]*<\/body>/i) || [body0])[0];
  content = stripBlocks(content, ["header", "nav", "footer", "aside", "form"]);
  const hasForm = /<form\b/i.test(body0.replace(/<form\b[^>]*role=["']search["'][\s\S]*?<\/form>/gi, "").replace(/<form\b[^>]*search[\s\S]*?<\/form>/gi, ""));

  const allLinks = [...body0.matchAll(/<a\b[^>]*>/gi)].length;
  const internal = new Set<string>();
  const outbound = new Set<string>();
  let cta = false;
  for (const m of content.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const a = attrs(`<a ${m[1]}>`);
    if (!a.href || /^(#|mailto:|tel:|javascript:)/i.test(a.href)) continue;
    let u: URL;
    try { u = new URL(a.href, base); } catch { continue; }
    const anchor = clean(m[2] ?? "");
    if (hostOf(u.hostname) === host) {
      if (!/\/wp-content\/|\/wp-admin|\/feed\/?$/.test(u.pathname)) internal.add(u.pathname.endsWith("/") || /\.[a-z0-9]{2,5}$/i.test(u.pathname) ? u.pathname : `${u.pathname}/`);
      if (CTA_RE.test(anchor) || /kontakt|contact|angebot|quote/i.test(u.pathname)) cta = true;
    } else if (/^https?:$/.test(u.protocol)) outbound.add(hostOf(u.hostname));
  }
  if (!cta && /<(button|a)\b[^>]*>[^<]{0,60}(kontakt|anfrage|angebot|contact|quote|beratung)/i.test(content)) cta = true;

  const h1 = [...body0.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].map((m) => clean(m[1] ?? "")).filter(Boolean).slice(0, 5);
  const h2 = [...content.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi)].map((m) => clean(m[1] ?? "")).filter(Boolean).slice(0, 30);

  const contentText = clean(content);
  const fullText = clean(body0);

  // Các mục theo H2 và câu cuối của đoạn văn cuối mỗi mục
  const parts = content.split(/<h2\b[^>]*>/i);
  const sections: PageSection[] = [];
  for (let i = 1; i < parts.length && sections.length < 15; i++) {
    const [headHtml = "", ...rest] = (parts[i] ?? "").split(/<\/h2>/i);
    const bodyHtml = rest.join(" ").split(/<h[1-2]\b/i)[0] ?? "";
    const paras = [...bodyHtml.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map((m) => clean(m[1] ?? "")).filter((p) => wordCount(p) >= 8);
    const last = paras.length ? splitSentences(paras[paras.length - 1] ?? "").filter((s) => wordCount(s) >= 6).pop() || "" : "";
    const first = paras.length ? splitSentences(paras[0] ?? "").find((s) => wordCount(s) >= 5) || "" : "";
    const bodyText = clean(bodyHtml);
    sections.push({
      heading: clean(headHtml).slice(0, 200),
      lastSentence: last.slice(0, 500),
      occurrences: countOccurrences(contentText, last),
      firstSentence: first.slice(0, 500),
      firstOccurrences: countOccurrences(contentText, first),
      sample: bodyText.slice(0, 400),
      words: wordCount(bodyText)
    });
  }

  const imgs = [...body0.matchAll(/<img\b[^>]*>/gi)].map((m) => attrs(m[0]));
  const files = imgs.map((a) => (a.src || a["data-src"] || "").split("?")[0]?.split("/").pop() || "").filter(Boolean);
  const ratios = langRatios(contentText);

  return {
    finalUrl: pageUrl,
    title, metaDescription, robots, canonical, lang,
    h1, h2,
    words: wordCount(contentText),
    sections,
    internalLinks: [...internal].slice(0, 300),
    navLinkCount: Math.max(0, allLinks - internal.size),
    outboundDomains: [...outbound].slice(0, 100),
    schemaTypes: [...schemaTypes].slice(0, 20),
    images: {
      total: imgs.length,
      missingAlt: imgs.filter((a) => !(a.alt || "").trim()).length,
      nonWebp: files.filter((f) => /\.(jpe?g|png|gif)$/i.test(f)).length,
      files: files.slice(0, 60)
    },
    hasForm,
    ctaFound: cta || hasForm,
    elementor: /class=["'][^"']*\belementor\b/i.test(noComments) || /data-elementor-type/i.test(noComments),
    wordpress: /\/wp-content\/|\/wp-includes\//i.test(noComments),
    markers: [...new Set((fullText.match(MARKER_RE) || []).map((x) => x.slice(0, 60)))],
    blockHits: blockHitsIn(fullText + " " + head, files, rules),
    numbers: extractNumbers(contentText),
    lang_en: ratios.en,
    lang_de: ratios.de,
    text: contentText.slice(0, 1500)
  };
}
