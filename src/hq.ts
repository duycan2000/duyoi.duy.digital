// Agent HQ: trạng thái thật của từng agent, đọc từ việc, ý tưởng, nhật ký và chi tiêu.

import { json } from "./http";
import { PROMPTS, promptApproved } from "./manager";
import { RECOVERY_AGENTS } from "./recovery-analyze";
import { readRules } from "./recovery-rules";
import { getAuto } from "./content";
import { formatOf, readProducts } from "./formats";
import { waitingInterview } from "./content";
import type { Env } from "./types";

const CONTENT_AGENTS = [
  { id: "research", name: "Nghiên cứu từ khoá", icon: "search", role: "Lấy gợi ý từ khoá (DataForSEO), bỏ từ site đã có trang, chấm điểm theo lượng tìm, độ khó, ý định và trang dịch vụ liên quan." },
  { id: "architect", name: "Kiến trúc nội dung", icon: "layers", role: "Rà cấu trúc: mỗi trang dịch vụ có bao nhiêu bài hỗ trợ dẫn về, bài nào chưa gắn cụm, cụm nào còn thiếu." },
  { id: "docs", name: "Đọc tài liệu", icon: "list", role: "Đọc PDF anh tải lên (catalog, bảng giá, hồ sơ, handover), rút Hồ sơ site: dịch vụ, sản phẩm, số liệu có nguồn, giọng văn, điều cấm, gợi ý bài kèm định dạng." },
  { id: "planner", name: "Lập dàn ý", icon: "list", role: "Lập dàn ý theo định dạng từ top Google, People Also Ask và Hồ sơ site; nêu chỗ chủ site cần thêm kinh nghiệm thật." },
  { id: "writer", name: "Người viết", icon: "pen", role: "Viết bài theo khung chuẩn (thông tin, Best X/Top N, review, so sánh, how-to, guide), chèn công khai affiliate, nút mua và ảnh thật anh tải lên, qua Gác cổng, tạo bản nháp WordPress. Không bao giờ tự đăng." },
  { id: "editor", name: "Biên tập viên", icon: "check", role: "Chấm bài nháp 0–100 theo khung định dạng và tiêu chí nội dung hữu ích (dùng model khác người viết), nêu lỗi cụ thể; dưới mức anh đặt thì Người viết sửa, tối đa 2 vòng." }
];

const OFFPAGE_AGENTS = [
  { id: "prospector", name: "Prospector", icon: "search", role: "Tìm nơi xin link miễn phí: trang \"write for us\", trang nhắc tên chưa link, trang tài nguyên và link chết; đọc trang, tìm email, bỏ nơi bán link hoặc traffic thấp. Site Đức không làm." },
  { id: "outreach_writer", name: "Outreach Writer", icon: "pen", role: "Soạn email ngắn, riêng cho từng trang và một follow-up; không nhắc tiền, không đổi link, không nhận đã test khi chưa test." },
  { id: "outreach_reviewer", name: "Outreach Reviewer", icon: "check", role: "Chấm thư (model khác), kiểm tra luật CAN-SPAM/UWG, link ngoài, số không nguồn; thư qua mới tới anh duyệt. Gửi từ email riêng của site, giãn thư, dừng follow-up khi có trả lời." },
  { id: "social", name: "Social Entity", icon: "globe", role: "Thấy bài mới trên sitemap thì viết bài chia sẻ cho Pinterest, Facebook, LinkedIn, X, Bluesky, qua Gác cổng rồi tự đăng (giãn lịch); giữ profile sameAs và schema Organization." },
  { id: "community", name: "Community Scout", icon: "users", role: "Tìm thread Reddit/Quora/gutefrage đúng chủ đề, chấm rủi ro, soạn câu trả lời. Anh tự đăng bằng tài khoản thật; agent không bao giờ đăng." },
  { id: "link_monitor", name: "Link Monitor", icon: "link", role: "Mỗi tuần mở trang nguồn của backlink đã có: còn link không, dofollow hay nofollow, anchor gì; báo khi mất link." },
  { id: "linkbuilder", name: "Link Builder (làm tay)", icon: "link", role: "Chuẩn bị sẵn cho anh làm tay: trả lời phóng viên, ảnh bị dùng không ghi nguồn, testimonial, hãng/nhà cung cấp, podcast, bài tổng hợp chuyên gia, hiệp hội, trang 404 còn backlink. Anh làm và đánh dấu." },
  { id: "citations", name: "Citations", icon: "list", role: "Danh bạ doanh nghiệp theo thị trường cho site dịch vụ có NAP thật; anh tự gửi (có xác minh), agent theo dõi trạng thái. Không tạo doanh nghiệp giả." }
];

export async function hqView(env: Env): Promise<Response> {
  const monthStart = (() => { const d = new Date(); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1); })();
  const [taskStats, ideaStats, spend, recent, prompts, cases] = await Promise.all([
    env.DB.prepare("SELECT agent, status, COUNT(*) AS n FROM recovery_tasks GROUP BY agent, status").all<{ agent: string; status: string; n: number }>(),
    env.DB.prepare("SELECT status, COUNT(*) AS n FROM content_ideas GROUP BY status").all<{ status: string; n: number }>(),
    env.DB.prepare("SELECT agent, SUM(cost_usd) AS cost, COUNT(*) AS calls FROM ai_calls WHERE at >= ? AND status = 'ok' GROUP BY agent").bind(monthStart).all<{ agent: string; cost: number; calls: number }>(),
    env.DB.prepare("SELECT actor, action, detail, at FROM activity WHERE actor LIKE 'agent:%' ORDER BY id DESC LIMIT 40").all<{ actor: string; action: string; detail: string; at: number }>(),
    Promise.all(PROMPTS.map(async (t) => ({ id: t.id, agent: t.agent, ok: (await promptApproved(env, t)).ok }))),
    env.DB.prepare("SELECT c.id, c.site_id, c.status, c.rules, c.pages_done, c.pages_total, s.domain FROM recovery_cases c JOIN sites s ON s.id = c.site_id WHERE c.id IN (SELECT MAX(id) FROM recovery_cases WHERE status != 'archived' GROUP BY site_id)").all<{ id: number; site_id: number; status: string; rules: string; pages_done: number; pages_total: number; domain: string }>()
  ]);
  const lastOf = (id: string) => recent.results.find((r) => r.actor === `agent:${id}`) || null;
  const costOf = (id: string) => spend.results.find((r) => r.agent === id) || { cost: 0, calls: 0 };
  const tasksOf = (id: string) => {
    const rows = taskStats.results.filter((r) => r.agent === id);
    const n = (s: string) => rows.filter((r) => r.status === s).reduce((a, r) => a + r.n, 0);
    return { open: n("proposed"), blocked: n("blocked"), approved: n("approved"), done: n("done") };
  };
  const scanning = cases.results.filter((c) => ["discovering", "scanning", "analyzing"].includes(c.status));
  const ideas = Object.fromEntries(ideaStats.results.map((r) => [r.status, r.n]));
  const promptPending = prompts.filter((p) => !p.ok);
  const agentState = (id: string, extra: { working?: boolean; waiting?: number; blockedPrompt?: boolean }) =>
    extra.blockedPrompt ? "blocked" : extra.working ? "working" : (extra.waiting || 0) > 0 ? "waiting" : "idle";

  const recovery = RECOVERY_AGENTS.map((a) => {
    const t = tasksOf(a.id);
    const blockedPrompt = prompts.some((p) => p.agent === a.id && !p.ok);
    return { ...a, zone: "recovery", tasks: t, last: lastOf(a.id), spend: costOf(a.id), blockedPrompt,
      state: agentState(a.id, { working: a.id === "doctor" && scanning.length > 0, waiting: t.open + t.approved, blockedPrompt }),
      detail: a.id === "doctor" && scanning.length ? `Đang quét ${scanning.map((c) => `${c.domain} (${c.pages_done}/${c.pages_total || "?"})`).join(", ")}` : "" };
  });
  // Việc chờ anh: bài cần sản phẩm, bài cần ảnh thật
  const act = await env.DB.prepare("SELECT i.id, i.keyword, i.status, i.format, i.products, i.gate, i.case_id, i.interview, i.author, s.domain, c.rules FROM content_ideas i JOIN sites s ON s.id = i.site_id LEFT JOIN recovery_cases c ON c.id = i.case_id WHERE i.status IN ('approved', 'briefed', 'drafted') AND i.wp_post_id IS NULL").all<{ id: number; keyword: string; status: string; format: string; products: string | null; gate: string | null; case_id: number; interview: string | null; author: string | null; domain: string; rules: string | null }>();
  const asks = act.results.flatMap((r) => {
    const f = formatOf(r.format);
    const out: { kind: "products" | "images" | "interview" | "author" | "owner_draft"; ideaId: number; caseId: number; keyword: string; domain: string; text: string }[] = [];
    const rr = readRules(r.rules || "{}");
    const iv = (() => { try { return r.interview ? JSON.parse(r.interview) : null; } catch { return null; } })();
    const who = r.author || (rr.authorMode === "ask" ? null : rr.authorMode);
    if (r.status === "briefed" && waitingInterview(iv, rr.requireInterview)) out.push({ kind: "interview", ideaId: r.id, caseId: r.case_id, keyword: r.keyword, domain: r.domain, text: `Trả lời ${iv.questions.length} câu phỏng vấn trải nghiệm (hoặc bỏ qua)` });
    else if (r.status === "briefed" && !who) out.push({ kind: "author", ideaId: r.id, caseId: r.case_id, keyword: r.keyword, domain: r.domain, text: "Chọn ai viết: agent hay anh tự viết bằng Claude" });
    else if (r.status === "briefed" && who === "owner") out.push({ kind: "owner_draft", ideaId: r.id, caseId: r.case_id, keyword: r.keyword, domain: r.domain, text: "Chờ bài anh viết bằng Claude (lấy gói yêu cầu, dán bài vào)" });
    if (r.status === "approved" && readProducts(r.products).items.length < f.minProducts) out.push({ kind: "products", ideaId: r.id, caseId: r.case_id, keyword: r.keyword, domain: r.domain, text: `Nhập ít nhất ${f.minProducts} sản phẩm (link affiliate, đã dùng thật chưa) cho bài ${f.label}` });
    const img = r.gate ? (JSON.parse(r.gate) as { problems: { rule: string; level: string; message: string }[] }).problems.find((p) => p.rule === "images" && p.level === "block") : null;
    if (r.status === "drafted" && img) out.push({ kind: "images", ideaId: r.id, caseId: r.case_id, keyword: r.keyword, domain: r.domain, text: img.message });
    return out;
  });
  const content = CONTENT_AGENTS.map((a) => {
    const blockedPrompt = prompts.some((p) => p.agent === a.id && !p.ok);
    const waiting = a.id === "research" ? ideas.idea || 0 : a.id === "planner" ? ideas.approved || 0 : a.id === "writer" ? (ideas.briefed || 0) + (ideas.drafted || 0) : 0;
    const mine = a.id === "writer" ? asks : [];
    const cnt = (k: string) => mine.filter((x) => x.kind === k).length;
    const detail = mine.length ? `Chờ anh: ${[[cnt("interview"), "phỏng vấn"], [cnt("author"), "chọn người viết"], [cnt("owner_draft"), "bài anh viết"], [cnt("images"), "cần ảnh thật"], [cnt("products"), "cần sản phẩm"]].filter(([n]) => n).map(([n, t]) => `${n} ${t}`).join(", ")}` : "";
    return { ...a, zone: "content", last: lastOf(a.id), spend: costOf(a.id), blockedPrompt, state: agentState(a.id, { waiting: waiting + mine.length, blockedPrompt }), waiting, detail };
  });
  const op = await env.DB.prepare(`SELECT (SELECT COUNT(*) FROM op_prospects WHERE status = 'new') AS prospects, (SELECT COUNT(*) FROM op_messages WHERE status = 'needs_fix') AS needsFix, (SELECT COUNT(*) FROM op_messages WHERE status = 'ready') AS ready,
    (SELECT COUNT(*) FROM op_messages WHERE status = 'approved') AS approved, (SELECT COUNT(*) FROM op_messages WHERE status = 'sent' AND sent_at > ?1) AS sent7, (SELECT COUNT(*) FROM op_messages WHERE status = 'replied') AS replied,
    (SELECT COUNT(*) FROM op_threads WHERE status = 'drafted') AS threads, (SELECT COUNT(*) FROM social_posts WHERE status = 'queued') AS queued, (SELECT COUNT(*) FROM social_posts WHERE status = 'posted' AND posted_at > ?1) AS posted7,
    (SELECT COUNT(*) FROM social_posts WHERE status IN ('failed', 'blocked')) AS postFail, (SELECT COUNT(*) FROM social_accounts WHERE status IN ('expired', 'choose_target')) AS accFix,
    (SELECT COUNT(*) FROM op_links WHERE status IN ('live', 'nofollow')) AS linksLive, (SELECT COUNT(*) FROM op_links WHERE status = 'missing') AS linksLost, (SELECT COUNT(*) FROM op_citations WHERE status = 'todo') AS citTodo, (SELECT COUNT(*) FROM op_manual WHERE status IN ('todo', 'doing')) AS manualTodo`).bind(Date.now() - 7 * 86400000).first<Record<string, number>>() || {} as Record<string, number>;
  const opAsks = await env.DB.prepare(`SELECT s.id AS siteId, s.domain, (SELECT COUNT(*) FROM op_messages WHERE site_id = s.id AND status = 'ready') AS emails, (SELECT COUNT(*) FROM op_threads WHERE site_id = s.id AND status = 'drafted') AS threads,
    (SELECT COUNT(*) FROM social_accounts WHERE site_id = s.id AND status IN ('expired', 'choose_target')) AS acc FROM sites s WHERE s.status = 'active'`).all<{ siteId: number; domain: string; emails: number; threads: number; acc: number }>();
  const offpageAsks = opAsks.results.flatMap((r) => [
    ...(r.emails ? [{ kind: "outreach", siteId: r.siteId, domain: r.domain, text: `${r.emails} email outreach chờ anh duyệt` }] : []),
    ...(r.threads ? [{ kind: "community", siteId: r.siteId, domain: r.domain, text: `${r.threads} câu trả lời Reddit/Quora chờ anh đọc và tự đăng` }] : []),
    ...(r.acc ? [{ kind: "social", siteId: r.siteId, domain: r.domain, text: "Tài khoản mạng xã hội cần kết nối lại hoặc chọn trang để đăng" }] : [])
  ]);
  const opWait: Record<string, number> = { prospector: op.prospects || 0, outreach_writer: op.needsFix || 0, outreach_reviewer: (op.ready || 0) + (op.approved || 0), social: (op.queued || 0) + (op.accFix || 0), community: op.threads || 0, link_monitor: op.linksLost || 0, citations: op.citTodo || 0, linkbuilder: op.manualTodo || 0 };
  const opDetail: Record<string, string> = {
    prospector: `${op.prospects || 0} nơi mới chưa soạn thư`,
    outreach_writer: op.needsFix ? `${op.needsFix} thư còn lỗi chặn cần sửa` : "",
    outreach_reviewer: `${op.ready || 0} chờ anh duyệt · ${op.approved || 0} đã duyệt chờ gửi · ${op.sent7 || 0} gửi 7 ngày · ${op.replied || 0} trả lời`,
    social: `${op.posted7 || 0} bài đăng 7 ngày · ${op.queued || 0} chờ đăng${op.postFail ? ` · ${op.postFail} lỗi/bị chặn` : ""}${op.accFix ? ` · ${op.accFix} tài khoản cần xử lý` : ""}`,
    community: `${op.threads || 0} câu trả lời chờ anh tự đăng`,
    link_monitor: `${op.linksLive || 0} link còn${op.linksLost ? ` · ${op.linksLost} mất` : ""}`,
    citations: `${op.citTodo || 0} danh bạ chưa gửi`,
    linkbuilder: `${op.manualTodo || 0} việc làm tay đã chuẩn bị`
  };
  const offpage = OFFPAGE_AGENTS.map((a) => {
    const blockedPrompt = prompts.some((p) => p.agent === a.id && !p.ok);
    return { ...a, zone: "offpage", last: lastOf(a.id), spend: costOf(a.id), blockedPrompt, state: agentState(a.id, { waiting: opWait[a.id] || 0, blockedPrompt }), waiting: opWait[a.id] || 0, detail: opDetail[a.id] || "" };
  });
  const autoSites = await Promise.all(cases.results.filter((c) => readRules(c.rules).autopilot).map(async (c) => ({ siteId: c.site_id, caseId: c.id, domain: c.domain, ...(await getAuto(env, c.site_id)) })));
  const jq = await env.DB.prepare("SELECT status, COUNT(*) AS n FROM agent_jobs GROUP BY status").all<{ status: string; n: number }>();
  const jobs = Object.fromEntries(jq.results.map((r) => [r.status, r.n])) as Record<string, number>;
  return json({
    lead: { queued: jobs.queued || 0, running: jobs.running || 0, done: jobs.done || 0, failed: jobs.failed || 0, blockedPrompt: prompts.some((p) => p.agent === "lead" && !p.ok), last: lastOf("lead"), spend: costOf("lead") },
    manager: { promptsTotal: prompts.length, promptsPending: promptPending.length, spend: spend.results, last: recent.results.find((r) => r.actor === "agent:manager") || null },
    zones: { recovery, content, offpage },
    offpageAsks,
    autopilot: { sites: autoSites, last: lastOf("autopilot") },
    ideas, asks,
    recent: recent.results.slice(0, 25)
  });
}
