// Kiểu tối thiểu cho các binding Cloudflare mà app dùng.
// D1Database / Fetcher thật của Cloudflare đều khớp các interface này.

export interface DbResult<T = Record<string, unknown>> {
  results: T[];
  success: boolean;
  meta: { changes?: number; last_row_id?: number; [k: string]: unknown };
}

export interface DbStatement {
  bind(...values: unknown[]): DbStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<DbResult<T>>;
  run(): Promise<DbResult>;
}

export interface Db {
  prepare(query: string): DbStatement;
  batch(statements: DbStatement[]): Promise<DbResult[]>;
}

export interface AssetFetcher {
  fetch(request: Request): Promise<Response>;
}

export interface Env {
  DB: Db;
  ASSETS: AssetFetcher;
  APP_NAME?: string;
  SETUP_TOKEN?: string;
  ENCRYPTION_KEY?: string;
  MEDIA?: R2Like;
}

// Phần R2 app dùng (ảnh thật cho site Astro)
export interface R2Like {
  put(key: string, value: ArrayBuffer | Uint8Array, options?: { httpMetadata?: { contentType?: string; cacheControl?: string }; customMetadata?: Record<string, string> }): Promise<unknown>;
  head(key: string): Promise<unknown | null>;
}

export interface ExecCtx {
  waitUntil(promise: Promise<unknown>): void;
}

export interface CronEvent {
  cron: string;
  scheduledTime: number;
}

export interface User {
  id: number;
  email: string;
  name: string;
  role: "admin" | "editor" | "viewer";
  mustChangePassword?: boolean;
}
