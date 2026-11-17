// Chế độ tự động: cron 15 phút làm tiếp việc cho các site bật autopilot.
// Mỗi lượt chỉ làm 1 bước nặng cho mỗi site (giữ chi phí và thời gian chạy thấp). Mọi bước AI/DataForSEO qua Quản lý.
// Không bao giờ tự đăng bài hay tự duyệt việc sửa site; chỉ tự áp dụng việc NGƯỜI đã duyệt nếu anh bật lựa chọn đó.

import { logActivity } from "./activity";
import { approveIdeaCore, briefCore, draftCore, getAuto, researchCore, setAuto, wpDraftCore } from "./content";
import { aiRewriteCore, applyCore, processCase, resetForRescan } from "./recovery";
import { readRules } from "./recovery-rules";
import { getSettingsMap } from "./settings";
import type { Env } from "./types";

const DAY = 86400000;

interface CaseLite { id: number; site_id: number; status: string; rules: string; finished_at: number | null; domain: string }

export async function runAutopilot(env: Env, maxSites = 3): Promise<void> {
  const settings = await getSettingsMap(env);
  if (settings.paused) return;
  const { results } = await env.DB.prepare(
    "SELECT c.id, c.site_id, c.status, c.rules, c.finished_at, s.domain FROM recovery_cases c JOIN sites s ON s.id = c.site_id WHERE c.id IN (SELECT MAX(id) FROM recovery_cases WHERE status != 'archived' GROUP BY site_id) AND s.status = 'active'"
  ).all<CaseLite>();
  const sites = results.filter((c) => readRules(c.rules).autopilot);
  // Site chạy lâu nhất chưa tới lượt được làm trước
  const withState = await Promise.all(sites.map(async (c) => ({ c, st: await getAuto(env, c.site_id) })));
  withState.sort((a, b) => Number(a.st.lastRun || 0) - Number(b.st.lastRun || 0));
  for (const { c } of withState.slice(0, maxSites)) {
    try { await step(env, c); }
    catch (e) {
      const msg = String((e as Error).message || e).slice(0, 300);
      const st = await getAuto(env, c.site_id);
      if (st.lastError !== msg) await logActivity(env, "agent:autopilot", "autopilot.error", `${c.domain}: ${msg}`, c.site_id);
      await setAuto(env, c.site_id, { lastRun: Date.now(), lastError: msg });
    }
  }
}

async function step(env: Env, c: CaseLite): Promise<void> {
  const rules = readRules(c.rules);
  const st = await getAuto(env, c.site_id);
  const done = async (what: string) => { await setAuto(env, c.site_id, { lastRun: Date.now(), lastStep: what, lastError: null }); };
  const A = "agent:autopilot";

  // 1. Đang quét dở: để processRecoveryQueue lo
  if (["discovering", "scanning", "analyzing"].includes(c.status)) return done("đang quét");
  // 2. Quét lại định kỳ
  if (c.status === "ready" && c.finished_at && Date.now() - c.finished_at > rules.autoRescanDays * DAY) {
    await resetForRescan(env, c.id);
    await logActivity(env, "agent:doctor", "recovery.rescan", `Tự quét lại ${c.domain} (${rules.autoRescanDays} ngày một lần)`, c.site_id);
    await processCase(env, c.id, 15000);
    return done("quét lại");
  }
  if (c.status !== "ready") return done("chờ");
  // 3. Tự áp dụng việc người đã duyệt (nếu bật), tối đa 3 trang mỗi ngày
  if (rules.autoApplyApproved) {
    const today = Number(st.appliedDay === new Date().toISOString().slice(0, 10) ? st.appliedCount || 0 : 0);
    if (today < 3) {
      const t = await env.DB.prepare("SELECT id FROM recovery_tasks WHERE case_id = ? AND status = 'approved' AND payload LIKE '%\"edits\"%' ORDER BY priority LIMIT 1").bind(c.id).first<{ id: number }>();
      if (t) {
        await applyCore(env, t.id, null, A);
        await setAuto(env, c.site_id, { appliedDay: new Date().toISOString().slice(0, 10), appliedCount: today + 1 });
        return done("áp dụng việc đã duyệt");
      }
    }
  }
  // 4. AI viết lại câu chèn link/CTA còn dùng câu mẫu (tối đa 2 việc mỗi lượt)
  const tpl = await env.DB.prepare("SELECT id FROM recovery_tasks WHERE case_id = ? AND status = 'proposed' AND kind IN ('internal_links', 'cta') AND (payload NOT LIKE '%\"ai\":true%') ORDER BY priority LIMIT 2").bind(c.id).all<{ id: number }>();
  if (tpl.results.length) {
    for (const t of tpl.results) await aiRewriteCore(env, t.id, "agent:linker");
    return done("AI viết câu chèn");
  }
  // 5. Nghiên cứu từ khoá mỗi 30 ngày
  if (!st.lastResearch || Date.now() - Number(st.lastResearch) > 30 * DAY) {
    await researchCore(env, c.id, "agent:research");
    return done("nghiên cứu từ khoá");
  }
  // 6. Tự duyệt chủ đề tốt nhất (nếu bật), trong giới hạn bài/tháng
  if (rules.autoApproveIdeas) {
    const best = await env.DB.prepare("SELECT id FROM content_ideas WHERE site_id = ? AND status = 'idea' AND covered_by IS NULL AND hub_path IS NOT NULL ORDER BY score DESC LIMIT 1").bind(c.site_id).first<{ id: number }>();
    if (best) {
      try { await approveIdeaCore(env, best.id, "agent:planner"); return done("duyệt chủ đề"); } catch { /* hết giới hạn tháng: bỏ qua */ }
    }
  }
  // 7. Chủ đề đã duyệt → dàn ý; dàn ý → bài nháp; bài nháp qua Gác cổng → bản nháp WordPress
  const next = await env.DB.prepare("SELECT id, status, gate, wp_post_id FROM content_ideas WHERE site_id = ? AND status IN ('approved', 'briefed', 'drafted') ORDER BY updated_at LIMIT 10").bind(c.site_id).all<{ id: number; status: string; gate: string | null; wp_post_id: number | null }>();
  const a = next.results.find((x) => x.status === "approved");
  if (a) { await briefCore(env, a.id, "agent:planner"); return done("lập dàn ý"); }
  const b = next.results.find((x) => x.status === "briefed");
  if (b) { await draftCore(env, b.id, "agent:writer"); return done("viết bài nháp"); }
  const hasWp = await env.DB.prepare("SELECT 1 FROM secrets WHERE key = ?").bind(`wp:${c.site_id}`).first();
  const d = next.results.find((x) => x.status === "drafted" && !x.wp_post_id && x.gate && JSON.parse(x.gate).ok);
  if (d && hasWp) { await wpDraftCore(env, d.id, "agent:writer"); return done("tạo bản nháp WordPress"); }
  return done("không có việc");
}
