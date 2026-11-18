// Duy Ơi · Worker chính. Giao diện là static assets (thư mục public/); Worker chỉ xử lý /api/* và cron.

import { changePassword, listSessions, login, logout, requireUser, setup, setupStatus, currentUser } from "./auth";
import { listActivity } from "./activity";
import { dashboard, runCron, setPaused } from "./dashboard";
import { HttpError, assertSameOrigin, errorResponse, json } from "./http";
import { getSettings, updateSettings } from "./settings";
import { createSite, getSite, listSites, updateSite } from "./sites";
import { createUser, deleteUser, listUsers, resetUserPassword, updateUser } from "./users";
import { aiRewriteTask, applyTask, archiveCase, createCase, decideTask, disavow, geoDraft, getCase, listCases, processRecoveryQueue, rescanCase, rollbackTask, updateRules } from "./recovery";
import { wpSave, wpStatus, wpTest } from "./wordpress";
import { listPrompts, reviewPrompt, spendReport } from "./manager";
import { apiCheckMedia, apiSetupMedia } from "./cfmedia";
import { apiDetectProfile, apiGetProfile, apiSaveProfile as apiSavePublish } from "./publish";
import { apiDeleteDoc, apiDocs, apiSaveProfile, apiUploadDoc, apiVoice } from "./docs";
import { apiAppendPlaybook, apiLeadRun, apiLeadSend, apiLeadView, apiPlaybook, apiRestorePlaybook, apiRunJob, apiSavePlaybook, processJobs } from "./lead";
import { apiBrief, apiCreateIdea, apiDeleteImage, apiDraft, apiExportMarkdown, syncOpenPrs, apiGithubPr, apiGithubPreview, apiGithubSync, apiHandoff, apiImport, apiInterview, apiReview, apiWebFacts, apiIdeaStatus, apiProducts, apiResearch, apiUploadImage, apiWpDraft, contentView } from "./content";
import { hqView } from "./hq";
import { apiIndexnowCheck } from "./indexnow";
import { apiManualItem, apiManualPrepare, apiManualView, apiPrAnswer, apiReclaim } from "./manual";
import { apiAddLink as opAddLink, apiCitation, apiDeleteLink as opDeleteLink, apiInboxRead, apiMessage, apiOffpageList, apiOffpageRun, apiOffpageView, apiProspect, apiSaveOpSettings, apiSetupMailbox, apiTestEmail, apiThread, handleInbound, runOffpage } from "./offpage";
import { apiDeleteAccount, apiPostizIntegrations, apiPostizLink, apiSavePostiz, apiSaveApp, apiOAuthCallback, apiOAuthStart, apiPost as socialPost, apiSaveAccount, apiSetTarget, apiTargets } from "./social";
import { apiHealth, apiRunHealth, runHealth } from "./health";
import { apiFindQuickWins, apiQuickWinAction, apiQuickWins } from "./quickwins";
import { apiReport, apiReportPreview, apiSaveReport, apiSendReport, runReport } from "./report";
import { apiSemanticList, apiSemanticRun, apiSemanticView, runSemantic } from "./semantic";
import { apiMonitorAlert, apiMonitorKeyword, apiMonitorKeywords, apiMonitorList, apiMonitorRun, apiMonitorSettings, apiMonitorView, runMonitor } from "./monitor";
import { apiAddStatsDomain, apiDeleteStats, apiInstallStats, apiRefreshStats, apiStats, apiStatsReport, processStats } from "./stats";
import { apiApply as affApply, apiDecide as affDecide, apiDeleteLink as affDelete, apiLinks as affLinks, apiRollback as affRollback, apiSaveLink as affSave, apiScan as affScan } from "./affiliate";
import { runAutopilot } from "./autopilot";
import type { InboundEmail, CronEvent, Env, ExecCtx } from "./types";

async function handleApi(req: Request, env: Env, url: URL, ctx?: ExecCtx): Promise<Response> {
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const m = req.method;
  assertSameOrigin(req);

  // Không cần đăng nhập
  if (path === "/api/health" && m === "GET") return json({ ok: true, app: env.APP_NAME || "Duy Ơi" });
  if (path === "/api/setup/status" && m === "GET") return setupStatus(env);
  if (path === "/api/setup" && m === "POST") return setup(env, req);
  if (path === "/api/auth/login" && m === "POST") return login(env, req);
  if (path === "/api/auth/logout" && m === "POST") return logout(env, req);
  if (path === "/api/auth/me" && m === "GET") {
    const user = await currentUser(env, req);
    if (!user) throw new HttpError(401, "Anh cần đăng nhập.", "unauthorized");
    return json({ user });
  }

  // Từ đây trở đi cần đăng nhập
  const user = await requireUser(env, req);

  if (path === "/api/auth/password" && m === "POST") return changePassword(env, req, user);
  if (path === "/api/auth/sessions" && m === "GET") return listSessions(env, req, user);

  // Mật khẩu tạm: phải đổi trước khi dùng phần còn lại của app
  if (user.mustChangePassword) throw new HttpError(403, "Anh cần đổi mật khẩu tạm trước.", "must_change_password");

  if (path === "/api/users" && m === "GET") return listUsers(env, user);
  if (path === "/api/users" && m === "POST") return createUser(env, req, user);
  const userMatch = path.match(/^\/api\/users\/(\d+)(\/password)?$/);
  if (userMatch) {
    const id = Number(userMatch[1]);
    if (userMatch[2] && m === "POST") return resetUserPassword(env, req, user, id);
    if (!userMatch[2] && m === "PUT") return updateUser(env, req, user, id);
    if (!userMatch[2] && m === "DELETE") return deleteUser(env, user, id);
  }

  if (path === "/api/dashboard" && m === "GET") return dashboard(env);
  if (path === "/api/system/pause" && m === "POST") return setPaused(env, req, user);
  if (path === "/api/activity" && m === "GET") return listActivity(env, url);

  if (path === "/api/settings" && m === "GET") return getSettings(env);
  if (path === "/api/settings" && m === "PUT") return updateSettings(env, req, user);

  if (path === "/api/sites" && m === "GET") return listSites(env, url);
  if (path === "/api/sites" && m === "POST") return createSite(env, req, user);
  const wpMatch = path.match(/^\/api\/sites\/(\d+)\/wp(\/test)?$/);
  if (wpMatch) {
    const sid = Number(wpMatch[1]);
    if (!wpMatch[2] && m === "GET") return wpStatus(env, sid);
    if (!wpMatch[2] && m === "PUT") return wpSave(env, req, user, sid);
    if (wpMatch[2] && m === "POST") return wpTest(env, sid);
  }
  const siteMatch = path.match(/^\/api\/sites\/(\d+)$/);
  if (siteMatch) {
    const id = Number(siteMatch[1]);
    if (m === "GET") return getSite(env, id);
    if (m === "PUT") return updateSite(env, req, user, id);
  }

  // Agent HQ và cấp Quản lý
  if (path === "/api/hq" && m === "GET") return hqView(env);
  if (path === "/api/offpage" && m === "GET") return apiOffpageList(env);
  const opSite = path.match(/^\/api\/offpage\/(\d+)(?:\/(settings|run|links|mailbox|test-email|indexnow|manual|reclaim|pr-answer))?$/);
  if (opSite) {
    const sid = Number(opSite[1]);
    if (!opSite[2] && m === "GET") return apiOffpageView(env, sid);
    if (opSite[2] === "settings" && m === "PUT") return apiSaveOpSettings(env, req, user, sid);
    if (opSite[2] === "run" && m === "POST") return apiOffpageRun(env, req, user, sid);
    if (opSite[2] === "links" && m === "POST") return opAddLink(env, req, user, sid);
    if (opSite[2] === "mailbox" && m === "POST") return apiSetupMailbox(env, user, sid);
    if (opSite[2] === "test-email" && m === "POST") return apiTestEmail(env, req, user, sid);
    if (opSite[2] === "indexnow" && m === "POST") return apiIndexnowCheck(env, user, sid);
    if (opSite[2] === "manual" && m === "GET") return apiManualView(env, sid);
    if (opSite[2] === "manual" && m === "POST") return apiManualPrepare(env, req, user, sid);
    if (opSite[2] === "reclaim" && m === "POST") return apiReclaim(env, req, user, sid);
    if (opSite[2] === "pr-answer" && m === "POST") return apiPrAnswer(env, req, user, sid);
  }
  const opItem = path.match(/^\/api\/offpage\/(prospects|messages|threads|links|citations|inbox|manual)\/(\d+)$/);
  if (opItem) {
    const id = Number(opItem[2]);
    if (opItem[1] === "prospects" && m === "PUT") return apiProspect(env, req, user, id);
    if (opItem[1] === "messages" && m === "PUT") return apiMessage(env, req, user, id);
    if (opItem[1] === "threads" && m === "PUT") return apiThread(env, req, user, id);
    if (opItem[1] === "links" && m === "DELETE") return opDeleteLink(env, user, id);
    if (opItem[1] === "citations" && m === "PUT") return apiCitation(env, req, user, id);
    if (opItem[1] === "inbox" && m === "PUT") return apiInboxRead(env, user, id);
    if (opItem[1] === "manual" && m === "PUT") return apiManualItem(env, req, user, id);
  }
  if (path === "/api/social/oauth/callback" && m === "GET") return apiOAuthCallback(env, req, user, url);
  const soStart = path.match(/^\/api\/social\/oauth\/(\w+)\/start$/);
  if (soStart && m === "GET") return apiOAuthStart(env, req, user, soStart[1]!, url);
  const soPz = path.match(/^\/api\/social\/(\d+)\/postiz(\/integrations|\/link)?$/);
  if (soPz && !soPz[2] && m === "PUT") return apiSavePostiz(env, req, user, Number(soPz[1]));
  if (soPz && soPz[2] === "/integrations" && m === "GET") return apiPostizIntegrations(env, user, Number(soPz[1]));
  if (soPz && soPz[2] === "/link" && m === "POST") return apiPostizLink(env, req, user, Number(soPz[1]));
  const soApp = path.match(/^\/api\/social\/(\d+)\/app$/);
  if (soApp && m === "PUT") return apiSaveApp(env, req, user, Number(soApp[1]));
  const soAcc = path.match(/^\/api\/social\/(\d+)\/accounts$/);
  if (soAcc && m === "POST") return apiSaveAccount(env, req, user, Number(soAcc[1]));
  const soItem = path.match(/^\/api\/social\/(accounts|posts)\/(\d+)(\/targets)?$/);
  if (soItem) {
    const id = Number(soItem[2]);
    if (soItem[1] === "accounts" && soItem[3] && m === "GET") return apiTargets(env, user, id);
    if (soItem[1] === "accounts" && !soItem[3] && m === "PUT") return apiSetTarget(env, req, user, id);
    if (soItem[1] === "accounts" && !soItem[3] && m === "DELETE") return apiDeleteAccount(env, user, id);
    if (soItem[1] === "posts" && m === "PUT") return socialPost(env, req, user, id);
  }
  if (path === "/api/connections" && m === "GET") return apiHealth(env);
  const hRun = path.match(/^\/api\/connections\/run(?:\/(\d+))?$/);
  if (hRun && m === "POST") return apiRunHealth(env, user, hRun[1] ? Number(hRun[1]) : null);
  const qw = path.match(/^\/api\/quickwins(?:\/(\d+))?$/);
  if (qw && m === "GET") return apiQuickWins(env, qw[1] ? Number(qw[1]) : null);
  const qwFind = path.match(/^\/api\/quickwins\/(\d+)\/find$/);
  if (qwFind && m === "POST") return apiFindQuickWins(env, user, Number(qwFind[1]));
  const qwItem = path.match(/^\/api\/quickwins\/items\/(\d+)\/(draft|approve|reject|apply|rollback|edit)$/);
  if (qwItem && m === "POST") return apiQuickWinAction(env, req, user, Number(qwItem[1]), qwItem[2]!);
  if (path === "/api/report" && m === "GET") return apiReport(env);
  if (path === "/api/report" && m === "PUT") return apiSaveReport(env, req, user);
  if (path === "/api/report/preview" && m === "GET") return apiReportPreview(env);
  if (path === "/api/report/send" && m === "POST") return apiSendReport(env, user);
  if (path === "/api/semantic" && m === "GET") return apiSemanticList(env);
  const semSite = path.match(/^\/api\/semantic\/(\d+)(\/run)?$/);
  if (semSite && !semSite[2] && m === "GET") return apiSemanticView(env, Number(semSite[1]));
  if (semSite && semSite[2] && m === "POST") return apiSemanticRun(env, user, Number(semSite[1]));
  if (path === "/api/monitor" && m === "GET") return apiMonitorList(env);
  const monSite = path.match(/^\/api\/monitor\/(\d+)(?:\/(settings|keywords|run))?$/);
  if (monSite) {
    const sid = Number(monSite[1]);
    if (!monSite[2] && m === "GET") return apiMonitorView(env, sid);
    if (monSite[2] === "settings" && m === "PUT") return apiMonitorSettings(env, req, user, sid);
    if (monSite[2] === "keywords" && m === "POST") return apiMonitorKeywords(env, req, user, sid);
    if (monSite[2] === "run" && m === "POST") return apiMonitorRun(env, req, user, sid);
  }
  const monItem = path.match(/^\/api\/monitor\/(keywords|alerts)\/(\d+)$/);
  if (monItem && m === "PUT") return monItem[1] === "keywords" ? apiMonitorKeyword(env, req, user, Number(monItem[2])) : apiMonitorAlert(env, req, user, Number(monItem[2]));
  if (path === "/api/stats" && m === "GET") return apiStats(env);
  if (path === "/api/stats/report" && m === "GET") return apiStatsReport(env, url);
  if (path === "/api/stats/domains" && m === "POST") return apiAddStatsDomain(env, req, user);
  if (path === "/api/stats/refresh" && m === "POST") return apiRefreshStats(env, user);
  const stMatch = path.match(/^\/api\/stats\/domains\/(\d+)(\/install)?$/);
  if (stMatch && m === "POST" && stMatch[2]) return apiInstallStats(env, user, Number(stMatch[1]));
  if (stMatch && m === "DELETE" && !stMatch[2]) return apiDeleteStats(env, user, Number(stMatch[1]));
  if (path === "/api/manager/prompts" && m === "GET") return listPrompts(env);
  const prMatch = path.match(/^\/api\/manager\/prompts\/([a-z_]+)$/);
  if (prMatch && m === "PUT") return reviewPrompt(env, req, user, prMatch[1]!);
  if (path === "/api/manager/spend" && m === "GET") return spendReport(env);

  // Đội Nội dung
  const ctMatch = path.match(/^\/api\/content\/(\d+)(\/research|\/ideas)?$/);
  if (ctMatch && !ctMatch[2] && m === "GET") return contentView(env, Number(ctMatch[1]));
  if (ctMatch && ctMatch[2] === "/research" && m === "POST") return apiResearch(env, user, Number(ctMatch[1]));
  if (ctMatch && ctMatch[2] === "/ideas" && m === "POST") return apiCreateIdea(env, req, user, Number(ctMatch[1]));
  const docMatch = path.match(/^\/api\/sites\/(\d+)\/(docs|profile|voice)(?:\/(\d+))?$/);
  if (docMatch) {
    const sid = Number(docMatch[1]);
    if (docMatch[2] === "voice" && m === "POST") return apiVoice(env, req, user, sid);
    if (docMatch[2] === "docs" && !docMatch[3] && m === "GET") return apiDocs(env, sid);
    if (docMatch[2] === "docs" && !docMatch[3] && m === "POST") return apiUploadDoc(env, req, user, sid);
    if (docMatch[2] === "docs" && docMatch[3] && m === "DELETE") return apiDeleteDoc(env, user, sid, Number(docMatch[3]));
    if (docMatch[2] === "profile" && m === "PUT") return apiSaveProfile(env, req, user, sid);
  }
  if (path === "/api/lead" && m === "GET") return apiLeadView(env, user);
  if (path === "/api/lead/playbook" && m === "GET") return apiPlaybook(env);
  if (path === "/api/lead/playbook" && m === "PUT") return apiSavePlaybook(env, req, user);
  if (path === "/api/lead/playbook/append" && m === "POST") return apiAppendPlaybook(env, req, user);
  const pbMatch = path.match(/^\/api\/lead\/playbook\/restore\/(\d+)$/);
  if (pbMatch && m === "POST") return apiRestorePlaybook(env, user, Number(pbMatch[1]));
  if (path === "/api/lead/messages" && m === "POST") return apiLeadSend(env, req, user);
  const leadMatch = path.match(/^\/api\/lead\/(messages|jobs)\/(\d+)\/run$/);
  if (leadMatch && m === "POST") return leadMatch[1] === "messages" ? apiLeadRun(env, req, user, Number(leadMatch[2])) : apiRunJob(env, user, Number(leadMatch[2]));
  const pubMatch = path.match(/^\/api\/sites\/(\d+)\/publish(\/detect)?$/);
  if (pubMatch && pubMatch[2] && m === "POST") return apiDetectProfile(env, user, Number(pubMatch[1]));
  if (pubMatch && !pubMatch[2] && m === "GET") return apiGetProfile(env, Number(pubMatch[1]));
  if (pubMatch && !pubMatch[2] && m === "PUT") return apiSavePublish(env, req, user, Number(pubMatch[1]));
  const affMatch = path.match(/^\/api\/sites\/(\d+)\/affiliate(?:\/(links|scan|edits|apply|applies)(?:\/(\d+))?(\/rollback)?)?$/);
  if (affMatch) {
    const sid = Number(affMatch[1]), sub = affMatch[2], sub2 = affMatch[3] ? Number(affMatch[3]) : null;
    if (!sub && m === "GET") return affLinks(env, sid);
    if (sub === "links" && m === "POST" && !sub2) return affSave(env, req, user, sid, null);
    if (sub === "links" && m === "PUT" && sub2) return affSave(env, req, user, sid, sub2);
    if (sub === "links" && m === "DELETE" && sub2) return affDelete(env, user, sid, sub2);
    if (sub === "scan" && m === "POST") return affScan(env, req, user, sid);
    if (sub === "edits" && m === "PUT") return affDecide(env, req, user, sid);
    if (sub === "apply" && m === "POST") return affApply(env, req, user, sid);
    if (sub === "applies" && sub2 && affMatch[4] && m === "POST") return affRollback(env, user, sid, sub2);
  }
  const mdMatch = path.match(/^\/api\/sites\/(\d+)\/media(\/check)?$/);
  if (mdMatch && m === "POST") return mdMatch[2] ? apiCheckMedia(env, user, Number(mdMatch[1])) : apiSetupMedia(env, user, Number(mdMatch[1]));
  const imgMatch = path.match(/^\/api\/content\/ideas\/(\d+)\/images\/([a-z0-9]{2,6})$/);
  if (imgMatch && m === "POST") return apiUploadImage(env, req, user, Number(imgMatch[1]), imgMatch[2]!);
  if (imgMatch && m === "DELETE") return apiDeleteImage(env, user, Number(imgMatch[1]), imgMatch[2]!);
  const idMatch = path.match(/^\/api\/content\/ideas\/(\d+)(?:\/(brief|draft|wp|products|review|interview|import|webfacts|github|github\/preview|github\/sync|handoff\.md|export\.md))?$/);
  if (idMatch) {
    const iid = Number(idMatch[1]);
    if (!idMatch[2] && m === "PUT") return apiIdeaStatus(env, req, user, iid);
    if (idMatch[2] === "brief" && m === "POST") return apiBrief(env, user, iid);
    if (idMatch[2] === "draft" && m === "POST") return apiDraft(env, user, iid);
    if (idMatch[2] === "wp" && m === "POST") return apiWpDraft(env, user, iid);
    if (idMatch[2] === "review" && m === "POST") return apiReview(env, req, user, iid);
    if (idMatch[2] === "github" && m === "POST") return apiGithubPr(env, user, iid);
    if (idMatch[2] === "github/preview" && m === "POST") return apiGithubPreview(env, user, iid);
    if (idMatch[2] === "github/sync" && m === "POST") return apiGithubSync(env, user, iid);
    if (idMatch[2] === "webfacts" && m === "POST") return apiWebFacts(env, user, iid);
    if (idMatch[2] === "interview" && m === "PUT") return apiInterview(env, req, user, iid);
    if (idMatch[2] === "import" && m === "POST") return apiImport(env, req, user, iid);
    if (idMatch[2] === "handoff.md" && m === "GET") return apiHandoff(env, user, iid);
    if (idMatch[2] === "export.md" && m === "GET") return apiExportMarkdown(env, user, iid);
    if (idMatch[2] === "products" && m === "PUT") return apiProducts(env, req, user, iid);
  }

  // Phục hồi thứ hạng
  if (path === "/api/recovery" && m === "GET") return listCases(env);
  if (path === "/api/recovery" && m === "POST") return createCase(env, req, user, ctx);
  const taskMatch = path.match(/^\/api\/recovery\/tasks\/(\d+)(?:\/(apply|rollback|ai))?$/);
  if (taskMatch) {
    const tid = Number(taskMatch[1]);
    if (!taskMatch[2] && m === "PUT") return decideTask(env, req, user, tid);
    if (taskMatch[2] === "apply" && m === "POST") return applyTask(env, user, tid);
    if (taskMatch[2] === "rollback" && m === "POST") return rollbackTask(env, user, tid);
    if (taskMatch[2] === "ai" && m === "POST") return aiRewriteTask(env, user, tid);
  }
  const recMatch = path.match(/^\/api\/recovery\/(\d+)(?:\/(rescan|rules|disavow|archive|geo))?$/);
  if (recMatch) {
    const id = Number(recMatch[1]);
    const action = recMatch[2];
    if (!action && m === "GET") return getCase(env, id);
    if (action === "rescan" && m === "POST") return rescanCase(env, user, id, ctx);
    if (action === "rules" && m === "PUT") return updateRules(env, req, user, id, ctx);
    if (action === "disavow" && m === "GET") return disavow(env, id);
    if (action === "archive" && m === "POST") return archiveCase(env, user, id);
    if (action === "geo" && m === "POST") return geoDraft(env, req, user, id);
  }

  throw new HttpError(404, "Không có API này.", "not_found");
}

const CRON_A = "*/15 * * * *", CRON_B = "5-59/15 * * * *", CRON_C = "10-59/15 * * * *";

export default {
  async fetch(req: Request, env: Env, ctx?: ExecCtx): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/api/")) {
      try {
        return await handleApi(req, env, url, ctx);
      } catch (err) {
        return errorResponse(err);
      }
    }
    // Mọi đường dẫn khác: giao diện (static assets)
    return env.ASSETS.fetch(req);
  },

  // Thư trả lời outreach: Email Routing chuyển thư gửi tới địa chỉ outreach của site về Worker này
  async email(message: InboundEmail, env: Env, _ctx: ExecCtx): Promise<void> {
    await handleInbound(message, env);
  },

  async scheduled(event: CronEvent, env: Env, ctx: ExecCtx): Promise<void> {
    // Ba lịch cron lệch nhau 5 phút, mỗi lịch là một lần chạy riêng với hạn mức riêng (D1: 1000 truy vấn mỗi lần chạy trên gói trả phí).
    // Mỗi bước có catch riêng để một bước lỗi không chặn các bước sau.
    const started = Date.now();
    const step = async (name: string, fn: () => Promise<unknown>) => { try { await fn(); } catch (e) { console.error(`cron ${name} failed`, (e as Error).message); } };
    const group = event.cron === CRON_B ? "b" : event.cron === CRON_C ? "c" : event.cron === CRON_A ? "a" : "all";
    ctx.waitUntil((async () => {
      if (group === "a" || group === "all") {
        await step("heartbeat", () => runCron(env));
        await step("recovery", () => processRecoveryQueue(env));
        await step("jobs", () => processJobs(env, 2, started + 5 * 60000));
        await step("autopilot", () => runAutopilot(env, 3, started + 9 * 60000));
        await step("prs", () => syncOpenPrs(env));
      }
      if (group === "b" || group === "all") {
        await step("stats", () => processStats(env, started + 2 * 60000));
        await step("offpage", () => runOffpage(env, started + 8 * 60000));
        await step("health", () => runHealth(env));
        await step("report", () => runReport(env));
      }
      if (group === "c" || group === "all") {
        await step("monitor", () => runMonitor(env, started + 5 * 60000));
        await step("semantic", () => runSemantic(env, started + 9 * 60000));
      }
    })());
  }
};
