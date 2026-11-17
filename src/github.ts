// GitHub REST API (token fine-grained trong Cài đặt): đọc repo site Astro, tạo nhánh, ghi file, mở pull request, đọc trạng thái build.

import { HttpError } from "./http";
import { readSecret } from "./settings";
import type { Env } from "./types";

const b64e = (bytes: Uint8Array) => { let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };
export const b64Text = (t: string) => b64e(new TextEncoder().encode(t));
export const b64Bytes = b64e;
const unb64 = (s: string) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\n/g, "")), (c) => c.charCodeAt(0)));
const enc = (path: string) => path.split("/").map(encodeURIComponent).join("/");

export async function gh<T>(env: Env, path: string, init: { method?: string; json?: unknown } = {}, ok404 = false): Promise<T | null> {
  const token = await readSecret(env, "github_token");
  if (!token) throw new HttpError(400, "Chưa có GitHub token trong Cài đặt › API key.", "no_github");
  let res: Response;
  try {
    res = await fetch(`https://api.github.com${path}`, {
      method: init.method || "GET",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "DuyOi/1.0", ...(init.json !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: init.json !== undefined ? JSON.stringify(init.json) : undefined,
      signal: AbortSignal.timeout(30000)
    });
  } catch (e) {
    throw new HttpError(502, `Không gọi được GitHub: ${(e as Error).message}`, "github_unreachable");
  }
  if (ok404 && res.status === 404) return null;
  const data = (await res.json().catch(() => ({}))) as T & { message?: string };
  if (!res.ok) {
    const msg = (data as { message?: string }).message || String(res.status);
    if (res.status === 401) throw new HttpError(502, "GitHub từ chối token (hết hạn hoặc sai).", "github_auth");
    if (res.status === 403 || res.status === 404) throw new HttpError(502, `GitHub: ${msg}. Kiểm tra token có quyền Contents và Pull requests cho repo này.`, "github_forbidden");
    throw new HttpError(502, `GitHub báo lỗi: ${msg}`, "github_error");
  }
  return data;
}

export const repoInfo = (env: Env, repo: string) => gh<{ default_branch: string; full_name: string }>(env, `/repos/${repo}`).then((r) => r!);
export async function tree(env: Env, repo: string, ref: string): Promise<string[]> {
  const r = await gh<{ tree: { path: string; type: string }[]; truncated?: boolean }>(env, `/repos/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`);
  return (r?.tree || []).filter((x) => x.type === "blob").map((x) => x.path);
}
export async function readFile(env: Env, repo: string, path: string, ref: string): Promise<{ text: string; sha: string } | null> {
  const r = await gh<{ content?: string; sha: string; encoding?: string }>(env, `/repos/${repo}/contents/${enc(path)}?ref=${encodeURIComponent(ref)}`, {}, true);
  return r && r.content ? { text: unb64(r.content), sha: r.sha } : null;
}
export async function branchSha(env: Env, repo: string, branch: string): Promise<string | null> {
  const r = await gh<{ object: { sha: string } }>(env, `/repos/${repo}/git/ref/heads/${enc(branch)}`, {}, true);
  return r?.object.sha || null;
}
export async function createBranch(env: Env, repo: string, name: string, fromSha: string): Promise<void> {
  await gh(env, `/repos/${repo}/git/refs`, { method: "POST", json: { ref: `refs/heads/${name}`, sha: fromSha } });
}
export async function writeFile(env: Env, repo: string, path: string, contentB64: string, message: string, branch: string): Promise<string> {
  const cur = await gh<{ sha: string }>(env, `/repos/${repo}/contents/${enc(path)}?ref=${encodeURIComponent(branch)}`, {}, true);
  const r = await gh<{ commit: { sha: string } }>(env, `/repos/${repo}/contents/${enc(path)}`, { method: "PUT", json: { message, content: contentB64, branch, ...(cur?.sha ? { sha: cur.sha } : {}) } });
  return r!.commit.sha;
}
export async function openPr(env: Env, repo: string, head: string, base: string, title: string, body: string): Promise<{ number: number; html_url: string }> {
  const r = await gh<{ number: number; html_url: string }>(env, `/repos/${repo}/pulls`, { method: "POST", json: { title, head, base, body, draft: false } });
  return r!;
}
export async function prState(env: Env, repo: string, n: number): Promise<{ state: string; merged: boolean; head: { sha: string } }> {
  return (await gh<{ state: string; merged: boolean; head: { sha: string } }>(env, `/repos/${repo}/pulls/${n}`))!;
}

// Trạng thái build của một commit: check runs (Cloudflare Workers Builds) và commit status
export interface BuildState { state: "pending" | "success" | "failure" | "none"; checks: { name: string; state: string; url: string | null; summary: string }[]; preview: string | null; error: string }
export async function buildState(env: Env, repo: string, sha: string): Promise<BuildState> {
  const runs = await gh<{ check_runs: { name: string; status: string; conclusion: string | null; details_url: string | null; html_url: string | null; output?: { title?: string | null; summary?: string | null; text?: string | null } }[] }>(env, `/repos/${repo}/commits/${sha}/check-runs`, {}, true);
  const st = await gh<{ statuses: { context: string; state: string; target_url: string | null; description: string | null }[] }>(env, `/repos/${repo}/commits/${sha}/status`, {}, true);
  const checks = [
    ...(runs?.check_runs || []).map((c) => ({ name: c.name, state: c.status !== "completed" ? "pending" : c.conclusion === "success" || c.conclusion === "neutral" || c.conclusion === "skipped" ? "success" : "failure", url: c.details_url || c.html_url, summary: [c.output?.title, c.output?.summary, c.output?.text].filter(Boolean).join("\n").slice(0, 4000) })),
    ...(st?.statuses || []).map((s) => ({ name: s.context, state: s.state === "success" ? "success" : s.state === "pending" ? "pending" : "failure", url: s.target_url, summary: s.description || "" }))
  ];
  const state = !checks.length ? "none" : checks.some((c) => c.state === "failure") ? "failure" : checks.some((c) => c.state === "pending") ? "pending" : "success";
  const allText = checks.map((c) => `${c.url || ""} ${c.summary}`).join("\n");
  const preview = (allText.match(/https:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)*\.workers\.dev[^\s)"'<]*/i) || allText.match(/https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.pages\.dev[^\s)"'<]*/i) || [])[0] || null;
  return { state, checks, preview, error: checks.filter((c) => c.state === "failure").map((c) => `${c.name}: ${c.summary}`).join("\n").slice(0, 4000) };
}
