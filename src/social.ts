// Social Entity: tài khoản mạng xã hội theo site (Pinterest, Facebook Page, LinkedIn Page, X, Bluesky; YouTube và profile khác chỉ ghi sameAs),
// phát hiện bài mới đăng qua sitemap → viết bài chia sẻ (prompt social_caption) → Gác cổng → tự đăng, giãn lịch.
// Chỉ dùng ảnh đại diện có sẵn của bài (og:image), không tạo ảnh AI. Bài cũ lúc kết nối không đăng lại.

import { logActivity } from "./activity";
import { aiJson, writingRules } from "./ai";
import { decryptText, encryptText, encryptionReady } from "./crypto";
import { HttpError, json, now, readJson } from "./http";
import type { OpSettings } from "./offpage";
import { extractNumbers } from "./recovery-extract";
import { readRules } from "./recovery-rules";
import { readSecret, type SecretKey } from "./settings";
import { fetchText, pageInfo, sitemapUrls } from "./web";
import type { Env, User } from "./types";

export const NETWORKS = {
  pinterest: { label: "Pinterest", oauth: true, posts: true },
  facebook: { label: "Facebook Page", oauth: true, posts: true },
  linkedin: { label: "LinkedIn Page", oauth: true, posts: true },
  x: { label: "X (Twitter)", oauth: true, posts: true },
  bluesky: { label: "Bluesky", oauth: false, posts: true },
  youtube: { label: "YouTube", oauth: false, posts: false },
  instagram: { label: "Instagram", oauth: false, posts: false },
  tiktok: { label: "TikTok", oauth: false, posts: false },
  crunchbase: { label: "Crunchbase", oauth: false, posts: false },
  other: { label: "Profile khác", oauth: false, posts: false }
} as const;
export type Network = keyof typeof NETWORKS;
const FB = "v24.0";
const DAY = 86400000;
// LinkedIn yêu cầu header phiên bản YYYYMM và chỉ giữ các phiên bản khoảng 1 năm: dùng tháng cách đây 2 tháng
const liVersion = () => { const d = new Date(Date.now() - 62 * DAY); return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}`; };

interface OAuthCfg { auth: string; token: string; scope: string; basic: boolean; pkce: boolean; id: SecretKey; secret: SecretKey }
const OAUTH: Record<"pinterest" | "facebook" | "linkedin" | "x", OAuthCfg> = {
  pinterest: { auth: "https://www.pinterest.com/oauth/", token: "https://api.pinterest.com/v5/oauth/token", scope: "boards:read,pins:read,pins:write,user_accounts:read", basic: true, pkce: false, id: "pinterest_app_id", secret: "pinterest_app_secret" },
  facebook: { auth: `https://www.facebook.com/${FB}/dialog/oauth`, token: `https://graph.facebook.com/${FB}/oauth/access_token`, scope: "pages_show_list,pages_manage_posts,pages_read_engagement", basic: false, pkce: false, id: "meta_app_id", secret: "meta_app_secret" },
  linkedin: { auth: "https://www.linkedin.com/oauth/v2/authorization", token: "https://www.linkedin.com/oauth/v2/accessToken", scope: "w_organization_social r_organization_social rw_organization_admin", basic: false, pkce: false, id: "linkedin_client_id", secret: "linkedin_client_secret" },
  x: { auth: "https://x.com/i/oauth2/authorize", token: "https://api.x.com/2/oauth2/token", scope: "tweet.read tweet.write users.read offline.access", basic: true, pkce: true, id: "x_client_id", secret: "x_client_secret" }
};
export const redirectUri = (req: Request) => `${new URL(req.url).origin}/api/social/oauth/callback`;

interface Tok { access_token?: string; refresh_token?: string; expires_at?: number; page_token?: string; app_password?: string; identifier?: string }
interface Acc { id: number; site_id: number; network: Network; handle: string | null; profile_url: string | null; target_id: string | null; target_name: string | null; status: string; expires_at: number | null }

const canEdit = (u: User) => { if (u.role === "viewer") throw new HttpError(403, "Tài khoản chỉ xem.", "forbidden"); };
const b64url = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const rand = (n = 32) => b64url(crypto.getRandomValues(new Uint8Array(n)));

async function saveTok(env: Env, accId: number, t: Tok): Promise<void> {
  if (!encryptionReady(env.ENCRYPTION_KEY)) throw new HttpError(503, "Worker chưa có ENCRYPTION_KEY nên chưa lưu được token.", "encryption_missing");
  const key = `social:${accId}`;
  const { iv, ciphertext } = await encryptText(env.ENCRYPTION_KEY, JSON.stringify(t), key);
  await env.DB.prepare("INSERT INTO secrets (key, iv, ciphertext, hint, updated_at) VALUES (?, ?, ?, '', ?) ON CONFLICT(key) DO UPDATE SET iv = excluded.iv, ciphertext = excluded.ciphertext, updated_at = excluded.updated_at").bind(key, iv, ciphertext, now()).run();
}
async function readTok(env: Env, accId: number): Promise<Tok> {
  const key = `social:${accId}`;
  const r = await env.DB.prepare("SELECT iv, ciphertext FROM secrets WHERE key = ?").bind(key).first<{ iv: string; ciphertext: string }>();
  if (!r) return {};
  try { return JSON.parse(await decryptText(env.ENCRYPTION_KEY, r.iv, r.ciphertext, key)) as Tok; } catch { return {}; }
}
async function upsertAcc(env: Env, siteId: number, network: Network, patch: Partial<Acc> & { status: string; connected_at?: number; error?: string | null }): Promise<number> {
  const r = await env.DB.prepare(`INSERT INTO social_accounts (site_id, network, handle, profile_url, target_id, target_name, status, error, expires_at, connected_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
    ON CONFLICT(site_id, network) DO UPDATE SET handle = COALESCE(?3, handle), profile_url = COALESCE(?4, profile_url), target_id = COALESCE(?5, target_id), target_name = COALESCE(?6, target_name), status = ?7, error = ?8, expires_at = COALESCE(?9, expires_at), connected_at = COALESCE(?10, connected_at), updated_at = ?11 RETURNING id`)
    .bind(siteId, network, patch.handle ?? null, patch.profile_url ?? null, patch.target_id ?? null, patch.target_name ?? null, patch.status, patch.error ?? null, patch.expires_at ?? null, patch.connected_at ?? null, now()).first<{ id: number }>();
  return r!.id;
}
async function call(url: string, init: RequestInit & { json?: unknown } = {}): Promise<{ status: number; data: Record<string, unknown>; headers: Headers }> {
  const headers = new Headers(init.headers);
  let body = init.body;
  if (init.json !== undefined) { headers.set("Content-Type", "application/json"); body = JSON.stringify(init.json); }
  const res = await fetch(url, { ...init, headers, body, signal: AbortSignal.timeout(20000) });
  const text = await res.text();
  let data: Record<string, unknown> = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text.slice(0, 300) }; }
  return { status: res.status, data, headers: res.headers };
}
const errOf = (d: Record<string, unknown>) => {
  const e = d.error as Record<string, unknown> | string | undefined;
  return String((typeof e === "object" ? e?.message : e) || d.message || d.detail || d.error_description || d.title || JSON.stringify(d).slice(0, 200));
};

// ---------------- Kết nối ----------------

// GET /api/social/oauth/:network/start?site=ID → chuyển tới trang đăng nhập của mạng
export async function apiOAuthStart(env: Env, req: Request, user: User, network: string, url: URL): Promise<Response> {
  canEdit(user);
  if (!(network in OAUTH)) throw new HttpError(400, "Mạng này không đăng nhập OAuth.", "validation");
  const cfg = OAUTH[network as keyof typeof OAUTH];
  const siteId = Number(url.searchParams.get("site"));
  const s = await env.DB.prepare("SELECT id FROM sites WHERE id = ?").bind(siteId).first();
  if (!s) throw new HttpError(404, "Không tìm thấy site.", "not_found");
  const clientId = await readSecret(env, cfg.id);
  if (!clientId || !(await readSecret(env, cfg.secret))) throw new HttpError(409, `Chưa nhập ${cfg.id} và ${cfg.secret} ở Cài đặt › API key (tạo app developer của ${NETWORKS[network as Network].label}).`, "no_client");
  const state = rand(24), verifier = cfg.pkce ? rand(48) : null;
  await env.DB.prepare("DELETE FROM oauth_states WHERE created_at < ?").bind(now() - 3600000).run();
  await env.DB.prepare("INSERT INTO oauth_states (state, site_id, network, verifier, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?)").bind(state, siteId, network, verifier, user.id, now()).run();
  const q = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri(req), response_type: "code", scope: cfg.scope, state });
  if (verifier) { q.set("code_challenge", b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))))); q.set("code_challenge_method", "S256"); }
  return Response.redirect(`${cfg.auth}?${q}`, 302);
}

async function exchange(env: Env, network: keyof typeof OAUTH, body: Record<string, string>): Promise<Tok> {
  const cfg = OAUTH[network];
  const id = (await readSecret(env, cfg.id))!, secret = (await readSecret(env, cfg.secret))!;
  const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded" };
  const form = new URLSearchParams(body);
  if (cfg.basic) headers.Authorization = `Basic ${btoa(`${id}:${secret}`)}`; else { form.set("client_id", id); form.set("client_secret", secret); }
  if (network === "x") form.set("client_id", id);
  const r = await call(cfg.token, { method: "POST", headers, body: form.toString() });
  if (r.status >= 400 || !r.data.access_token) throw new Error(`${NETWORKS[network].label} từ chối: ${errOf(r.data)}`);
  return { access_token: String(r.data.access_token), refresh_token: r.data.refresh_token ? String(r.data.refresh_token) : undefined, expires_at: r.data.expires_in ? now() + Number(r.data.expires_in) * 1000 - 60000 : undefined };
}

// GET /api/social/oauth/callback?code&state → lưu token, lấy tên tài khoản, quay về trang Off-page
export async function apiOAuthCallback(env: Env, req: Request, user: User, url: URL): Promise<Response> {
  const st = await env.DB.prepare("SELECT * FROM oauth_states WHERE state = ?").bind(url.searchParams.get("state") || "").first<{ state: string; site_id: number; network: keyof typeof OAUTH; verifier: string | null; user_id: number; created_at: number }>();
  const back = (siteId: number | null, msg: string) => Response.redirect(`${new URL(req.url).origin}/#/offpage/${siteId || ""}/social?msg=${encodeURIComponent(msg)}`, 302);
  if (!st || st.user_id !== user.id || now() - st.created_at > 3600000) return back(null, "Phiên kết nối hết hạn, anh bấm Kết nối lại.");
  await env.DB.prepare("DELETE FROM oauth_states WHERE state = ?").bind(st.state).run();
  const code = url.searchParams.get("code");
  if (!code) return back(st.site_id, `Không kết nối: ${url.searchParams.get("error_description") || url.searchParams.get("error") || "anh đã huỷ"}`);
  try {
    const body: Record<string, string> = { grant_type: "authorization_code", code, redirect_uri: redirectUri(req) };
    if (st.verifier) body.code_verifier = st.verifier;
    let tok = await exchange(env, st.network, body);
    let handle: string | null = null, profile: string | null = null;
    if (st.network === "facebook") {
      const id = (await readSecret(env, "meta_app_id"))!, secret = (await readSecret(env, "meta_app_secret"))!;
      const ll = await call(`https://graph.facebook.com/${FB}/oauth/access_token?${new URLSearchParams({ grant_type: "fb_exchange_token", client_id: id, client_secret: secret, fb_exchange_token: tok.access_token! })}`);
      if (ll.data.access_token) tok = { access_token: String(ll.data.access_token), expires_at: ll.data.expires_in ? now() + Number(ll.data.expires_in) * 1000 : undefined };
    }
    if (st.network === "x") { const me = await call("https://api.x.com/2/users/me", { headers: { Authorization: `Bearer ${tok.access_token}` } }); const u = (me.data.data || {}) as { username?: string }; if (u.username) { handle = `@${u.username}`; profile = `https://x.com/${u.username}`; } }
    if (st.network === "pinterest") { const me = await call("https://api.pinterest.com/v5/user_account", { headers: { Authorization: `Bearer ${tok.access_token}` } }); if (me.data.username) { handle = String(me.data.username); profile = `https://www.pinterest.com/${me.data.username}/`; } }
    const needsTarget = ["facebook", "linkedin", "pinterest"].includes(st.network);
    const accId = await upsertAcc(env, st.site_id, st.network, { handle, profile_url: profile, status: needsTarget ? "choose_target" : "connected", error: null, connected_at: now(), expires_at: tok.expires_at ?? null });
    await saveTok(env, accId, tok);
    await logActivity(env, `user:${user.id}`, "social.connect", `Kết nối ${NETWORKS[st.network].label}${handle ? ` ${handle}` : ""}`, st.site_id);
    return back(st.site_id, needsTarget ? `Đã kết nối ${NETWORKS[st.network].label}: chọn ${st.network === "pinterest" ? "board" : "trang"} để đăng.` : `Đã kết nối ${NETWORKS[st.network].label}.`);
  } catch (e) {
    return back(st.site_id, (e as Error).message.slice(0, 200));
  }
}

// POST /api/social/:siteId/accounts { network, handle?, profile_url?, app_password? } — Bluesky (mật khẩu ứng dụng) và profile chỉ để sameAs
export async function apiSaveAccount(env: Env, req: Request, user: User, siteId: number): Promise<Response> {
  canEdit(user);
  const b = await readJson<{ network?: string; handle?: string; profile_url?: string; app_password?: string }>(req);
  const network = String(b.network) as Network;
  if (!(network in NETWORKS)) throw new HttpError(400, "Mạng không hợp lệ.", "validation");
  let profile = String(b.profile_url || "").trim();
  if (profile) { try { const u = new URL(profile); if (u.protocol !== "https:") throw new Error(); profile = u.href; } catch { throw new HttpError(400, "Link profile phải là https.", "validation"); } }
  const handle = String(b.handle || "").trim().replace(/^@/, "").slice(0, 100) || null;
  if (network === "bluesky" && b.app_password) {
    if (!handle) throw new HttpError(400, "Nhập handle Bluesky (vd: tensite.bsky.social).", "validation");
    const sess = await call("https://bsky.social/xrpc/com.atproto.server.createSession", { method: "POST", json: { identifier: handle, password: String(b.app_password).trim() } });
    if (sess.status >= 400 || !sess.data.did) throw new HttpError(400, `Bluesky từ chối đăng nhập: ${errOf(sess.data)}. Dùng App Password (Settings › Privacy and security › App passwords).`, "bluesky_auth");
    const id = await upsertAcc(env, siteId, network, { handle: `@${handle}`, profile_url: profile || `https://bsky.app/profile/${handle}`, target_id: String(sess.data.did), status: "connected", error: null, connected_at: now() });
    await saveTok(env, id, { identifier: handle, app_password: String(b.app_password).trim() });
    return json({ ok: true, id });
  }
  if (!profile) throw new HttpError(400, "Nhập link profile.", "validation");
  if (NETWORKS[network].oauth) {
    await upsertAcc(env, siteId, network, { handle: handle ? `@${handle}` : null, profile_url: profile, status: (await env.DB.prepare("SELECT status FROM social_accounts WHERE site_id = ? AND network = ?").bind(siteId, network).first<{ status: string }>())?.status || "profile" });
  } else await upsertAcc(env, siteId, network, { handle: handle ? `@${handle}` : null, profile_url: profile, status: "profile" });
  return json({ ok: true });
}

// GET /api/social/accounts/:id/targets — chọn Page / board / công ty để đăng
export async function apiTargets(env: Env, user: User, accId: number): Promise<Response> {
  canEdit(user);
  const a = await env.DB.prepare("SELECT * FROM social_accounts WHERE id = ?").bind(accId).first<Acc>();
  if (!a) throw new HttpError(404, "Không có tài khoản.", "not_found");
  const t = await freshTok(env, a);
  const H = { Authorization: `Bearer ${t.access_token}` };
  let items: { id: string; name: string; url?: string }[] = [];
  if (a.network === "facebook") {
    const r = await call(`https://graph.facebook.com/${FB}/me/accounts?fields=id,name,link&limit=50`, { headers: H });
    if (r.status >= 400) throw new HttpError(502, `Facebook: ${errOf(r.data)}`, "fb");
    items = ((r.data.data as { id: string; name: string; link?: string }[]) || []).map((p) => ({ id: p.id, name: p.name, url: p.link || `https://www.facebook.com/${p.id}` }));
  } else if (a.network === "pinterest") {
    const r = await call("https://api.pinterest.com/v5/boards?page_size=100", { headers: H });
    if (r.status >= 400) throw new HttpError(502, `Pinterest: ${errOf(r.data)}`, "pin");
    items = ((r.data.items as { id: string; name: string }[]) || []).map((x) => ({ id: x.id, name: x.name }));
  } else if (a.network === "linkedin") {
    const r = await call("https://api.linkedin.com/rest/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED", { headers: { ...H, "LinkedIn-Version": liVersion(), "X-Restli-Protocol-Version": "2.0.0" } });
    if (r.status >= 400) throw new HttpError(502, `LinkedIn: ${errOf(r.data)} (app cần Community Management API)`, "li");
    const orgs = ((r.data.elements as { organization: string }[]) || []).map((e) => e.organization);
    for (const urn of orgs.slice(0, 20)) {
      const id = urn.split(":").pop()!;
      const o = await call(`https://api.linkedin.com/rest/organizations/${id}`, { headers: { ...H, "LinkedIn-Version": liVersion(), "X-Restli-Protocol-Version": "2.0.0" } });
      items.push({ id: urn, name: String(o.data.localizedName || urn), url: o.data.vanityName ? `https://www.linkedin.com/company/${o.data.vanityName}/` : undefined });
    }
  }
  return json({ items });
}

// PUT /api/social/accounts/:id { target_id } — lưu Page/board/công ty; Facebook lấy token của Page
export async function apiSetTarget(env: Env, req: Request, user: User, accId: number): Promise<Response> {
  canEdit(user);
  const a = await env.DB.prepare("SELECT * FROM social_accounts WHERE id = ?").bind(accId).first<Acc>();
  if (!a) throw new HttpError(404, "Không có tài khoản.", "not_found");
  const b = await readJson<{ target_id?: string; target_name?: string; profile_url?: string }>(req);
  const target = String(b.target_id || "").trim();
  if (!target) throw new HttpError(400, "Chọn trang/board.", "validation");
  const t = await freshTok(env, a);
  if (a.network === "facebook") {
    const r = await call(`https://graph.facebook.com/${FB}/${encodeURIComponent(target)}?fields=access_token,name,link`, { headers: { Authorization: `Bearer ${t.access_token}` } });
    if (!r.data.access_token) throw new HttpError(502, `Facebook không cho token của Page: ${errOf(r.data)}`, "fb");
    await saveTok(env, accId, { ...t, page_token: String(r.data.access_token) });
    b.target_name = String(r.data.name || b.target_name || ""); b.profile_url = String(r.data.link || b.profile_url || "");
  }
  await env.DB.prepare("UPDATE social_accounts SET target_id = ?, target_name = ?, profile_url = COALESCE(NULLIF(?, ''), profile_url), status = 'connected', error = NULL, updated_at = ? WHERE id = ?").bind(target, String(b.target_name || "").slice(0, 120), String(b.profile_url || ""), now(), accId).run();
  return json({ ok: true });
}

export async function apiDeleteAccount(env: Env, user: User, accId: number): Promise<Response> {
  canEdit(user);
  await env.DB.batch([env.DB.prepare("DELETE FROM secrets WHERE key = ?").bind(`social:${accId}`), env.DB.prepare("DELETE FROM social_accounts WHERE id = ?").bind(accId)]);
  return json({ ok: true });
}

// PUT /api/social/posts/:id { action: retry|skip, text? }
export async function apiPost(env: Env, req: Request, user: User, id: number): Promise<Response> {
  canEdit(user);
  const b = await readJson<{ action?: string; text?: string }>(req);
  const p = await env.DB.prepare("SELECT * FROM social_posts WHERE id = ?").bind(id).first<{ id: number; site_id: number; network: Network; status: string; source_url: string; source_title: string | null }>();
  if (!p) throw new HttpError(404, "Không có bài.", "not_found");
  if (p.status === "posted") throw new HttpError(409, "Bài đã đăng: xoá trực tiếp trên mạng xã hội nếu cần.", "posted");
  if (b.action === "skip") { await env.DB.prepare("UPDATE social_posts SET status = 'skipped', updated_at = ? WHERE id = ?").bind(now(), id).run(); return json({ ok: true }); }
  if (b.text !== undefined) {
    const text = String(b.text).trim().slice(0, 3000);
    const gate = gateSocial(p.network, text, "", { excerpt: text, blocklist: [] });
    await env.DB.prepare("UPDATE social_posts SET text = ?, gate = ?, status = ?, updated_at = ? WHERE id = ?").bind(text, JSON.stringify(gate), gate.ok ? "queued" : "blocked", now(), id).run();
  } else if (b.action === "retry") await env.DB.prepare("UPDATE social_posts SET status = 'queued', error = NULL, updated_at = ? WHERE id = ? AND status IN ('failed', 'blocked')").bind(now(), id).run();
  return json({ ok: true });
}

// ---------------- Token còn hạn ----------------

async function freshTok(env: Env, a: Acc): Promise<Tok> {
  const t = await readTok(env, a.id);
  if (a.network === "bluesky") return t;
  if (!t.access_token) throw new Error(`${NETWORKS[a.network].label}: chưa có token, anh kết nối lại.`);
  if (t.expires_at && t.expires_at < now() + 5 * 60000) {
    if (!t.refresh_token || !(a.network in OAUTH)) {
      await env.DB.prepare("UPDATE social_accounts SET status = 'expired', error = 'Token hết hạn: anh bấm Kết nối lại', updated_at = ? WHERE id = ?").bind(now(), a.id).run();
      throw new Error(`${NETWORKS[a.network].label}: token hết hạn, anh kết nối lại.`);
    }
    const n = await exchange(env, a.network as keyof typeof OAUTH, { grant_type: "refresh_token", refresh_token: t.refresh_token });
    const merged = { ...t, ...n, refresh_token: n.refresh_token || t.refresh_token };
    await saveTok(env, a.id, merged);
    await env.DB.prepare("UPDATE social_accounts SET expires_at = ?, updated_at = ? WHERE id = ?").bind(merged.expires_at ?? null, now(), a.id).run();
    return merged;
  }
  return t;
}

// ---------------- Gác cổng bài social ----------------

const LIMIT: Partial<Record<Network, number>> = { x: 255, bluesky: 280, pinterest: 500, linkedin: 2800, facebook: 2000 };
export function gateSocial(network: Network, text: string, title: string, ctx: { excerpt: string; blocklist: string[] }): { ok: boolean; problems: { rule: string; level: string; message: string }[] } {
  const p: { rule: string; level: string; message: string }[] = [];
  const all = `${title} ${text}`;
  if (!text.trim()) p.push({ rule: "empty", level: "block", message: "Trống." });
  if (text.length > (LIMIT[network] || 2000)) p.push({ rule: "length", level: "block", message: `Dài ${text.length} ký tự, quá giới hạn ${LIMIT[network]} của ${NETWORKS[network].label}.` });
  if (network === "pinterest" && title.length > 100) p.push({ rule: "length", level: "block", message: "Tiêu đề Pin quá 100 ký tự." });
  const nums = extractNumbers(all).filter((n) => !ctx.excerpt.includes(n.replace(/[%€$]/g, "")));
  if (nums.length) p.push({ rule: "numbers", level: "block", message: `Số không có trong bài: ${nums.slice(0, 3).join(", ")}` });
  if (/\b(we|i) (tested|tried)|tested by us|wir haben getestet|im test\b/i.test(all) && !/test/i.test(ctx.excerpt)) p.push({ rule: "honesty", level: "block", message: "Nói đã test nhưng bài không nói vậy." });
  if ((all.match(/#\w+/g) || []).length > 3) p.push({ rule: "hashtags", level: "block", message: "Quá 3 hashtag." });
  if (/https?:\/\//i.test(text)) p.push({ rule: "link", level: "block", message: "Không chèn link trong chữ: hệ thống tự gắn link bài." });
  for (const b of ctx.blocklist) if (b && all.toLowerCase().includes(b.toLowerCase())) p.push({ rule: "blocklist", level: "block", message: `Có từ cấm "${b}".` });
  if (/(guaranteed|#1|number one|best ever|you won't believe|unglaublich|garantiert)/i.test(all)) p.push({ rule: "hype", level: "block", message: "Lời hứa hoặc giật tít." });
  return { ok: !p.some((x) => x.level === "block"), problems: p };
}

// ---------------- Đăng ----------------

async function publish(env: Env, a: Acc, post: { text: string; title: string | null; image_url: string | null; source_url: string; source_title: string | null }): Promise<{ id: string; url: string }> {
  const t = await freshTok(env, a);
  const H = { Authorization: `Bearer ${t.access_token}` };
  if (a.network === "x") {
    const r = await call("https://api.x.com/2/tweets", { method: "POST", headers: H, json: { text: `${post.text}\n\n${post.source_url}` } });
    const d = (r.data.data || {}) as { id?: string };
    if (r.status >= 400 || !d.id) throw new Error(`X: ${errOf(r.data)}`);
    return { id: d.id, url: `https://x.com/i/web/status/${d.id}` };
  }
  if (a.network === "bluesky") {
    const sess = await call("https://bsky.social/xrpc/com.atproto.server.createSession", { method: "POST", json: { identifier: t.identifier, password: t.app_password } });
    if (sess.status >= 400 || !sess.data.accessJwt) throw new Error(`Bluesky: ${errOf(sess.data)}`);
    const record = { $type: "app.bsky.feed.post", text: post.text, createdAt: new Date().toISOString(), embed: { $type: "app.bsky.embed.external", external: { uri: post.source_url, title: (post.source_title || "").slice(0, 200), description: post.text.slice(0, 200) } } };
    const r = await call("https://bsky.social/xrpc/com.atproto.repo.createRecord", { method: "POST", headers: { Authorization: `Bearer ${sess.data.accessJwt}` }, json: { repo: sess.data.did, collection: "app.bsky.feed.post", record } });
    if (r.status >= 400 || !r.data.uri) throw new Error(`Bluesky: ${errOf(r.data)}`);
    const rkey = String(r.data.uri).split("/").pop();
    return { id: String(r.data.uri), url: `https://bsky.app/profile/${String(a.handle || "").replace(/^@/, "")}/post/${rkey}` };
  }
  if (a.network === "facebook") {
    if (!t.page_token || !a.target_id) throw new Error("Facebook: chưa chọn Page.");
    const r = await call(`https://graph.facebook.com/${FB}/${a.target_id}/feed`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ message: post.text, link: post.source_url, access_token: t.page_token }).toString() });
    if (r.status >= 400 || !r.data.id) throw new Error(`Facebook: ${errOf(r.data)}`);
    return { id: String(r.data.id), url: `https://www.facebook.com/${r.data.id}` };
  }
  if (a.network === "linkedin") {
    if (!a.target_id) throw new Error("LinkedIn: chưa chọn trang công ty.");
    const r = await call("https://api.linkedin.com/rest/posts", { method: "POST", headers: { ...H, "LinkedIn-Version": liVersion(), "X-Restli-Protocol-Version": "2.0.0" }, json: { author: a.target_id, commentary: post.text, visibility: "PUBLIC", distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] }, content: { article: { source: post.source_url, title: (post.source_title || "").slice(0, 200) } }, lifecycleState: "PUBLISHED", isReshareDisabledByAuthor: false } });
    const urn = r.headers.get("x-restli-id") || "";
    if (r.status >= 400 || !urn) throw new Error(`LinkedIn: ${errOf(r.data)}`);
    return { id: urn, url: `https://www.linkedin.com/feed/update/${urn}/` };
  }
  if (a.network === "pinterest") {
    if (!a.target_id) throw new Error("Pinterest: chưa chọn board.");
    if (!post.image_url) throw new Error("Pinterest cần ảnh: bài không có ảnh đại diện (og:image).");
    const r = await call("https://api.pinterest.com/v5/pins", { method: "POST", headers: H, json: { board_id: a.target_id, title: (post.title || post.source_title || "").slice(0, 100), description: post.text.slice(0, 500), link: post.source_url, alt_text: (post.source_title || "").slice(0, 500), media_source: { source_type: "image_url", url: post.image_url } } });
    if (r.status >= 400 || !r.data.id) throw new Error(`Pinterest: ${errOf(r.data)}`);
    return { id: String(r.data.id), url: `https://www.pinterest.com/pin/${r.data.id}/` };
  }
  throw new Error("Mạng này chưa đăng tự động.");
}

// Phát hiện bài mới, soạn và đăng (giãn lịch: tối đa socialDailyCap bài/mạng/ngày, cách nhau ít nhất 2 giờ)
export async function socialRun(env: Env, siteId: number, settings: OpSettings, actor: string, force = false): Promise<{ newUrls: number; queued: number; posted: number; failed: number; note?: string }> {
  const s = await env.DB.prepare("SELECT id, domain, language FROM sites WHERE id = ?").bind(siteId).first<{ id: number; domain: string; language: string }>();
  if (!s) throw new HttpError(404, "Không tìm thấy site.", "not_found");
  const accounts = (await env.DB.prepare("SELECT * FROM social_accounts WHERE site_id = ? AND status = 'connected'").bind(siteId).all<Acc>()).results.filter((a) => NETWORKS[a.network]?.posts);
  if (!accounts.length) return { newUrls: 0, queued: 0, posted: 0, failed: 0, note: "Chưa kết nối mạng xã hội nào để đăng." };
  const rules = readRules((await env.DB.prepare("SELECT rules FROM recovery_cases WHERE site_id = ? AND status != 'archived' ORDER BY id DESC LIMIT 1").bind(siteId).first<{ rules: string }>())?.rules || "{}");
  // 1. Bài mới trên sitemap (lần đầu: ghi nhận bài cũ, không đăng lại)
  const urls = await sitemapUrls(s.domain.replace(/^www\./, ""));
  const known = new Set((await env.DB.prepare("SELECT url FROM social_seen WHERE site_id = ?").bind(siteId).all<{ url: string }>()).results.map((r) => r.url));
  const fresh = urls.filter((u) => !known.has(u));
  const firstRun = known.size === 0;
  for (let i = 0; i < fresh.length; i += 50) await env.DB.batch(fresh.slice(i, i + 50).map((u) => env.DB.prepare("INSERT OR IGNORE INTO social_seen (site_id, url, first_seen) VALUES (?, ?, ?)").bind(siteId, u, now())));
  let queued = 0;
  if (!firstRun) {
    for (const u of fresh.slice(0, 3)) {
      const page = await fetchText(u, 600_000, 12000);
      if (!page || page.status >= 400) continue;
      const info = pageInfo(page.text, u);
      const nets = accounts.map((a) => a.network);
      let out: { posts?: { network: string; text: string; title?: string; alt_text?: string }[] } = {};
      try {
        out = await aiJson(env, { template: "social_caption", task: "social.caption", siteId, rules: writingRules(rules.language || s.language, extractNumbers(`${info.title} ${info.description} ${info.excerpt}`), rules.blocklist), input: { title: info.title, description: info.description, excerpt: info.excerpt, language: rules.language || s.language, networks: nets } });
      } catch (e) {
        await logActivity(env, actor, "social.error", `Không soạn được bài social cho ${u}: ${(e as Error).message.slice(0, 160)}`, siteId);
        continue;
      }
      for (const a of accounts) {
        const p = (out.posts || []).find((x) => x.network === a.network);
        const text = String(p?.text || "").trim();
        const title = String(p?.title || info.title || "").trim().slice(0, 100);
        const gate = gateSocial(a.network, text, a.network === "pinterest" ? title : "", { excerpt: `${info.title} ${info.description} ${info.excerpt}`, blocklist: rules.blocklist });
        if (a.network === "pinterest" && !info.image) gate.problems.push({ rule: "image", level: "block", message: "Bài không có ảnh đại diện (og:image): Pinterest cần ảnh." });
        const ok = !gate.problems.some((x) => x.level === "block");
        await env.DB.prepare("INSERT OR IGNORE INTO social_posts (site_id, network, source_url, source_title, text, title, image_url, status, gate, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
          .bind(siteId, a.network, u, info.title, text, title, info.image || null, ok ? "queued" : "blocked", JSON.stringify({ ok, problems: gate.problems }), now(), now()).run();
        if (ok) queued++;
      }
    }
  }
  // 2. Đăng bài đang chờ, giãn lịch
  let posted = 0, failed = 0;
  for (const a of accounts) {
    const today = await env.DB.prepare("SELECT COUNT(*) AS n, MAX(posted_at) AS last FROM social_posts WHERE site_id = ? AND network = ? AND status = 'posted' AND posted_at > ?").bind(siteId, a.network, now() - DAY).first<{ n: number; last: number | null }>();
    if ((today?.n || 0) >= settings.socialDailyCap) continue;
    if (!force && today?.last && now() - today.last < 2 * 3600000) continue;
    const p = await env.DB.prepare("SELECT * FROM social_posts WHERE site_id = ? AND network = ? AND status = 'queued' ORDER BY id LIMIT 1").bind(siteId, a.network).first<{ id: number; text: string; title: string | null; image_url: string | null; source_url: string; source_title: string | null }>();
    if (!p) continue;
    try {
      const r = await publish(env, a, p);
      await env.DB.prepare("UPDATE social_posts SET status = 'posted', remote_id = ?, remote_url = ?, posted_at = ?, error = NULL, updated_at = ? WHERE id = ?").bind(r.id, r.url, now(), now(), p.id).run();
      posted++;
      await logActivity(env, "agent:social", "social.posted", `Đăng ${NETWORKS[a.network].label}: ${p.source_title || p.source_url}`, siteId);
    } catch (e) {
      failed++;
      await env.DB.prepare("UPDATE social_posts SET status = 'failed', error = ?, updated_at = ? WHERE id = ?").bind((e as Error).message.slice(0, 300), now(), p.id).run();
    }
  }
  return { newUrls: firstRun ? 0 : fresh.length, queued, posted, failed, note: firstRun ? `Lần đầu: ghi nhận ${fresh.length} bài có sẵn, chỉ đăng bài mới từ giờ.` : undefined };
}

// JSON-LD Organization với sameAs từ các profile (dán vào layout Astro / thay schema Rank Math)
export async function entityLd(env: Env, siteId: number, brand: string): Promise<Record<string, unknown>> {
  const s = await env.DB.prepare("SELECT domain FROM sites WHERE id = ?").bind(siteId).first<{ domain: string }>();
  const d = `https://${s!.domain.replace(/^www\./, "")}`;
  const same = (await env.DB.prepare("SELECT profile_url FROM social_accounts WHERE site_id = ? AND profile_url IS NOT NULL ORDER BY network").bind(siteId).all<{ profile_url: string }>()).results.map((r) => r.profile_url);
  return { "@context": "https://schema.org", "@graph": [
    { "@type": "Organization", "@id": `${d}/#organization`, name: brand, url: `${d}/`, ...(same.length ? { sameAs: same } : {}) },
    { "@type": "WebSite", "@id": `${d}/#website`, url: `${d}/`, name: brand, publisher: { "@id": `${d}/#organization` } }
  ] };
}
