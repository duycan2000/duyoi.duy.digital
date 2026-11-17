// Luật an toàn riêng của từng site, lưu trong recovery_cases.rules (JSON).
// Không đặt sẵn luật của khách nào trong code (repo công khai): anh nhập trong app.

import { HttpError } from "./http";

export interface SiteRules {
  language: string;            // ngôn ngữ duy nhất được viết trên site (de, en…)
  blocklist: string[];         // từ/cụm bị cấm xuất hiện (ví dụ tên công ty có thoả thuận pháp lý)
  blockedFilenames: string[];  // tên file ảnh bị cấm (hỗ trợ dấu * ở cuối)
  commercialPaths: string[];   // đường dẫn trang thương mại (dịch vụ, báo giá…) để dẫn traffic về
  relatedDomains: string[];    // site khác của anh: link chéo giữa các site này bị coi là dấu vết thao túng
  verifiedNumbers: string[];   // con số đã kiểm chứng được phép dùng lại (kèm nguồn trong ghi chú)
  toxicDomains: string[];      // domain backlink xấu (để lập file disavow)
  linksBought: boolean;        // site từng mua link / dùng PBN / dịch vụ link giá rẻ
  manualAction: boolean;       // Search Console có thông báo thao tác thủ công
  maxLinksPerPage: number;     // tối đa link nội bộ mới mỗi trang
  builder: "" | "elementor" | "gutenberg" | "classic";
  cachePlugin: string;         // flyingpress, wp-rocket… (xoá cache sau khi sửa)
  notes: string;
  gscProperty: string;         // sc-domain:ten-mien.de (Domain property) hoặc https://ten-mien.com/ (URL-prefix)
  ga4Property: string;         // ID số của property GA4
  seedKeywords: string[];      // từ khoá gốc cho nghiên cứu (mặc định lấy H1 các trang dịch vụ)
  minVolume: number;           // lượng tìm kiếm tối thiểu để giữ ý tưởng
  minQualityScore: number;     // điểm Biên tập viên tối thiểu (dưới mức này agent viết lại, tối đa 2 vòng)
  maxNewArticlesPerMonth: number; // giới hạn bài mới mỗi tháng (chống spam)
  autopilot: boolean;          // chế độ tự động cho site này
  autoRescanDays: number;      // quét lại sau bao nhiêu ngày
  autoApproveIdeas: boolean;   // tự duyệt chủ đề tốt nhất trong giới hạn tháng
  autoApplyApproved: boolean;  // tự áp dụng việc đã được người duyệt (tối đa 3 trang/ngày)
  authorMode: "ask" | "agent" | "owner"; // ai viết bài mới: hỏi anh từng bài / agent viết / anh tự viết bằng Claude
  requireInterview: boolean;   // agent chờ anh trả lời phỏng vấn trải nghiệm trước khi viết
  affiliateDisclosure: string; // câu công khai link affiliate đặt đầu bài (trống = câu mặc định theo ngôn ngữ)
  buyButtonText: string;       // chữ trên nút mua, {merchant} = tên nơi bán
}

export const DEFAULT_RULES: SiteRules = {
  language: "en",
  blocklist: [],
  blockedFilenames: [],
  commercialPaths: [],
  relatedDomains: [],
  verifiedNumbers: [],
  toxicDomains: [],
  linksBought: false,
  manualAction: false,
  maxLinksPerPage: 3,
  builder: "",
  cachePlugin: "",
  notes: "",
  gscProperty: "",
  ga4Property: "",
  seedKeywords: [],
  minVolume: 10,
  minQualityScore: 75,
  maxNewArticlesPerMonth: 2,
  autopilot: false,
  autoRescanDays: 7,
  autoApproveIdeas: false,
  autoApplyApproved: false,
  authorMode: "ask",
  requireInterview: true,
  affiliateDisclosure: "",
  buyButtonText: ""
};

const list = (v: unknown, max = 300, itemMax = 200): string[] => {
  const arr = Array.isArray(v) ? v : typeof v === "string" ? v.split(/\r?\n|,/) : [];
  return [...new Set(arr.map((x) => String(x).trim()).filter(Boolean).map((x) => x.slice(0, itemMax)))].slice(0, max);
};

const domainList = (v: unknown): string[] =>
  list(v, 2000).map((d) => d.toLowerCase().replace(/^domain:/, "").replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "")).filter((d) => /^([a-z0-9-]+\.)+[a-z]{2,}$/.test(d));

const pathList = (v: unknown): string[] =>
  list(v).map((p) => {
    try { if (/^https?:\/\//.test(p)) p = new URL(p).pathname; } catch { /* giữ nguyên */ }
    p = p.startsWith("/") ? p : `/${p}`;
    return p.endsWith("/") ? p : `${p}/`;
  });

export function parseRules(input: unknown, base: SiteRules = DEFAULT_RULES): SiteRules {
  const b = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const out: SiteRules = { ...base };
  if (b.language !== undefined) {
    const l = String(b.language).toLowerCase().trim();
    if (!/^[a-z]{2}$/.test(l)) throw new HttpError(400, "Ngôn ngữ dạng de, en, vi…", "validation");
    out.language = l;
  }
  if (b.blocklist !== undefined) out.blocklist = list(b.blocklist);
  if (b.blockedFilenames !== undefined) out.blockedFilenames = list(b.blockedFilenames);
  if (b.commercialPaths !== undefined) out.commercialPaths = pathList(b.commercialPaths);
  if (b.relatedDomains !== undefined) out.relatedDomains = domainList(b.relatedDomains);
  if (b.verifiedNumbers !== undefined) out.verifiedNumbers = list(b.verifiedNumbers);
  if (b.toxicDomains !== undefined) out.toxicDomains = domainList(b.toxicDomains);
  if (b.linksBought !== undefined) out.linksBought = b.linksBought === true;
  if (b.manualAction !== undefined) out.manualAction = b.manualAction === true;
  if (b.maxLinksPerPage !== undefined) {
    const n = Number(b.maxLinksPerPage);
    if (!Number.isInteger(n) || n < 1 || n > 3) throw new HttpError(400, "Số link mới mỗi trang tối đa là 1–3.", "validation");
    out.maxLinksPerPage = n;
  }
  if (b.builder !== undefined) {
    const v = String(b.builder);
    if (!["", "elementor", "gutenberg", "classic"].includes(v)) throw new HttpError(400, "Trình dựng trang không hợp lệ.", "validation");
    out.builder = v as SiteRules["builder"];
  }
  if (b.cachePlugin !== undefined) out.cachePlugin = String(b.cachePlugin).trim().slice(0, 40);
  if (b.notes !== undefined) out.notes = String(b.notes).slice(0, 3000);
  if (b.gscProperty !== undefined) {
    const v = String(b.gscProperty).trim();
    if (v && !/^sc-domain:([a-z0-9-]+\.)+[a-z]{2,}$/i.test(v) && !/^https?:\/\/[^\s]+\/$/i.test(v)) throw new HttpError(400, "Property Search Console dạng sc-domain:ten-mien.de hoặc https://ten-mien.com/ (có dấu / ở cuối).", "validation");
    out.gscProperty = v;
  }
  if (b.seedKeywords !== undefined) out.seedKeywords = list(b.seedKeywords, 20, 80).map((k) => k.toLowerCase());
  const int = (v: unknown, min: number, max: number, field: string) => { const n = Number(v); if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, `${field} phải từ ${min} đến ${max}.`, "validation"); return n; };
  if (b.minQualityScore !== undefined) out.minQualityScore = int(b.minQualityScore, 60, 95, "Điểm chất lượng tối thiểu");
  if (b.minVolume !== undefined) out.minVolume = int(b.minVolume, 0, 100000, "Lượng tìm kiếm tối thiểu");
  if (b.maxNewArticlesPerMonth !== undefined) out.maxNewArticlesPerMonth = int(b.maxNewArticlesPerMonth, 0, 8, "Số bài mới mỗi tháng");
  if (b.autoRescanDays !== undefined) out.autoRescanDays = int(b.autoRescanDays, 3, 60, "Số ngày quét lại");
  if (b.autopilot !== undefined) out.autopilot = b.autopilot === true;
  if (b.autoApproveIdeas !== undefined) out.autoApproveIdeas = b.autoApproveIdeas === true;
  if (b.authorMode !== undefined) out.authorMode = (["ask", "agent", "owner"] as const).find((x) => x === b.authorMode) || "ask";
  if (b.requireInterview !== undefined) out.requireInterview = b.requireInterview === true;
  if (b.autoApplyApproved !== undefined) out.autoApplyApproved = b.autoApplyApproved === true;
  if (b.affiliateDisclosure !== undefined) out.affiliateDisclosure = String(b.affiliateDisclosure).trim().slice(0, 500);
  if (b.buyButtonText !== undefined) out.buyButtonText = String(b.buyButtonText).trim().slice(0, 60);
  if (b.ga4Property !== undefined) {
    const v = String(b.ga4Property).trim().replace(/^properties\//, "");
    if (v && !/^\d{5,15}$/.test(v)) throw new HttpError(400, "GA4 property là dãy số (Admin › Property details › Property ID).", "validation");
    out.ga4Property = v;
  }
  return out;
}

export function readRules(json: string | null | undefined): SiteRules {
  try { return parseRules(JSON.parse(json || "{}")); } catch { return { ...DEFAULT_RULES }; }
}
