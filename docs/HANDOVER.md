# Duy Ơi: tài liệu chuyển giao

Tài liệu cho người hoặc phiên Claude tiếp nhận dự án. Đọc hết file này trước khi sửa code.
Cập nhật lần cuối: 2026-11-18, ứng với commit `304adce` trên nhánh `main`.

Repo này **công khai**. File này không chứa key, mật khẩu, email riêng hay luật riêng của khách. Những thứ đó chủ dự án giữ riêng (xem mục 4.3).

---

## Mục lục

1. [Dự án là gì](#1-dự-án-là-gì)
2. [Trạng thái hiện tại](#2-trạng-thái-hiện-tại)
3. [Hạ tầng và triển khai](#3-hạ-tầng-và-triển-khai)
4. [Chuyển sang tài khoản Claude khác](#4-chuyển-sang-tài-khoản-claude-khác)
5. [Kiến trúc code](#5-kiến-trúc-code)
6. [Chức năng theo menu](#6-chức-năng-theo-menu)
7. [AI: prompt, model, chi phí](#7-ai-prompt-model-chi-phí)
8. [Luật bắt buộc](#8-luật-bắt-buộc)
9. [Quy trình làm việc](#9-quy-trình-làm-việc)
10. [Việc còn dở, rủi ro, nợ kỹ thuật](#10-việc-còn-dở-rủi-ro-nợ-kỹ-thuật)
11. [Lịch sử phát triển](#11-lịch-sử-phát-triển)
12. [Phụ lục](#12-phụ-lục)

---

## 1. Dự án là gì

**Duy Ơi** là nền tảng AI agent làm SEO, AEO, GEO cho các site **của riêng chủ dự án** (không bán cho khách).

- **Quy mô:** khoảng 10 site trước, có thể lên 30–40. Mỗi site là một thương hiệu riêng, có email, mạng xã hội và tài khoản riêng.
- **Loại site:**
  - Astro: code tĩnh, deploy lên Cloudflare Workers (Custom Domains), repo GitHub riêng.
  - WordPress: có site dùng Elementor, Rank Math, FlyingPress. Sau này có thể có WooCommerce.
  - Một số là site affiliate với bài "Best X / Top N".
- **Mục tiêu:** lên top Google (và được AI trích dẫn) cho mọi site, phần lớn việc tự động bằng AI. Mọi thay đổi đưa lên site thật đều qua **Gác cổng** (kiểm tự động) và **chủ dự án duyệt**.
- **Không làm:** dựng site (chủ dự án tự dựng bằng Claude), mua link, tác giả giả, tự đăng Reddit/Quora.
- **Tên miền app:** `https://duyoi.duy.digital`. Repo: `github.com/duycan2000/duyoi.duy.digital`.
- **Giao diện:** tiếng Việt, xưng "anh" với người dùng. Code và comment cũng tiếng Việt.

---

## 2. Trạng thái hiện tại

### 2.1 Số liệu

| Mục | Giá trị |
|---|---|
| Commit cuối | `304adce` (37 commit từ 2026-11-16) |
| Backend | 45 file TypeScript trong `src/` |
| Giao diện | 16 module JS trong `public/js/` |
| Migration | 21 file (`0001` → `0021`), khoảng 60 bảng |
| Test | 37 test API (Node, `node:sqlite`) và test plugin WordPress (PHP), đều đạt |
| Prompt AI | 19 prompt, mỗi bản cần được duyệt trước khi chạy |
| Plugin WordPress | Duy Ơi Connector 1.3.0 (`public/duyoi-connector.zip`) |

### 2.2 Đã chạy với dữ liệu thật hay chưa

Toàn bộ code đã test với **dữ liệu giả lập** (`tests/fake-site.mjs` giả site, WordPress, GitHub, Google, DataForSEO, OpenRouter, Cloudflare, mạng xã hội). Phía chủ dự án đã deploy app lên Cloudflare.

**Những tích hợp CHƯA thử với tài khoản thật:**

- Google Search Console và GA4 qua service account
- DataForSEO: SERP, Backlinks (từ 2026-07-01 trả theo lượt, không còn mức tối thiểu $100/tháng), Labs
- Cloudflare: Email Service (gửi), Email Routing (nhận), Analytics Engine SQL API, R2
- Pinterest, Meta (Facebook/Instagram/Threads), LinkedIn, X (OAuth), Bluesky, Postiz
- IndexNow (api.indexnow.org)
- Feed Google Search Status Dashboard (`status.search.google.com/incidents.json`), đọc phòng thủ, chưa thấy dữ liệu thật

**Việc đầu tiên nên làm:** mở trang **Kiểm tra kết nối** trên app thật, bấm "Kiểm tra tất cả", rồi sửa từng lỗi (xem mục 10.1).

### 2.3 Chủ dự án cần duyệt

- Prompt ở Agent HQ › Quản lý: mọi prompt mới hoặc vừa đổi đều ở trạng thái chờ duyệt. Prompt mới nhất là `quickwin_meta`.
- Mỗi tên miền dùng để gửi email (outreach, báo cáo tuần) phải bật ở Cloudflare › Email Service › Sending.

---

## 3. Hạ tầng và triển khai

### 3.1 Tài nguyên Cloudflare

Tất cả nằm trong **một** tài khoản Cloudflare của chủ dự án, chung với các site.

| Tài nguyên | Tên / giá trị | Ghi chú |
|---|---|---|
| Worker | `duyoi` | `src/index.ts`, static assets ở `public/` (giao diện không tính request Worker) |
| Tên miền | `duyoi.duy.digital` (custom domain) | Zone `duy.digital` cùng tài khoản |
| D1 | `duyoi`, id `d3d86a5f-fdcf-4f42-9170-9ca0c6ed3d4a` | binding `DB`, migrations ở `migrations/` |
| R2 | `duyoi-media` | binding `MEDIA`; ảnh thật cho site Astro, mỗi site gắn tên miền ảnh riêng |
| Email gửi | binding `EMAIL` (`send_email`) | Cloudflare Email Service |
| Email nhận | Email Routing → Worker `duyoi` (handler `email()`) | quy tắc tạo từ Off-page › Dựng hộp thư |
| Cron | `*/15`, `5-59/15`, `10-59/15` | 3 lịch, xem 5.4 |
| Observability | bật, lấy mẫu 20% | |
| Worker phụ | `duyoi-stats-*`, `duyoi-img-*` | app tự tạo qua Cloudflare API cho bộ đo và kho ảnh từng site |

Cấu hình đầy đủ: `wrangler.jsonc`.

### 3.2 Triển khai

- **Workers Builds** của Cloudflare nối với repo GitHub. Push lên `main` là tự build và deploy. Lệnh deploy nên áp migration D1 trước rồi mới deploy, ví dụ `npx wrangler d1 migrations apply duyoi --remote && npx wrangler deploy`. Lệnh thực tế xem ở Cloudflare › Workers › duyoi › Settings › Build; kiểm tra lại khi tiếp nhận.
- **GitHub Actions** (`.github/workflows/ci.yml`): mỗi push và pull request chạy `npm run typecheck` và `npm test` trên Node 22.
- Deploy tay (khi cần): `npm run db:migrate:remote` rồi `npm run deploy`.
- Workers Builds triển khai bằng kết nối GitHub ↔ Cloudflare, **không phụ thuộc tài khoản Claude**. Đổi tài khoản Claude không ảnh hưởng deploy.

### 3.3 Secrets

**Secret của Worker** (đặt bằng `wrangler secret put` hoặc trên dashboard, không nằm trong repo):

| Tên | Dùng để |
|---|---|
| `SETUP_TOKEN` | mã dùng một lần để tạo admin đầu tiên |
| `ENCRYPTION_KEY` | 32 byte base64, mã hoá AES-GCM mọi API key lưu trong D1. **Mất khoá này là mất toàn bộ key đã lưu.** |

**API key nhập trong app** (Cài đặt › API key, lưu mã hoá ở bảng `secrets`, không bao giờ trả về trình duyệt; danh sách ở `SECRET_KEYS` trong `src/settings.ts`):

- `openrouter_api_key`, `groq_api_key`
- `dataforseo_login`, `dataforseo_password`
- `cloudflare_api_token` (kèm cài đặt `cloudflare_account_id`)
- `google_api_key`, `google_service_account` (JSON)
- `github_token`
- `pinterest_app_id/secret`, `meta_app_id/secret`, `linkedin_client_id/secret`, `x_client_id/secret`

Ngoài ra còn secret theo từng site trong cùng bảng, mã hoá cùng khoá:

- `wp:<siteId>`: Application Password WordPress
- `social:<accId>`: token mạng xã hội
- `app:<siteId>:<network>`: app developer riêng của từng site
- `postiz:<siteId>`

### 3.4 Cài đặt mặc định đáng chú ý

Định nghĩa ở `DEFAULTS` trong `src/settings.ts`, sửa được ở Cài đặt › Model AI & chi phí.

- **Trần chi tiêu:**
  - OpenRouter $30/tháng, DataForSEO $20/tháng, AI mỗi site $2/ngày
  - Model miễn phí dừng khi chạm 90% hạn mức
- **Model:**
  - `model_t0` deepseek-v4-flash, `model_t1` deepseek-v4-pro
  - `model_t2` claude-haiku-5.5, `model_t3` claude-sonnet-5.5
  - Viết bài: `model_writer` claude-sonnet-5.5; ảnh: `model_image` openai/gpt-image-2
- **Múi giờ:** `Asia/Ho_Chi_Minh`
- **Tạm dừng toàn hệ thống:** nút trên Tổng quan (`settings.paused`) dừng jobs, autopilot, off-page, theo dõi, semantic.

---

## 4. Chuyển sang tài khoản Claude khác

### 4.1 Cái gì giữ nguyên

- Repo GitHub, Cloudflare (Worker, D1, R2, Email, cron), dữ liệu trong D1, các API key đã lưu, deploy tự động.
- App đang chạy không biết và không cần biết tài khoản Claude nào sửa code.

### 4.2 Cái gì KHÔNG đi theo

- Lịch sử chat và bộ nhớ (memory) của tài khoản cũ. Mọi ngữ cảnh cần thiết nằm trong repo (file này, `README.md`, `CLAUDE.md`, `docs/ROADMAP.md`) và trong ghi chú riêng của chủ dự án.
- Các connector đã nối ở tài khoản cũ (Figma, Google Drive, Chrome…) phải nối lại nếu cần.

### 4.3 Chủ dự án làm gì

1. Ở tài khoản Claude mới: Settings › Connectors › GitHub, cài GitHub App cho repo `duycan2000/duyoi.duy.digital` với quyền **ghi** (để push).
2. Tạo một Project cho Duy Ơi. Dán vào phần instructions của Project nội dung **ghi chú riêng** (file `HANDOVER-PRIVATE.md` chủ dự án giữ, không commit). Ghi chú gồm: danh sách site thật, luật riêng từng site, cách chủ dự án muốn làm việc.
3. Phiên đầu tiên, gửi cho Claude: "Đọc `docs/HANDOVER.md`, `CLAUDE.md`, `README.md` rồi chạy kiểm tra như mục 4.4."
4. Nếu Claude mới không cần push nữa: gỡ quyền của tài khoản cũ ở GitHub › Settings › Applications.

### 4.4 Việc đầu tiên của phiên Claude mới

```bash
git clone https://github.com/duycan2000/duyoi.duy.digital
cd duyoi.duy.digital
node --version            # cần 22.5+ (test dùng node:sqlite)
npm install
npm run typecheck
npm test                  # phải thấy toàn bộ ✓ và "Tất cả test PHP đạt."
git log --oneline -5      # commit cuối lúc chuyển giao: 304adce
```

Nếu `npm test` báo thiếu PHP thì cài `php-cli`; test plugin chạy bằng `php wordpress/tests/test.php`.

---

## 5. Kiến trúc code

### 5.1 Nguyên tắc

- Worker TypeScript, **không framework, không dependency lúc chạy**. Chỉ có `typescript` và `wrangler` trong devDependencies.
- Giao diện: JS thuần (ES modules) trong `public/js`, **không bước build**. CSP chặt: không inline script, không inline style. Mọi style là class trong `public/css/app.css`.
- Router: một hàm lớn trong `src/index.ts`, so `path`/`method` hoặc regex. Hàm API trả `json(...)`, lỗi ném `HttpError(status, message, code)`.
- Dữ liệu: D1 (SQLite). Mỗi thay đổi schema là một migration mới; **không sửa migration đã chạy**.
- Việc dài: hàng đợi `jobs`/`agent_jobs` trong D1, cron xử lý từng lô có hạn thời gian.

### 5.2 Backend (`src/`)

| File | Vai trò |
|---|---|
| `index.ts` | Router `/api/*`, handler `email()` (thư đến), `scheduled()` (cron 3 nhóm) |
| `http.ts` | `json`, `HttpError`, `readJson`, cookie, chặn CSRF theo `Origin` |
| `auth.ts`, `users.ts` | Tạo admin, đăng nhập, phiên, khoá sau 5 lần sai, thành viên (admin/editor/viewer) |
| `crypto.ts` | PBKDF2 (mật khẩu), AES-GCM (API key), `encryptionProblem` |
| `settings.ts` | Cài đặt, `SECRET_KEYS`, `readSecret()` (đường duy nhất để đọc key), `DEFAULTS` |
| `sites.ts` | CRUD site, kết nối WordPress, repo Astro |
| `dashboard.ts`, `activity.ts` | Tổng quan, tạm dừng, nhịp cron; nhật ký `logActivity(env, actor, action, detail, siteId)` |
| `ai.ts` | `aiJson()` gọi OpenRouter theo tầng model, `writingRules()`, ghi `ai_calls`, chặn khi vượt trần |
| `manager.ts` | Danh sách `PROMPTS` (19), duyệt prompt theo phiên bản, chi tiêu theo agent |
| `dataforseo.ts` | `call()` có Budget Guard; SERP, Labs, traffic, `rankCheck`, `backlinkSummary`, `backlinkChanges` |
| `google.ts` | JWT service account, `gscByPage`, `gscTraffic`, `ga4ByPage`, `gpost` |
| `google-updates.ts` | Danh sách cập nhật Google (tĩnh) + gộp với feed Status Dashboard |
| `web.ts` | `fetchText`, `pageInfo`, `sitemapUrls`, email liên hệ, ảnh thật trong bài |
| `recovery*.ts` | Phục hồi thứ hạng: `recovery.ts` (ca, áp dụng, hoàn tác), `-extract` (đọc trang), `-analyze` (agent chẩn đoán, `RECOVERY_AGENTS`), `-gate` (Gác cổng `checkEdits`), `-rules` (`SiteRules`) |
| `wordpress.ts` | Gọi plugin Duy Ơi Connector: `wpCall`, `wpGetPost`, `wpApply` (có `dry_run`), `wpRestore` |
| `content.ts`, `formats.ts`, `style.ts`, `docs.ts` | Content Studio: ý tưởng, dàn ý, viết, Biên tập viên, định dạng bài, giọng văn, tài liệu PDF |
| `images.ts`, `media.ts`, `cfmedia.ts` | Ảnh bài (model trả phí), R2, Worker ảnh từng site, `cf()`/`creds()` gọi Cloudflare API |
| `github.ts`, `publish.ts` | API GitHub (nhánh, file, PR), hồ sơ đăng bài Astro tự đọc từ repo |
| `affiliate.ts` | Thư viện link affiliate, chèn vào bài đã đăng (WordPress hoặc PR) |
| `lead.ts`, `autopilot.ts`, `hq.ts` | Trưởng nhóm (chat, giao việc), chế độ tự động, dữ liệu Agent HQ |
| `offpage.ts`, `social.ts`, `manual.ts`, `indexnow.ts` | Off-page: Prospector, Outreach, thư đến, Community, Link Monitor, Citations; mạng xã hội (OAuth, Postiz); link building làm tay; IndexNow |
| `stats.ts` | Bộ đo riêng: Worker trên tên miền site → Analytics Engine → gộp vào D1 |
| `monitor.ts` | Thứ hạng & cảnh báo: GSC hằng ngày, vị trí từ khoá, backlink, phát hiện tụt, chẩn đoán, phương án |
| `semantic.ts` | Chấm semantic (Topical Authority), Core/Outer, truy vấn mở rộng, Source Context, thực thể web; `draftChecks` cho Gác cổng bài nháp |
| `health.ts` | Kiểm tra kết nối (chỉ đọc) |
| `quickwins.ts` | Quick wins: tìm từ GSC, AI viết title/meta, Gác cổng, duyệt, ghi WordPress/PR Astro, hoàn tác |
| `report.ts` | Báo cáo tuần qua email |
| `types.ts` | `Env`, `User`, `Db`, `EmailSender`… |

### 5.3 Giao diện (`public/`)

- `index.html`: khung trang. `css/app.css`: toàn bộ style.
- `js/app.js`: router hash (`#/view/arg`), sidebar, các màn cũ (Tổng quan, Site, Cài đặt, Nhật ký, Lộ trình…), helper `tabsNav`/`panelAttr`/`bindTabs`. Bảng `views` nối id menu với hàm vẽ màn.
- `js/menu.js`: cấu trúc menu.
  - `live: true` là màn đã chạy.
  - Mục có `phase` là mục chưa làm, chỉ hiện ở trang Lộ trình.
  - `hidden: true` là đường dẫn phụ trỏ vào màn khác.
- Mỗi màn lớn một module: `hq.js`, `recovery.js`, `studio.js`, `affiliate.js`, `offpage.js`, `manual.js`, `stats.js`, `rankings.js`, `semantic.js`, `health.js`, `quickwins.js`, `report.js`.
- `js/ui.js`: `$`, `$$`, `esc` (**bắt buộc** cho mọi dữ liệu vào HTML), `showMsg`, `busy(btn, label, fn)`, `ago`, `fmtTime`. `js/api.js`: `api(path, { method, body })`.
- `public/_headers`: CSP và header bảo mật.

### 5.4 Cron

Ba lịch lệch 5 phút. Mỗi lịch là một lần chạy riêng với hạn mức riêng: D1 cho tối đa 1000 truy vấn mỗi lần Worker chạy trên gói trả phí. Mỗi bước có `try/catch` riêng, bước lỗi không chặn bước sau.

| Lịch | Bước |
|---|---|
| A `*/15 * * * *` | nhịp cron → hàng đợi Phục hồi → jobs (đến 5 phút) → autopilot (đến 9 phút) → đồng bộ PR GitHub |
| B `5-59/15 * * * *` | Số liệu site → Off-page (đến 8 phút) → Kiểm tra kết nối (mỗi ngày) → Báo cáo tuần (đúng thứ/giờ) |
| C `10-59/15 * * * *` | Theo dõi (tối đa 4 site có việc mỗi lượt, 2 site đọc GSC) → Semantic (1 site/lượt, mỗi site 7 ngày) |

Đã đo với 10 site trên dữ liệu giả: A khoảng 10, B khoảng 206, C khoảng 470 truy vấn mỗi lượt. Khi thêm việc vào cron, đo lại bằng cách bọc `env.DB.prepare` đếm truy vấn (xem 9.4).

### 5.5 Plugin WordPress (`wordpress/duyoi-connector/`)

- **Xác thực:** Application Password, REST namespace của plugin.
- **Endpoint chính:**
  - `/ping`: phiên bản, có Rank Math/Elementor không
  - `/post`: đọc bài theo URL, kèm `meta` và `modified_gmt`
  - `/apply`: sửa theo `find/replace`, có `dry_run` và `expected_modified` để chống ghi đè; `meta` cho `rank_math_*`; `mode` `wrap_link`/`swap_url` cho affiliate
  - `/restore`: hoàn tác từ bản sao lưu
  - `/indexnow-key`: khoá IndexNow
  - Elementor: sửa trong `_elementor_data`, không sửa `post_content`
  - Xoá cache (FlyingPress…) sau khi sửa
- **Khi sửa plugin:** tăng `Version:`, chạy `php wordpress/tests/test.php`, rồi `npm run -s plugin:zip` để cập nhật `public/duyoi-connector.zip`.

### 5.6 Dữ liệu (nhóm bảng)

Chi tiết từng migration ở phụ lục 12.2.

- **Nền tảng:** `users`, `sessions`, `login_attempts`, `settings`, `secrets`, `sites`, `jobs`, `usage_events`, `activity`
- **AI và quản lý:** `prompt_reviews`, `ai_calls`, `agent_jobs`, `lead_messages`, `lead_playbook`
- **Phục hồi:** `recovery_cases/pages/findings/tasks/backups`
- **Nội dung:** `content_ideas`, `site_docs`, `site_profiles`, `autopilot_state`, `affiliate_*`
- **Số liệu:** `stats_domains/daily/clicks/sources`
- **Off-page:** `op_settings/prospects/messages/inbox/threads/links/citations/kits/manual`, `social_accounts/posts/seen`, `oauth_states`, `indexnow`, `indexnow_log`
- **Theo dõi:** `mon_state/daily/pages/queries/keywords/rank_history/backlinks/bl_changes/alerts`, `google_updates`
- **Semantic:** `sem_audits`, `sem_pages`
- **Mới nhất:** `health_checks`, `qw_items`, `report_log`

---

## 6. Chức năng theo menu

Menu hiện có 16 mục. Các tab Off-page (Prospects, Email, Backlink, Citations, Entity) vẫn mở được bằng đường dẫn cũ nhưng không chiếm chỗ trên menu.

| Menu | Module | Làm gì |
|---|---|---|
| Tổng quan | `app.js`, `dashboard.ts` | Số liệu chính, bước bắt đầu, hoạt động gần đây, nút tạm dừng |
| Agent HQ | `hq.js`, `hq.ts`, `manager.ts`, `lead.ts` | Văn phòng 3D các agent theo phòng (Phục hồi, Nội dung, Off-page, Theo dõi); Quản lý (duyệt prompt, chi tiêu); chat với Trưởng nhóm; sổ tay luật |
| Thứ hạng & cảnh báo | `rankings.js`, `monitor.ts` | GSC hằng ngày, từ khoá theo dõi (tự chọn + tay) kiểm qua DataForSEO SERP, backlink hằng tuần, cảnh báo tụt + chẩn đoán + phương án |
| Số liệu site | `stats.js`, `stats.ts` | Bộ đo riêng cho site Astro (thêm được trước khi site chạy) |
| Phục hồi thứ hạng | `recovery.js`, `recovery*.ts` | Quét site → agent chẩn đoán → đề xuất sửa → Gác cổng → duyệt → áp dụng WordPress (sao lưu, hoàn tác) |
| Site | `app.js`, `sites.ts` | Thêm site, kết nối WordPress/GitHub, luật riêng từng site (`SiteRules`) |
| Topical & Semantic | `semantic.js`, `semantic.ts` | Chấm trang theo Topical Authority, Core/Outer, truy vấn mở rộng, loại site đứng top, thực thể web |
| Content Studio | `studio.js`, `content.ts`, `formats.ts` | Ý tưởng → dàn ý → viết (hoặc chủ dự án tự viết) → Biên tập viên → Gác cổng → đăng WordPress hoặc PR Astro; link affiliate |
| Quick wins | `quickwins.js`, `quickwins.ts` | Trang vị trí 4–15 CTR thấp → title/meta mới qua Gác cổng → duyệt → ghi |
| Off-page | `offpage.js`, `manual.js`, `offpage.ts`, `social.ts`, `manual.ts` | Prospector, Outreach (duyệt từng thư), hộp thư, mạng xã hội tự đăng khi qua Gác cổng, Community (nháp, chủ dự án tự đăng), link building làm tay, Link Monitor, Citations, IndexNow |
| Thành viên | `app.js`, `users.ts` | Admin/Biên tập/Chỉ xem |
| Kiểm tra kết nối | `health.js`, `health.ts` | Gọi thật từng dịch vụ (chỉ đọc), tự chạy mỗi ngày |
| Lộ trình | `app.js` (`viewRoadmap`) | Các màn chưa làm |
| Nhật ký, Cài đặt, Tài khoản | `app.js`, `report.js` | Cài đặt có tab API key, Model AI & chi phí, Báo cáo tuần |

**Chi tiết hành vi từng chức năng:** xem `README.md`. Mỗi chức năng có một mục riêng, mô tả ngưỡng, luật và cách duyệt.

---

## 7. AI: prompt, model, chi phí

- **Gọi AI:** `aiJson(env, { template, task, siteId, rules, input })`.
  - `template` là id prompt trong `PROMPTS` (`src/manager.ts`).
  - `rules` thường là `writingRules(lang, numbers, blocklist)`, được chèn vào chỗ `{{RULES}}` trong system prompt.
- **Duyệt prompt:** mỗi prompt có phiên bản tính từ nội dung. Đổi một ký tự là thành bản mới và phải duyệt lại ở Agent HQ › Quản lý. Prompt chưa duyệt thì API trả 403.
  - System prompt tối đa khoảng 3400 ký tự, có `{{RULES}}`; lint giới hạn 8000 token.
  - **Khi thêm hoặc sửa prompt:** cập nhật fake trả lời trong `tests/fake-site.mjs` (nhánh theo nội dung system prompt), cập nhật số `promptsPending` mà test mong đợi trong `tests/run.mjs` (hiện là 13), và báo chủ dự án cần duyệt.
- **19 prompt** (id → agent):
  - Nội dung: `doc_profile`, `web_facts`, `voice_profile`, `article_review`, `article_revise`, `content_brief`, `article_draft`
  - Trưởng nhóm: `lead_plan`
  - Off-page: `outreach_draft`, `outreach_review`, `community_answer`, `social_caption`, `manual_kit`, `pr_answer`
  - Phục hồi: `link_sentence`, `cta_sentence`, `geo_answers`
  - Quick wins: `quickwin_meta`
- **Chi phí:**
  - Mỗi lệnh AI ghi `ai_calls`; mỗi lệnh DataForSEO ghi `usage_events`.
  - Vượt trần tháng hoặc trần ngày/site thì dừng.
  - Hai chức năng tốn tiền nhất: Theo dõi (mỗi từ khoá 1 lệnh SERP, mặc định 20 từ khoá, 3 ngày một lần) và Backlink (3 lệnh/site/tuần).

---

## 8. Luật bắt buộc

### 8.1 Code

- Mọi dữ liệu đưa vào HTML phải qua `esc()`.
- Không inline script hoặc style (CSP). Thêm class vào `app.css`.
- Schema: migration mới, không sửa file cũ.
- API key chỉ đọc qua `readSecret()`. Không trả key ra API, không ghi key vào log hay nhật ký.
- Trước khi commit: `npm run typecheck` và `npm test` phải đạt.
- Chữ trên giao diện: tiếng Việt ngắn, rõ, xưng "anh".
- Repo công khai: không commit secret, email riêng, hay luật riêng của khách (blocklist, ghi chú pháp lý). Những thứ này nhập trong app (luật site lưu ở D1).

### 8.2 Sản phẩm

- Không mua link, không trao đổi link, không PBN.
- Không tác giả giả. Không viết "we tested" hay "đã test" khi chưa test. Không cam kết "số 1".
- Không dùng ảnh AI giả làm ảnh thật. Ảnh sản phẩm affiliate dùng ảnh thật do chủ dự án tải lên. Không tạo ảnh CAD/BIM bằng AI.
- Site tiếng Đức: không gửi email lạnh (luật UWG). Mỗi site chỉ viết đúng một ngôn ngữ đã đặt.
- Không tự đăng Reddit/Quora: chỉ soạn nháp, chủ dự án tự đăng.
- Không có số liệu thì không bịa: Gác cổng chặn con số không có trong trang hoặc trong `verifiedNumbers`.

### 8.3 An toàn khi sửa site thật

- Sửa kiểu phẫu thuật (tìm/thay đúng đoạn), không ghi đè cả bài.
- Trang Elementor: sửa `_elementor_data`.
- Sao lưu trước mỗi lần ghi, luôn có đường hoàn tác.
- Không bao giờ tự đăng công khai. Bài mới lên dạng nháp (WordPress) hoặc pull request (Astro).
- Redirect, đổi canonical, xoá trang, và sửa hàng loạt trên 3 trang cần chủ dự án duyệt rõ ràng (`confirmBulk`).
- Xoá cache (FlyingPress…) sau khi sửa.
- Blocklist của site: trùng là chặn cứng.
- Cập nhật lõi của Google đang rollout: chỉ theo dõi, chưa sửa nội dung.

---

## 9. Quy trình làm việc

### 9.1 Chạy thử trên máy

```bash
node tests/serve.mjs                 # http://localhost:8788, SETUP_TOKEN=local-setup-token, dữ liệu trong bộ nhớ
FAKE_SITE=1 node tests/serve.mjs     # kèm site/API giả (caddemo.de…)
```

Hoặc dùng wrangler: `cp .dev.vars.example .dev.vars`, `npm run db:migrate:local`, `npm run dev`.

### 9.2 Test

- `tests/run.mjs`: biên dịch TypeScript ra `.test-build`, chạy Worker trong Node với `node:sqlite` thay D1. Mỗi test dùng `makeEnv()` và `client(env)` (gửi request kèm cookie, `Origin`, `CF-Connecting-IP`).
- `tests/harness.mjs`: `loadWorker`, `makeEnv`.
- `tests/fake-site.mjs` → `fakeSite(opts)` thay `globalThis.fetch`. Các tuỳ chọn:
  - `host` (mặc định `caddemo.de`), `web` (trang ngoài theo URL), `extra` (trang động + sitemap)
  - `wp` (WordPress giả, ghi `wp.calls`), `gh` (GitHub giả: nhánh, file, PR)
  - `cf` (Cloudflare giả), `social` (ghi bài đăng, IndexNow)
  - `mon` (GSC theo `dimensions`, ranks, backlinks, incidents)
  - `gscDeny`, `dfsBalance`, `qwBad`
- Gửi email trong test: gán `env.EMAIL = { send: async (m) => … }`.
- Khi thêm chức năng: thêm test vào `tests/run.mjs` trước test "đường dẫn không phải /api trả giao diện (SPA)".

### 9.3 Kiểm tra giao diện

Dùng Playwright với Chrome (`/usr/bin/google-chrome`). Viết script ngoài repo, chạy `serve.mjs` riêng với fake, gọi API để dựng dữ liệu, rồi:

- `page.reload()` sau khi tạo admin (SPA không tự kiểm lại phiên)
- chụp màn hình
- kiểm lỗi console
- kiểm tràn ngang ở 390px (`scrollWidth > clientWidth`)

### 9.4 Đo số truy vấn D1 của cron

Bọc `env.DB.prepare` và `env.DB.batch` để đếm, rồi gọi `worker.scheduled({ cron: "<lịch>" }, env, ctx)` với 10 site giả. Mỗi lịch phải dưới 1000.

### 9.5 Commit và push

- Commit message tiếng Việt: dòng đầu tóm tắt, thân gạch đầu dòng.
- Kết thúc commit message bằng dòng attribution theo hướng dẫn của phiên Claude đang làm.
- Push lên `main` (Workers Builds tự deploy): `git -c push.negotiate=true push -q origin main`.
- Sửa plugin thì chạy `npm run -s plugin:zip` trước khi commit.
- Cập nhật `README.md` (mục chức năng và cấu trúc) và `docs/ROADMAP.md` khi thêm hoặc đổi chức năng. Cập nhật file này khi đổi hạ tầng, cron, luật hay quy trình.

---

## 10. Việc còn dở, rủi ro, nợ kỹ thuật

### 10.1 Ưu tiên ngay

1. **Chạy với tài khoản thật.** Nối 1–2 site thật từ đầu đến cuối, bắt đầu bằng Search Console + DataForSEO. Dùng trang Kiểm tra kết nối, sửa từng lỗi. Phần dễ vỡ nhất:
   - định dạng trả về thật của DataForSEO Backlinks/SERP so với fake
   - Analytics Engine SQL
   - Email Service: định dạng `send()` và tên miền gửi
   - OAuth từng mạng xã hội: redirect URI phải khớp `https://duyoi.duy.digital/api/social/oauth/callback`
2. **Duyệt prompt.** Chủ dự án duyệt prompt đang chờ, nhất là `quickwin_meta`.
3. **Kiểm lệnh deploy của Workers Builds** có áp migration (3.2).

### 10.2 Trùng lặp nên gộp

- Ba bộ quét trang riêng: Phục hồi (`recovery-extract`), Semantic (`semantic.ts`), kiểm kỹ thuật của Drop Doctor (`monitor.ts`). Nên quét một lần, lưu ảnh chụp trang, ba bên dùng chung.
- Agent "Kiến trúc nội dung" (Phục hồi) và bản đồ Core/Outer (Semantic) làm gần như cùng việc.
- Off-page quá rộng cho 10 site, mỗi site một bộ tài khoản: 13 mạng xã hội, 8 cách link tay. Nên chọn 2–3 kênh mỗi site.

### 10.3 Giới hạn đã biết

- **Thứ hạng:** chưa tách desktop/mobile, chưa xuất CSV.
- **Backlink:** chỉ dùng DataForSEO. Bing Webmaster API (miễn phí, `GetLinkCounts`/`GetUrlLinks`) chưa tích hợp.
- **Quick wins Astro:** tìm file theo slug cuối URL. Repo đặt tên file khác slug thì báo không tìm thấy. Frontmatter `title` thường cũng là H1.
- **Quick wins WordPress:** chỉ ghi qua Rank Math.
- **Semantic:** phân loại Core/Outer theo đường dẫn và tín hiệu trong HTML, có thể sai. Chưa dùng AI cho Entity–Attribute–Value.
- **Danh sách cập nhật Google tĩnh:** core update tháng 11/2026 (bắt đầu 2026-11-10) đang để `end: null`. Feed Status Dashboard sẽ điền ngày kết thúc khi đọc được.
- **Cron:** Worker có giới hạn CPU, phần lớn thời gian là chờ mạng. Nếu số site tăng mạnh (30–40), xem lại số site mỗi lượt ở `runMonitor`, `runOffpage`.

### 10.4 Lộ trình (chưa làm)

Danh sách đầy đủ ở trang Lộ trình trong app và `docs/ROADMAP.md`:

- Project context đầy đủ
- Keyword Hub
- Pages
- Site audit (DataForSEO On-Page)
- Kiểm tra kỹ thuật (CrUX, index)
- AI visibility
- Tìm site mua lại
- Lịch chạy bằng Queues
- Prompt Optimizer

---

## 11. Lịch sử phát triển

| Ngày | Mốc |
|---|---|
| 2026-11-16 | Nền tảng: admin, đăng nhập, site, API key mã hoá, tạm dừng, nhật ký, cron; menu mobile |
| 2026-11-17 | Giao diện mới; Thành viên; Phục hồi thứ hạng (quét, chẩn đoán, Gác cổng, áp dụng WordPress, sao lưu, hoàn tác); GSC/GA4; Agent HQ + Quản lý prompt; Content Studio (định dạng chuẩn, ảnh thật R2, tài liệu PDF, Biên tập viên, Trưởng nhóm + sổ tay, giọng văn, phỏng vấn trải nghiệm, tra Google có nguồn); đăng Astro qua GitHub; link affiliate; văn phòng 3D |
| 2026-11-18 | Số liệu site (bộ đo riêng); Off-page tự động (Prospector, Outreach, Social, Community, Link Monitor, Citations), tài khoản riêng từng site, IndexNow, Postiz, Pin mới; link building làm tay; Thứ hạng & cảnh báo; Topical & Semantic; rà soát (cron 3 lịch, menu gọn); Kiểm tra kết nối, Quick wins, Báo cáo tuần |

Xem chi tiết: `git log`.

---

## 12. Phụ lục

### 12.1 Nhóm API

Nguồn chính xác: `src/index.ts`. Mọi route cần đăng nhập, trừ `setup`, `auth/login`, `health`, `social/oauth/callback`. Route thay đổi dữ liệu cần `Origin` trùng app. Viewer chỉ đọc.

| Tiền tố | Nội dung |
|---|---|
| `/api/health` | Kiểm tra sống (công khai) |
| `/api/setup`, `/api/auth/*`, `/api/users*` | Cài đặt lần đầu, đăng nhập, phiên, thành viên |
| `/api/dashboard`, `/api/system/pause`, `/api/activity` | Tổng quan, tạm dừng, nhật ký |
| `/api/settings` | Cài đặt và API key |
| `/api/sites*` | Site, WordPress, repo, luật site |
| `/api/hq`, `/api/manager/*`, `/api/lead*` | Agent HQ, duyệt prompt, chi tiêu, Trưởng nhóm |
| `/api/recovery*` | Phục hồi thứ hạng |
| `/api/content*` | Content Studio, ý tưởng, bài, đăng |
| `/api/affiliate*` | Link affiliate |
| `/api/offpage*`, `/api/social*` | Off-page, mạng xã hội, OAuth |
| `/api/stats*` | Số liệu site |
| `/api/monitor*` | Thứ hạng & cảnh báo |
| `/api/semantic*` | Topical & Semantic |
| `/api/connections*` | Kiểm tra kết nối |
| `/api/quickwins*` | Quick wins |
| `/api/report*` | Báo cáo tuần |

### 12.2 Migration

| File | Bảng mới / thay đổi |
|---|---|
| 0001_init | users, sessions, login_attempts, settings, secrets, sites, jobs, usage_events, activity |
| 0002_members | users: disabled, must_change_password, created_by |
| 0003_recovery | recovery_cases, recovery_pages, recovery_findings, recovery_tasks |
| 0004_wp_gsc | recovery_backups; recovery_pages.traffic |
| 0005_manager_content | prompt_reviews, ai_calls, content_ideas, autopilot_state |
| 0006–0008 | content_ideas: format, products, images, source; sites: media_base_url, media_bucket, media_verified_at |
| 0009_docs_review_lead | site_docs, site_profiles, agent_jobs, lead_messages |
| 0010_lead_playbook | lead_playbook |
| 0011–0013 | content_ideas: interview, author, approved_at, pr; sites.publish_profile |
| 0014_affiliate_links | affiliate_links, affiliate_edits, affiliate_applies |
| 0015_stats | stats_domains, stats_daily, stats_clicks, stats_sources |
| 0016_offpage | op_settings, op_prospects, op_messages, op_inbox, op_threads, op_links, op_citations, social_accounts, social_posts, social_seen, oauth_states |
| 0017_indexnow_postiz_freshpins | indexnow, indexnow_log; dựng lại social_posts (variant, images) |
| 0018_manual_linkbuilding | op_kits, op_manual |
| 0019_monitor | mon_state, mon_daily, mon_pages, mon_queries, mon_keywords, mon_rank_history, mon_backlinks, mon_bl_changes, mon_alerts, google_updates |
| 0020_semantic | sem_audits, sem_pages |
| 0021_health_quickwins_report | health_checks, qw_items, report_log |

### 12.3 Địa chỉ ngoài app gọi tới

| Dịch vụ | Địa chỉ |
|---|---|
| OpenRouter | `openrouter.ai/api/v1/chat/completions`, `/api/v1/key` |
| DataForSEO | `api.dataforseo.com/v3/…` (SERP, Labs, Backlinks, `appendix/user_data`) |
| Google | `oauth2.googleapis.com/token`, `www.googleapis.com/webmasters/v3/…`, `analyticsdata.googleapis.com` |
| Cloudflare | `api.cloudflare.com/client/v4/…` (Workers, routes, R2, Email Routing, Analytics Engine SQL, tokens/verify) |
| GitHub | `api.github.com` |
| IndexNow | `api.indexnow.org/indexnow` |
| Google Search Status | `status.search.google.com/incidents.json` |
| Mạng xã hội | API Pinterest, Graph (Meta), LinkedIn, X, Bluesky (`bsky.social`), Postiz (tự host hoặc cloud) |

### 12.4 Tài liệu khác trong repo

- `README.md`: cài đặt, deploy, mô tả chi tiết từng chức năng, bảo mật, chi phí.
- `CLAUDE.md`: luật ngắn cho Claude (luôn được nạp).
- `docs/ROADMAP.md`: lộ trình theo giai đoạn.
- `docs/prototype.html`: bản demo giao diện đã duyệt ban đầu.
