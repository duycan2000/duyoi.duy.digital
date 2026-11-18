// Định dạng bài chuẩn cho agent: bài thông tin, roundup "Best X for Y / Top N", review 1 sản phẩm, so sánh X vs Y, how-to, guide.
// Dựa trên hướng dẫn "Write high quality reviews" của Google (bằng chứng trải nghiệm thật, ưu/nhược, so sánh, link nhiều nơi bán,
// lý do cho từng lựa chọn trong danh sách xếp hạng), yêu cầu công khai link affiliate của FTC ("paid link", đặt trước link đầu tiên)
// và rel="sponsored" cho link affiliate. Không dùng schema HowTo/FAQ (Google đã bỏ rich result của hai loại này).
// Khung định dạng (spec) được ghép vào prompt qua {{FORMAT}} và tính vào phiên bản prompt: sửa khung là phải duyệt lại.

import { extractNumbers } from "./recovery-extract";
import { draftChecks } from "./semantic";
import type { GateProblem } from "./recovery-gate";
import type { SiteRules } from "./recovery-rules";

export type FormatId = "article" | "roundup" | "review" | "comparison" | "how_to" | "guide";

export interface Product {
  name: string; url: string; merchant: string; links: { merchant: string; url: string }[];
  bestFor: string; tested: boolean; notes: string; specs: string; pros: string; cons: string;
}
export interface Products { method: string; items: Product[] }
export interface UploadedImage { id: number; url: string; alt: string; caption: string; source: "own" | "maker" | "screenshot"; width: number | null; height: number | null; at: number; by: string }
export interface Slot { key: string; label: string; required: boolean; image: UploadedImage | null }

export interface Format {
  id: FormatId; label: string; hint: string; affiliate: boolean;
  minProducts: number; maxProducts: number; minWords: number; spec: string;
}

export const FORMATS: Format[] = [
  {
    id: "article", label: "Bài thông tin", hint: "Trả lời một câu hỏi, dẫn về trang dịch vụ/trang tiền.", affiliate: false, minProducts: 0, maxProducts: 0, minWords: 600,
    spec: "INFORMATIONAL ARTICLE that supports a money/service page. Open with a 2-3 sentence direct answer to the search query. Each <h2> answers one sub-question with practical specifics. One natural link to the service page. FAQ only from the real questions in the input."
  },
  {
    id: "roundup", label: "Best X / Top N", hint: "Danh sách xếp hạng sản phẩm, có link affiliate, ảnh thật từng sản phẩm.", affiliate: true, minProducts: 3, maxProducts: 10, minWords: 900,
    spec: [
      "ROUNDUP ('Best X for Y' / 'Top N'). Picks come ONLY from input.products, in the given order; never add or drop products.",
      "1) <p> intro, 2-3 sentences: who the list is for and how the picks were chosen, using only input.method and owner notes.",
      "2) [[DISCLOSURE]] alone on its own line right after the intro.",
      "3) <h2> quick picks: a <table> with columns Pick | Best for | Why (one short reason), one row per product.",
      "4) <h2> how the picks were chosen: the criteria that matter for this purchase.",
      "5) For each product n (1-based): <h2>n. {name}: {best_for}</h2>, then [[IMG:p{n}]], a short paragraph on who it suits, <h3> what stands out (from specs and owner notes), <h3> drawbacks (at least one honest drawback), a <ul> of key specs copied only from input specs, then [[BUY:{n}]].",
      "6) <h2> comparison <table> of key attributes, values only from input specs ('-' when unknown).",
      "7) <h2> buying guide: 3-6 decision factors explained.",
      "8) <h2> FAQ: 3-5 questions from people_also_ask, short answers.",
      "9) <h2> verdict: which pick for which situation, each with its reason."
    ].join("\n")
  },
  {
    id: "review", label: "Review 1 sản phẩm", hint: "Đánh giá một sản phẩm anh đã dùng thật; cần ghi chú trải nghiệm và ảnh thật.", affiliate: true, minProducts: 1, maxProducts: 4, minWords: 900,
    spec: [
      "SINGLE PRODUCT REVIEW of input.products[0]; the other products are alternatives.",
      "1) <p> intro with the verdict in 2 sentences. 2) [[DISCLOSURE]] alone on its own line. 3) [[IMG:hero]].",
      "4) <h2> verdict: a <ul> of pros and a <ul> of cons, from owner notes, pros and cons.",
      "5) <h2> who it is for and who should skip it.",
      "6) One <h2> per decision factor describing the owner's real experience from owner notes (first person plural only for what the notes say was done); put [[IMG:use]] in the most relevant section.",
      "7) <h2> key specs: <ul> from input specs only.",
      "8) <h2> alternatives: each alternative n and when it is the better choice, followed by [[BUY:{n}]].",
      "9) <h2> FAQ 3-5 from people_also_ask. 10) <h2> final verdict, then [[BUY:1]]."
    ].join("\n")
  },
  {
    id: "comparison", label: "So sánh X vs Y", hint: "So sánh 2–4 sản phẩm theo từng tiêu chí, nói rõ ai nên chọn cái nào.", affiliate: true, minProducts: 2, maxProducts: 4, minWords: 800,
    spec: [
      "COMPARISON (X vs Y) of input.products.",
      "1) <p> quick answer: which to pick for which need, 2-3 sentences. 2) [[DISCLOSURE]] alone on its own line.",
      "3) <h2> at a glance: a <table> of attributes by product, values from input specs only ('-' when unknown).",
      "4) One <h2> per decision factor comparing the products, ending with a one-line winner for that factor and why.",
      "5) For each product n: <h2>{name}: who should buy it</h2>, [[IMG:p{n}]], 2-4 sentences, then [[BUY:{n}]].",
      "6) <h2> FAQ 3-5 from people_also_ask. 7) <h2> bottom line."
    ].join("\n")
  },
  {
    id: "how_to", label: "How-to", hint: "Hướng dẫn từng bước; ảnh thật cho các bước quan trọng.", affiliate: false, minProducts: 0, maxProducts: 6, minWords: 500,
    spec: [
      "HOW-TO.",
      "1) <p> one paragraph: what the reader will achieve and the short version of the method.",
      "2) <h2> what you need: a <ul> of tools and materials (if input.products is given, mention them and add [[BUY:{n}]] after the list).",
      "3) <h2> steps: for each step <h3>Step n: {action}</h3> with 1-3 short paragraphs or a list saying exactly what to do and how to check it worked; put [[IMG:s{n}]] right after the <h3> when input.photo_slots contains s{n}.",
      "4) <h2> common mistakes and how to avoid them. 5) <h2> troubleshooting: problem, then fix.",
      "6) <h2> FAQ 3-5 from people_also_ask. 7) final <p> with the next step, linking the service/money page.",
      "Never state times, durations or quantities unless they are in the input."
    ].join("\n")
  },
  {
    id: "guide", label: "Guide / cẩm nang", hint: "Cẩm nang đầy đủ hoặc hướng dẫn chọn mua, từ cơ bản đến nâng cao.", affiliate: false, minProducts: 0, maxProducts: 6, minWords: 900,
    spec: [
      "GUIDE (complete guide or buyer's guide).",
      "1) <p> 2-3 sentence summary. 2) <h2> key takeaways: a <ul> of 4-6 bullets.",
      "3) <h2> sections from basics to advanced, each answering one question readers actually have, with practical examples; put [[IMG:g{n}]] where input.photo_slots lists g{n}.",
      "4) <h2> decision checklist: a <ul>. 5) <h2> FAQ 3-5 from people_also_ask.",
      "One natural link to the service/money page. If input.products is given, add [[DISCLOSURE]] after the summary and [[BUY:{n}]] where a product is recommended."
    ].join("\n")
  }
];

export const COMMON_SPEC = [
  "TOKENS: write [[DISCLOSURE]], [[BUY:n]] and [[IMG:key]] exactly as given, each alone in its own line, never inside a sentence; the system replaces them with the disclosure, buy buttons and real photos. Never write affiliate or shop URLs yourself.",
  "Never claim you or the team tested, tried or used a product unless that product has tested=true; then describe only what owner_notes say. Never write prices, discounts or star ratings. Never invent specs.",
  "'Best' may appear only as the search phrase in the title or when naming a pick together with its reason."
].join("\n");

export const formatOf = (id: string | null | undefined): Format => FORMATS.find((f) => f.id === id) || FORMATS[0]!;
export const formatSpec = (id: string): string => `FORMAT\n${formatOf(id).spec}\n${COMMON_SPEC}`;
export const ALL_SPECS = (): string => FORMATS.map((f) => f.spec).join("\n") + COMMON_SPEC;

// Đoán định dạng từ từ khoá (anh đổi được)
export function detectFormat(keyword: string): FormatId {
  const k = ` ${keyword.toLowerCase()} `;
  if (/\s(vs\.?|versus)\s/.test(k)) return "comparison";
  if (/\s(how to|how do i|wie man|wie kann|anleitung|cách|hướng dẫn)\s|^ (how|wie) /.test(k)) return "how_to";
  if (/\s(best|beste[nrs]?|die besten|top( \d+)?|tốt nhất|vergleich|test)\s/.test(k)) return "roundup";
  if (/\s(review|erfahrungen?|đánh giá)\s/.test(k)) return "review";
  if (/\s(guide|ratgeber|leitfaden|kaufberatung|cẩm nang|what is|was ist)\s/.test(k)) return "guide";
  return "article";
}

const cut = (v: unknown, n: number) => String(v ?? "").trim().slice(0, n);
const httpsUrl = (v: unknown) => { const s = cut(v, 600); try { const u = new URL(s); return u.protocol === "https:" || u.protocol === "http:" ? u.href : ""; } catch { return ""; } };

export function parseProducts(input: unknown): Products {
  const b = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const items = (Array.isArray(b.items) ? b.items : []).slice(0, 10).map((x) => {
    const p = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
    return {
      name: cut(p.name, 120), url: httpsUrl(p.url), merchant: cut(p.merchant, 40),
      links: (Array.isArray(p.links) ? p.links : []).slice(0, 3).map((l) => ({ merchant: cut((l as Record<string, unknown>)?.merchant, 40), url: httpsUrl((l as Record<string, unknown>)?.url) })).filter((l) => l.url && l.merchant),
      bestFor: cut(p.bestFor, 80), tested: p.tested === true, notes: cut(p.notes, 2000), specs: cut(p.specs, 1200), pros: cut(p.pros, 600), cons: cut(p.cons, 600)
    };
  }).filter((p) => p.name);
  return { method: cut(b.method, 1000), items };
}
export const readProducts = (s: string | null): Products => { try { return parseProducts(JSON.parse(s || "{}")); } catch { return { method: "", items: [] }; } };
export const readImages = (s: string | null): Record<string, UploadedImage> => { try { return JSON.parse(s || "{}") || {}; } catch { return {}; } };

// Ảnh thật agent cần: sản phẩm (bắt buộc với bài affiliate), các bước how-to và ảnh minh hoạ guide (do dàn ý đề xuất)
// needHero: theme của site (Astro) bắt buộc ảnh đại diện trong frontmatter
export function slotsFor(format: FormatId, products: Products, photoRequests: { key: string; what: string }[], images: Record<string, UploadedImage>, needHero = false): Slot[] {
  const s: Omit<Slot, "image">[] = [];
  if (format === "roundup" || format === "comparison") products.items.forEach((p, i) => s.push({ key: `p${i + 1}`, label: `Ảnh thật của ${p.name} (tự chụp, hoặc ảnh nhà sản xuất có quyền dùng)`, required: true }));
  if (format === "review" && products.items[0]) {
    s.push({ key: "hero", label: `Ảnh thật toàn cảnh ${products.items[0].name}`, required: true });
    s.push({ key: "use", label: `Ảnh lúc anh đang dùng ${products.items[0].name}`, required: true });
  }
  if (format === "how_to" || format === "guide") for (const r of photoRequests.slice(0, 8)) if (/^[sg]\d{1,2}$/.test(r.key)) s.push({ key: r.key, label: r.what.slice(0, 160), required: false });
  if (needHero && !s.some((x) => x.key === "hero")) s.unshift({ key: "hero", label: "Ảnh đại diện của bài (theme của site bắt buộc)", required: true });
  return s.map((x) => ({ ...x, image: images[x.key] || null }));
}

const LANG: Record<string, { disclosure: string; button: string; own: string; maker: string; shot: string }> = {
  en: { disclosure: "Disclosure: this article contains paid links. If you buy through them, we may earn a commission at no extra cost to you. It does not change which products we recommend.", button: "Check price at {merchant}", own: "Photo: our own", maker: "Image: manufacturer", shot: "Screenshot" },
  de: { disclosure: "Hinweis: Dieser Artikel enthält Affiliate-Links (Werbung). Kaufen Sie über einen dieser Links, erhalten wir eine Provision. Für Sie ändert sich der Preis nicht.", button: "Bei {merchant} ansehen", own: "Foto: eigene Aufnahme", maker: "Bild: Hersteller", shot: "Screenshot" },
  vi: { disclosure: "Bài viết có link tiếp thị liên kết (link trả phí): nếu bạn mua qua link, chúng tôi có thể nhận hoa hồng, giá với bạn không đổi.", button: "Xem giá tại {merchant}", own: "Ảnh: tự chụp", maker: "Ảnh: nhà sản xuất", shot: "Ảnh chụp màn hình" }
};
const L = (lang: string) => LANG[lang] || LANG.en!;
export const defaultDisclosure = (lang: string) => L(lang).disclosure;
const escA = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Thay token bằng câu công khai, nút mua (rel="sponsored nofollow") và ảnh thật. preview=true: hiện chỗ ảnh còn thiếu.
export function renderDraft(raw: string, o: { format: FormatId; products: Products; slots: Slot[]; rules: SiteRules; preview: boolean }): string {
  const f = formatOf(o.format);
  const lang = o.rules.language || "en";
  let h = raw;
  const needDisc = f.affiliate || (o.products.items.length > 0 && /\[\[BUY:\d+\]\]/.test(h));
  if (needDisc && !h.includes("[[DISCLOSURE]]")) h = h.replace(/<\/p>/, "</p>[[DISCLOSURE]]");
  if (!needDisc) h = h.replace(/\[\[DISCLOSURE\]\]/g, "");
  // Ảnh sản phẩm agent quên đặt: chèn ngay trước nút mua của sản phẩm đó
  o.products.items.forEach((_, i) => { const n = i + 1; if (!h.includes(`[[IMG:p${n}]]`) && o.slots.some((s) => s.key === `p${n}`)) h = h.replace(`[[BUY:${n}]]`, `[[IMG:p${n}]][[BUY:${n}]]`); });
  const disclosure = (o.rules.affiliateDisclosure || defaultDisclosure(lang)).trim();
  h = h.replace(/(?:<p>\s*)?\[\[DISCLOSURE\]\](?:\s*<\/p>)?/, `<p class="affiliate-disclosure"><em>${escA(disclosure)}</em></p>`).replace(/(?:<p>\s*)?\[\[DISCLOSURE\]\](?:\s*<\/p>)?/g, "");
  const btn = (merchant: string) => (o.rules.buyButtonText || L(lang).button).replace("{merchant}", merchant || "shop");
  h = h.replace(/(?:<p>\s*)?\[\[BUY:(\d+)\]\](?:\s*<\/p>)?/g, (_m, n: string) => {
    const p = o.products.items[Number(n) - 1];
    if (!p || !p.url) return "";
    const links = [{ merchant: p.merchant, url: p.url }, ...p.links];
    return `<p class="buy-buttons">${links.map((l) => `<a class="buy-button" href="${escA(l.url)}" rel="sponsored nofollow noopener" target="_blank">${escA(btn(l.merchant))}</a>`).join(" ")}</p>`;
  });
  h = h.replace(/(?:<p>\s*)?\[\[IMG:([a-z0-9]+)\]\](?:\s*<\/p>)?/g, (_m, key: string) => {
    const s = o.slots.find((x) => x.key === key);
    if (!s) return "";
    if (!s.image) return o.preview ? `<p><em>⟪Ảnh thật cần có${s.required ? "" : " (nên có)"}: ${escA(s.label)}⟫</em></p>` : "";
    const im = s.image;
    const credit = im.source === "own" ? L(lang).own : im.source === "maker" ? L(lang).maker : L(lang).shot;
    const size = im.width && im.height ? ` width="${im.width}" height="${im.height}"` : "";
    return `<figure class="wp-block-image"><img src="${escA(im.url)}" alt="${escA(im.alt)}"${size} loading="lazy"><figcaption>${escA(im.caption ? `${im.caption} · ${credit}` : credit)}</figcaption></figure>`;
  });
  return h.replace(/\[\[[A-Z]+(?::[a-z0-9]+)?\]\]/gi, "");
}

const TEST_RE = /\b(we|i)\s+(have\s+)?(tested|tried|used|reviewed)\b|\bhands[- ]on\b|\bin our tests?\b|\bour testing\b|\bwir haben\b[^.]{0,40}\b(getestet|ausprobiert|genutzt)\b|\bim (praxis)?test\b|\bunser(em)? test\b|chúng tôi đã (dùng|thử|test)/i;

// Luật riêng theo định dạng, bổ sung cho Gác cổng bài viết
export function checkFormat(o: { format: FormatId; title: string; html: string; products: Products; slots: Slot[]; rules: SiteRules }): GateProblem[] {
  const f = formatOf(o.format);
  const out: GateProblem[] = [];
  const items = o.products.items;
  const text = o.html.replace(/<[^>]+>/g, " ");
  if (items.length < f.minProducts) out.push({ rule: "products", level: "block", message: `Định dạng ${f.label} cần ít nhất ${f.minProducts} sản phẩm (có ${items.length}).` });
  if (f.affiliate) {
    const noUrl = items.filter((p) => !p.url).map((p) => p.name);
    if (noUrl.length) out.push({ rule: "products", level: "block", message: `Sản phẩm chưa có link: ${noUrl.join(", ")}.` });
    if (!o.html.includes("affiliate-disclosure")) out.push({ rule: "disclosure", level: "block", message: "Thiếu câu công khai link affiliate ở đầu bài." });
  }
  const tested = items.filter((p) => p.tested);
  const claims = TEST_RE.test(text) || /\btest(ed)?\b/i.test(o.title);
  if (claims && !tested.length) out.push({ rule: "tested", level: "block", message: "Bài nói đã test/dùng thử nhưng chưa sản phẩm nào được anh đánh dấu là đã dùng thật. Sửa bài hoặc đánh dấu (chỉ khi thật)." });
  else if (claims && tested.length < items.length) out.push({ rule: "tested", level: "warn", message: `Kiểm tra câu "đã test" chỉ nói về: ${tested.map((p) => p.name).join(", ")}.` });
  if (o.format === "review" && (!items[0]?.tested || (items[0]?.notes || "").length < 80)) out.push({ rule: "experience", level: "block", message: "Bài review cần anh đã dùng thật sản phẩm chính và ghi trải nghiệm (ít nhất vài câu)." });
  const missing = o.slots.filter((s) => s.required && !s.image);
  if (missing.length) out.push({ rule: "images", level: "block", message: `Thiếu ${missing.length} ảnh thật: ${missing.map((s) => s.label.split(" (")[0]).join("; ")}. Tải lên ở mục Ảnh thật.` });
  if ((o.format === "how_to" || o.format === "guide") && o.slots.length && !o.slots.some((s) => s.image)) out.push({ rule: "images", level: "warn", message: "Chưa có ảnh thật nào cho bài này: nên thêm ảnh các bước quan trọng." });
  const amazon = items.some((p) => [p.url, ...p.links.map((l) => l.url)].some((u) => /amazon\.|amzn\.to/i.test(u)));
  if (amazon) out.push({ rule: "amazon", level: "warn", message: "Có link Amazon: site cần câu \"As an Amazon Associate I earn from qualifying purchases\" (trong bài hoặc chân trang); không tải ảnh từ Amazon lên site; không ghi giá cố định." });
  out.push(...draftChecks(o.title, o.html, o.rules.language));
  return out;
}

// Số trong dữ liệu sản phẩm do anh nhập được coi là có nguồn
export const productNumbers = (p: Products): string[] => p.items.flatMap((x) => extractNumbers(`${x.name} ${x.specs} ${x.notes} ${x.pros} ${x.cons}`));
