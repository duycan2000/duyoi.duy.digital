# Duy Ơi

Nền tảng AI agent làm SEO, AEO và GEO cho nhiều site. Chạy hoàn toàn trên Cloudflare: Workers, D1, và từ các giai đoạn sau thêm Queues, Workflows, R2, Email Routing.

App **không dựng site**. Anh dựng site bằng Claude, rồi khai báo site ở đây để các agent nghiên cứu, viết bài, theo dõi thứ hạng, làm off-page.

> Bản này là **giai đoạn 1 (nền tảng)**: màn tạo admin, đăng nhập, quản lý site, cài đặt API key được mã hoá, tạm dừng hệ thống, nhật ký, cron.
> Menu đã có đủ các mục như bản demo. Mục nào chưa làm thì hiện nội dung sẽ có và thuộc giai đoạn nào. Xem [docs/ROADMAP.md](docs/ROADMAP.md).

## Deploy lần đầu

Cần: Node 22 trở lên, tài khoản Cloudflare. Giai đoạn 1 chạy được trên gói Workers Free. Từ giai đoạn 2 (Queues, Workflows) nên dùng gói Workers Paid $5/tháng.

```bash
git clone https://github.com/duycan2000/duyoi.duy.digital
cd duyoi.duy.digital
npm install
npx wrangler login
```

### 1. Tạo database D1

```bash
npx wrangler d1 create duyoi
```

Lệnh in ra `database_id`. Mở `wrangler.jsonc`, thay `REPLACE_WITH_YOUR_D1_DATABASE_ID` bằng giá trị đó. Sau đó tạo bảng:

```bash
npm run db:migrate:remote
```

### 2. Đặt secrets

Hai giá trị này **không** ghi vào file, chỉ lưu trong Cloudflare.

```bash
# Mã dùng một lần để tạo admin đầu tiên (ít nhất 12 ký tự). Tạo ngẫu nhiên:
node -e "console.log(require('crypto').randomBytes(18).toString('base64url'))"
npx wrangler secret put SETUP_TOKEN

# Khoá mã hoá API key (32 byte, base64). Tạo ngẫu nhiên:
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
npx wrangler secret put ENCRYPTION_KEY
```

Cất `ENCRYPTION_KEY` vào trình quản lý mật khẩu. Nếu mất hoặc đổi khoá này, các API key đã lưu không giải mã được nữa và anh phải nhập lại.

### 3. Deploy

```bash
npm run deploy
```

`wrangler.jsonc` đã khai báo tên miền `duyoi.duy.digital`. Zone `duy.digital` phải nằm trong cùng tài khoản Cloudflare. Nếu chưa có, xoá khối `routes` và dùng địa chỉ `*.workers.dev` mà wrangler in ra.

### 4. Tạo admin

Mở `https://duyoi.duy.digital`. Lần đầu app hiện màn **Tạo tài khoản admin**:

- nhập `SETUP_TOKEN` ở bước 2
- nhập tên, email, mật khẩu (ít nhất 10 ký tự)

Sau khi có admin, màn này không còn nữa. Lần sau vào là màn đăng nhập.

Khi đã tạo admin, `SETUP_TOKEN` hết tác dụng. Muốn chắc chắn, đổi nó sang một giá trị ngẫu nhiên khác.

### 5. Việc nên làm ngay sau deploy

- **Cài đặt:** nhập OpenRouter key và DataForSEO login/password. Key được mã hoá AES-GCM trước khi lưu vào D1 và không bao giờ trả ngược về trình duyệt.
- **Site:** thêm site đầu tiên.
- **Thành viên** (chỉ admin): thêm người với quyền Admin, Biên tập hoặc Chỉ xem. App tạo mật khẩu tạm, hiện một lần để anh gửi riêng; người đó phải đặt mật khẩu mới ở lần đăng nhập đầu. Admin khoá, đổi quyền, đặt lại mật khẩu hoặc xoá được; đổi quyền hay khoá thì người đó bị đăng xuất ngay. App luôn giữ ít nhất một admin. Nếu dùng Cloudflare Access, nhớ thêm email của thành viên vào policy.
- **Cloudflare → Billing → Billable Usage:** tạo budget alert $10 / $25 / $50.
- **Thêm một lớp bảo vệ (khuyên dùng):** đặt Cloudflare Access (Zero Trust, miễn phí tới 50 người) trước `duyoi.duy.digital`, chỉ cho email của anh vào.

## Phục hồi thứ hạng

Menu **Phục hồi › Phục hồi thứ hạng**: nhập địa chỉ site (và tháng bắt đầu tụt). App đọc robots.txt và sitemap, quét tối đa 400 trang như Googlebot (không cần mật khẩu, không sửa gì), rồi:

- chấm điểm sức khoẻ và xếp nguyên nhân: nội dung mỏng/hàng loạt, ăn thịt từ khoá, bài thông tin cụt (không dẫn tới trang dịch vụ), trang dịch vụ ít link nội bộ, lỗi kỹ thuật (noindex, canonical, URL lỗi), blocklist pháp lý, dấu biên tập còn sót, link chéo giữa các site của anh;
- đối chiếu tháng tụt với các bản cập nhật Google đã xác nhận (`src/google-updates.ts`, thêm bản mới vào cuối danh sách);
- lập việc cho đội 9 agent. Việc sửa nội dung là danh sách find/replace "phẫu thuật" (giữ nguyên câu gốc, thêm link/CTA), đã qua **Gác cổng**: blocklist, dấu biên tập, ngôn ngữ, số liệu không nguồn, đoạn gốc phải khớp đúng 1 lần, tối đa 3 link mỗi trang.

Không việc nào tự đăng lên site. Redirect, xoá trang, đổi canonical, disavow là việc "khó đảo ngược": chỉ admin duyệt và người làm tay.

### Áp dụng lên WordPress

1. Cài plugin **Duy Ơi Connector** (`/duyoi-connector.zip` trên app, mã nguồn ở `wordpress/duyoi-connector/`). Plugin chỉ có REST API dưới `/wp-json/duyoi/v1/`, bắt buộc đăng nhập bằng Application Password.
2. Tạo user Editor riêng (ví dụ `duyoi-bot`), tạo Application Password, nhập ở màn **Site › Kết nối WordPress** rồi bấm **Thử kết nối**. Mật khẩu được mã hoá AES-GCM như API key.
3. Ở tab **Việc của agent**: duyệt việc → **Áp dụng lên site**. App chạy thử (dry run) trên dữ liệu thật, lưu bản gốc (`post_content`, `_elementor_data`, meta Rank Math) vào D1, rồi mới ghi; trang Elementor sửa trong `_elementor_data`, xoá cache CSS Elementor và FlyingPress/WP Rocket/LiteSpeed/W3TC nếu có. Bài vừa bị sửa ở nơi khác (Hermes, người khác) thì từ chối ghi. **Hoàn tác** đưa bài về bản gốc.
4. Plugin chỉ cho sửa `rank_math_title`, `rank_math_description`, `rank_math_focus_keyword`; canonical và robots không sửa qua app.

### Search Console và GA4

Cài đặt › API key › **Google service account (JSON)**. Bật *Google Search Console API* và *Google Analytics Data API* trong Google Cloud, thêm email service account vào property Search Console (Restricted) và GA4 (Viewer). Ở tab **Luật an toàn** của ca phục hồi, nhập property: Domain property ghi `sc-domain:ten-mien.de`, URL-prefix ghi `https://ten-mien.com/`. App lấy click/impression theo trang (28 ngày gần nhất, 28 ngày trước đó, và quanh tháng tụt) và lead `generate_lead` theo trang.

### AI

Dùng OpenRouter key và model tầng T1 trong Cài đặt, có trần chi phí tháng. Nút **Viết lại bằng AI** cho câu chèn link/CTA, **Soạn GEO bằng AI** cho đoạn trả lời trực tiếp đầu mục H2 và FAQ. Mọi nội dung AI viết qua Gác cổng: số liệu không có trên trang hoặc trong danh sách đã kiểm chứng sẽ bị chặn.

### Agent HQ và cấp Quản lý

Menu **Agent HQ** hiện đội agent theo khu (Điều hành, Tự động, Phục hồi, Nội dung mới) với trạng thái thật từ D1. Mọi lần gọi AI đi qua **Quản lý** (`src/manager.ts`):

- prompt phải được admin duyệt đúng phiên bản (mã băm của nội dung, tầng model, giới hạn token) ở tab **Quản lý prompt**; sửa prompt trong code là ra phiên bản mới, phải duyệt lại. Chưa duyệt thì agent bị chặn;
- kiểm trần chi phí tháng cho OpenRouter và DataForSEO, và trần AI mỗi site trong 24 giờ (Cài đặt › Model AI & chi phí);
- ghi mọi lần gọi vào `ai_calls` (độ dài prompt, token, chi phí thật, bị chặn hay lỗi), xem ở tab **Chi tiêu**. Không lưu nội dung prompt.

**Sau lần deploy đầu tiên, admin cần vào Agent HQ › Quản lý prompt duyệt 5 prompt thì AI mới chạy.**

### Bài mới (chống spam)

Tab **Bài mới** trong ca phục hồi: bảng cấu trúc (mỗi trang dịch vụ có bao nhiêu bài dẫn link về), nghiên cứu từ khoá bằng DataForSEO (bỏ từ khoá điều hướng, blocklist, lượng tìm thấp; chủ đề đã có trang thì không viết mới), duyệt chủ đề trong giới hạn bài/tháng, lập dàn ý từ top Google và People Also Ask, viết nháp qua Gác cổng (blocklist, ngôn ngữ, số liệu không nguồn, tối thiểu 600 từ), rồi tạo **bản nháp** WordPress (plugin 1.1.0 trở lên). Không bao giờ tự đăng; chủ site thêm kinh nghiệm, ảnh thật và tác giả thật trước khi đăng.

### Định dạng bài và ảnh thật

Khi tạo bài (Content Studio hoặc tab **Bài mới**), chọn định dạng; app cũng tự đoán từ từ khoá: **Best X / Top N**, **Review 1 sản phẩm**, **So sánh X vs Y**, **How-to**, **Guide**, **Bài thông tin**. Khung từng định dạng nằm ở `src/formats.ts`, được ghép vào prompt qua `{{FORMAT}}` và tính vào phiên bản prompt (sửa khung là phải duyệt lại ở Agent HQ).

- Bài affiliate: anh nhập sản phẩm (tên, link affiliate, nơi bán, nơi bán khác, thông số, ghi chú trải nghiệm, đã dùng thật chưa). Agent chỉ viết về sản phẩm anh nhập và không thấy URL. Hệ thống tự chèn câu công khai link affiliate trước link đầu tiên (sửa ở Luật an toàn) và nút mua có `rel="sponsored nofollow"`. Link ngoài do AI tự viết bị bỏ.
- Gác cổng chặn bài nói "đã test" khi chưa sản phẩm nào được đánh dấu đã dùng thật, chặn review khi chưa có trải nghiệm thật, nhắc luật Amazon (câu Amazon Associate, không tải ảnh Amazon, không ghi giá cố định).
- Ảnh thật: agent liệt kê ảnh cần có (mỗi sản phẩm, ảnh đang dùng, ảnh các bước how-to). Anh tải lên ở mục **Ảnh thật**: ảnh vào thẳng Thư viện Media WordPress qua REST API lõi (user cần quyền tải file), app xoá EXIF/GPS của JPEG, ghi nguồn ảnh (tự chụp / nhà sản xuất / chụp màn hình). Bài affiliate chỉ được tạo bản nháp WordPress khi đủ ảnh bắt buộc.
- Site Astro chạy trên Cloudflare (mặc định): mỗi site một **bucket R2 riêng** `img-ten-mien`, ảnh hiện ngay trên tên miền của site ở `https://ten-mien/images/năm/tháng/tên-file`. Bấm **Dựng kho ảnh trên Cloudflare** ở mục Ảnh thật: app tạo bucket, dựng Worker `duyoi-img-ten-mien` (chỉ đọc bucket, có cache), gắn route `ten-mien/images/*` và `www.ten-mien/images/*`, rồi tự kiểm tra bằng một file thử. Cần trong Cài đặt: **Cloudflare API token** (Account › Workers R2 Storage Edit, Workers Scripts Edit; Zone › Zone Read, Workers Routes Edit) và **Account ID**. Tên miền phải nằm trong cùng tài khoản Cloudflare. Ảnh tải lên trước khi kho chạy vẫn được lưu, nhưng Gác cổng chưa cho xuất bài.
- Tuỳ chọn: điền **Tên miền ảnh dùng chung** ở Site thì ảnh lưu vào bucket chung `duyoi-media` (binding `MEDIA`; Wrangler 4.45+ tự tạo khi deploy, hoặc chạy `npx wrangler r2 bucket create duyoi-media`). Mỗi site gắn một tên miền ảnh riêng vào bucket: R2 › duyoi-media › Settings › Custom Domains › `img.ten-mien.com` (zone phải cùng tài khoản Cloudflare), rồi điền `https://img.ten-mien.com` ở **Site › sửa site**. Ảnh nằm ở `ten-mien/năm/tháng/tên-file`, cache 1 năm. Lưu ý: cùng một bucket nên tên miền ảnh của site này cũng đọc được đường dẫn ảnh của site khác nếu ai đó đoán đúng.
- Site Astro không có bản nháp WordPress: bấm **Tải file Markdown cho Astro** (frontmatter `title`, `description`, `slug`, `heroImage`, `draft: true`, thân bài HTML) rồi đưa vào thư mục nội dung của repo.
- Không chèn schema HowTo/FAQ (Google đã bỏ rich result của hai loại này).

### Chế độ tự động

Bật ở **Luật an toàn › Chế độ tự động** cho từng site. Cron 15 phút làm tối đa một bước nặng mỗi site: quét lại định kỳ, (tuỳ chọn) áp dụng việc người đã duyệt tối đa 3 trang/ngày, AI viết câu chèn, nghiên cứu từ khoá 30 ngày một lần, (tuỳ chọn) tự duyệt chủ đề tốt nhất, dàn ý → nháp → bản nháp WordPress. Tạm dừng toàn bộ cũng dừng chế độ này.

Luật riêng của từng site (blocklist, ngôn ngữ, trang dịch vụ, số liệu đã kiểm chứng…) nhập ở tab **Luật an toàn**, lưu trong D1. Không ghi luật của khách vào code vì repo công khai.

Thử trên máy không cần mạng: `FAKE_SITE=1 node tests/serve.mjs` rồi nhập `caddemo.de` (WordPress, Google và OpenRouter đều là bản giả; user WP `duyoi-bot`, mật khẩu `abcd efgh ijkl mnop`). Test plugin PHP: `php wordpress/tests/test.php`.

## Chạy trên máy

```bash
cp .dev.vars.example .dev.vars   # rồi điền SETUP_TOKEN và ENCRYPTION_KEY
npm run db:migrate:local
npm run dev
```

Muốn chạy thử không cần wrangler (dữ liệu nằm trong bộ nhớ):

```bash
node tests/serve.mjs   # http://localhost:8788, SETUP_TOKEN=local-setup-token
```

## Kiểm thử

```bash
npm run typecheck
npm test               # 20 test cho tạo admin, đăng nhập, khoá khi sai nhiều lần, site, key mã hoá, tạm dừng, cron
```

Test chạy Worker ngay trong Node, dùng `node:sqlite` thay cho D1, nên cần Node 22.5 trở lên.

## Cấu trúc

```
src/
  index.ts       định tuyến /api/* và cron
  auth.ts        tạo admin, đăng nhập, phiên, đổi mật khẩu
  crypto.ts      PBKDF2 cho mật khẩu, AES-GCM cho API key
  sites.ts       quản lý site
  settings.ts    cài đặt và API key
  dashboard.ts   tổng quan, tạm dừng, cron
  activity.ts    nhật ký
  http.ts        JSON, cookie, chặn CSRF, kiểm tra dữ liệu
migrations/      schema D1
public/          giao diện (static assets, không tính request Worker)
tests/           test API và máy chủ chạy thử
docs/            lộ trình, bản demo tham khảo
```

## Bảo mật

- Mật khẩu: PBKDF2-SHA256, 100.000 vòng, salt riêng từng tài khoản.
- Phiên: cookie `HttpOnly`, `Secure`, `SameSite=Strict`, hết hạn sau 30 ngày. D1 chỉ lưu SHA-256 của token, không lưu token gốc.
- Sai mật khẩu 5 lần trong 15 phút (theo IP hoặc email) thì bị khoá 15 phút. Mã cài đặt cũng áp dụng luật này.
- Mọi request thay đổi dữ liệu phải có `Origin` trùng với app (chặn CSRF).
- API key mã hoá AES-GCM bằng `ENCRYPTION_KEY`. Nhật ký chỉ ghi tên key đã đổi, không ghi giá trị.
- Giao diện có Content-Security-Policy chặt (không inline script), `noindex`.

## Chi phí Cloudflare

- Giao diện là static assets, không tính request Worker.
- Worker chỉ chạy cho `/api/*` và cron 15 phút.
- Log lấy mẫu 20% để không đẩy chi phí Observability lên.
- Với vài chục site, giai đoạn 1 nằm trong phần miễn phí của Workers và D1.
