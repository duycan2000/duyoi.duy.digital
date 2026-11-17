// Gác cổng: kiểm tra mọi đề xuất sửa trước khi được phép ghi lên site.
// Vi phạm luật cứng = chặn (blocked). Cảnh báo = vẫn cho duyệt nhưng hiện rõ cho người duyệt.

import { blockHitsIn, extractNumbers, langRatios, MARKER_RE } from "./recovery-extract";
import type { SiteRules } from "./recovery-rules";

export interface Edit {
  find: string;
  replace: string;
  section?: string;
  type: "internal_link" | "cta" | "meta_title" | "meta_description" | "text";
  target?: string;  // path trang đích (link nội bộ)
  anchor?: string;
}

export interface GateProblem { rule: string; level: "block" | "warn"; message: string }
export interface GateResult { ok: boolean; checkedAt: number; problems: GateProblem[] }

export interface GateContext {
  rules: SiteRules;
  pageNumbers: string[];                       // số liệu đã có trên trang gốc
  occurrences?: (find: string) => number;      // đếm số lần find khớp trong nội dung thật
  elementor?: boolean;
  targetText?: (path: string) => string;       // tiêu đề/H1 trang đích để so nghĩa anchor
}

const STOP = new Set("und der die das für mit von zu im in den the and for with of to a an our ihre unsere ihr your".split(" "));
const tokens = (s: string): string[] =>
  (s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").match(/[a-z0-9äöüß]+/g) || []).filter((w) => w.length > 2 && !STOP.has(w));

// Phần chữ mới được thêm vào (replace bỏ đi find)
export const addedText = (e: Edit): string => (e.replace.includes(e.find) ? e.replace.replace(e.find, " ") : e.replace).replace(/<[^>]+>/g, " ");

export function checkEdits(edits: Edit[], ctx: GateContext): GateResult {
  const problems: GateProblem[] = [];
  const p = (rule: string, level: GateProblem["level"], message: string) => problems.push({ rule, level, message });
  const { rules } = ctx;
  const links = edits.filter((e) => e.type === "internal_link").length;
  if (links > rules.maxLinksPerPage) p("max_links", "block", `Quá ${rules.maxLinksPerPage} link nội bộ mới trên một trang (${links}).`);

  for (const [i, e] of edits.entries()) {
    const n = i + 1;
    const add = addedText(e);
    // 1. Blocklist pháp lý
    const hits = blockHitsIn(`${e.replace} ${e.anchor || ""}`, (e.replace.match(/[\w.-]+\.(?:png|jpe?g|webp|gif)/gi) || []), rules);
    if (hits.length) p("blocklist", "block", `Sửa #${n} chứa từ bị cấm: ${hits.join(", ")}.`);
    // 2. Dấu biên tập còn sót
    const marks = add.match(MARKER_RE);
    if (marks) p("markers", "block", `Sửa #${n} còn dấu biên tập: ${[...new Set(marks)].join(", ")}.`);
    // 3. Sửa phẫu thuật: replace phải giữ nguyên find
    if (e.type !== "meta_title" && e.type !== "meta_description") {
      if (!e.find.trim()) p("find_empty", "block", `Sửa #${n} không có đoạn gốc để tìm.`);
      else if (!e.replace.includes(e.find)) p("surgical", "block", `Sửa #${n} làm mất chữ gốc: replace phải chứa nguyên văn đoạn find.`);
      const occ = ctx.occurrences ? ctx.occurrences(e.find) : 1;
      if (occ !== 1) p("unique_find", "block", `Sửa #${n}: đoạn gốc khớp ${occ} lần trên trang (phải đúng 1 lần).`);
    }
    // 4. Ngôn ngữ
    if (add.trim().split(/\s+/).length >= 4) {
      const r = langRatios(add);
      if (rules.language === "de" && r.en > r.de && r.en > 0.08) p("language", "block", `Sửa #${n} có vẻ là tiếng Anh, site này chỉ viết tiếng Đức.`);
      if (rules.language === "en" && r.de > r.en && r.de > 0.08) p("language", "block", `Sửa #${n} có vẻ là tiếng Đức, site này viết tiếng Anh.`);
    }
    // 5. Số liệu không có nguồn
    const allowed = new Set([...ctx.pageNumbers, ...rules.verifiedNumbers.flatMap(extractNumbers)].map((x) => x.toLowerCase()));
    const unsourced = extractNumbers(add).filter((x) => !allowed.has(x));
    if (unsourced.length) p("numbers", "block", `Sửa #${n} có số liệu chưa có nguồn: ${unsourced.join(", ")}. Dùng chữ định tính hoặc ghi nguồn đã kiểm chứng.`);
    // 6. Giới hạn độ dài meta
    if (e.type === "meta_title" && e.replace.length > 60) p("length", "warn", `Title ${e.replace.length} ký tự (nên ≤ 60).`);
    if (e.type === "meta_description" && e.replace.length > 155) p("length", "warn", `Meta description ${e.replace.length} ký tự (nên ≤ 155).`);
    // 7. Anchor phải đúng nghĩa với trang đích
    if (e.type === "internal_link" && e.target && e.anchor && ctx.targetText) {
      const want = new Set(tokens(`${ctx.targetText(e.target)} ${e.target.replace(/[-/]/g, " ")}`));
      const overlap = tokens(e.anchor).filter((w) => want.has(w) || [...want].some((x) => x.length > 4 && (x.startsWith(w) || w.startsWith(x))));
      if (!overlap.length) p("anchor_match", "warn", `Anchor "${e.anchor}" không khớp nghĩa với trang đích ${e.target}.`);
    }
    if (/click here|hier klicken|mehr erfahren$/i.test(e.anchor || "")) p("anchor_generic", "block", `Anchor #${n} quá chung chung.`);
  }
  if (ctx.elementor) p("elementor", "warn", "Trang dựng bằng Elementor: chỉ được sửa trong _elementor_data, không ghi vào post_content.");
  return { ok: !problems.some((x) => x.level === "block"), checkedAt: Date.now(), problems };
}
