// Agent HQ: trạng thái thật của từng agent, đọc từ việc, ý tưởng, nhật ký và chi tiêu.

import { json } from "./http";
import { PROMPTS, promptApproved } from "./manager";
import { RECOVERY_AGENTS } from "./recovery-analyze";
import { readRules } from "./recovery-rules";
import { getAuto } from "./content";
import type { Env } from "./types";

const CONTENT_AGENTS = [
  { id: "research", name: "Nghiên cứu từ khoá", icon: "search", role: "Lấy gợi ý từ khoá (DataForSEO), bỏ từ site đã có trang, chấm điểm theo lượng tìm, độ khó, ý định và trang dịch vụ liên quan." },
  { id: "architect", name: "Kiến trúc nội dung", icon: "layers", role: "Rà cấu trúc: mỗi trang dịch vụ có bao nhiêu bài hỗ trợ dẫn về, bài nào chưa gắn cụm, cụm nào còn thiếu." },
  { id: "planner", name: "Biên tập viên", icon: "list", role: "Lập dàn ý từ top Google và People Also Ask; nêu chỗ chủ site cần thêm kinh nghiệm thật." },
  { id: "writer", name: "Người viết", icon: "pen", role: "Viết bài nháp từ dàn ý đã duyệt, qua Gác cổng, tạo bản nháp WordPress. Không bao giờ tự đăng." }
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
  const content = CONTENT_AGENTS.map((a) => {
    const blockedPrompt = prompts.some((p) => p.agent === a.id && !p.ok);
    const waiting = a.id === "research" ? ideas.idea || 0 : a.id === "planner" ? ideas.approved || 0 : a.id === "writer" ? (ideas.briefed || 0) + (ideas.drafted || 0) : 0;
    return { ...a, zone: "content", last: lastOf(a.id), spend: costOf(a.id), blockedPrompt, state: agentState(a.id, { waiting, blockedPrompt }), waiting };
  });
  const autoSites = await Promise.all(cases.results.filter((c) => readRules(c.rules).autopilot).map(async (c) => ({ siteId: c.site_id, caseId: c.id, domain: c.domain, ...(await getAuto(env, c.site_id)) })));
  return json({
    manager: { promptsTotal: prompts.length, promptsPending: promptPending.length, spend: spend.results, last: recent.results.find((r) => r.actor === "agent:manager") || null },
    zones: { recovery, content },
    autopilot: { sites: autoSites, last: lastOf("autopilot") },
    ideas,
    recent: recent.results.slice(0, 25)
  });
}
