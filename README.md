# Duy Ơi

Nền tảng AI agent làm SEO, AEO và GEO cho nhiều site. Chạy hoàn toàn trên Cloudflare: Workers, D1, và từ các giai đoạn sau thêm Queues, Workflows, R2, Email Routing.

App **không dựng site**. Anh dựng site bằng Claude, rồi khai báo site ở đây để các agent nghiên cứu, viết bài, theo dõi thứ hạng, làm off-page.

> Các màn đang chạy nằm trên menu; màn chưa làm nằm ở trang **Lộ trình** (không hiện trên menu).
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

### Tài liệu site, Biên tập viên, Trưởng nhóm

- **Tài liệu & Hồ sơ site** (đầu tab Bài mới): tải PDF (catalog, bảng giá, hồ sơ công ty, handover, quy trình). Agent Đọc tài liệu gửi PDF qua OpenRouter (plugin `file-parser`: `pdf-text` miễn phí, `mistral-ocr` cho PDF scan), rút dịch vụ, sản phẩm, dữ kiện có nguồn (kèm số trang), giọng văn, điều cấm và gợi ý bài kèm định dạng. Hồ sơ gộp từ mọi tài liệu, anh sửa tay được. Người viết chỉ dùng dữ kiện trong hồ sơ; số trong hồ sơ được Gác cổng coi là có nguồn; điều cấm vào blocklist. File PDF không lưu lại.
- **Biên tập viên** chấm mỗi bài nháp 0–100 (model T2, khác người viết) theo khung định dạng và 6 tiêu chí (ý định, đúng khung, hữu ích, trải nghiệm thật, chính xác, dễ đọc), nêu tối đa 8 lỗi cụ thể. Dưới mức anh đặt (Luật an toàn, mặc định 75) thì Người viết sửa, tối đa 2 vòng; bản sửa làm mất token ảnh/nút mua bị bỏ. Dưới 60 thì Gác cổng chặn. Có nút Chấm lại và Sửa theo nhận xét.
- **Trưởng nhóm** (Agent HQ › tab đầu): anh chat, Trưởng nhóm (model T3) đọc tình trạng thật của các site rồi trả lời và đề xuất việc cho agent sẵn có (nghiên cứu từ khoá, tạo chủ đề, dàn ý, viết, sửa và chấm, quét lại). Máy chủ kiểm từng việc (đúng site, đúng chủ đề, không trùng, đúng bước); anh chọn và bấm Giao việc. Việc nhẹ chạy ngay, việc nặng chạy ở cron (2 việc mỗi lượt) hoặc nút Chạy ngay. Trưởng nhóm không tự sửa site, không đăng bài, không thấy API key.
- **Sổ tay Trưởng nhóm** (cột phải tab Trưởng nhóm): anh viết cách muốn ra quyết định (site ưu tiên, định dạng theo loại site, luật riêng). Trưởng nhóm đọc sổ tay mỗi lần trả lời; sổ tay không vượt được Gác cổng và luật sản phẩm. Khi anh nói một quy tắc lâu dài trong chat ("từ nay…"), Trưởng nhóm đề xuất dòng ghi vào sổ tay, chỉ ghi khi anh bấm. Lưu 50 phiên bản gần nhất, khôi phục được.
- Sau deploy, admin duyệt 4 prompt mới ở Quản lý prompt: Đọc tài liệu, Biên tập viên chấm, Sửa bài, Trưởng nhóm.

### Văn như người viết, định dạng chuẩn, anh tự viết bằng Claude

- **Model viết bài riêng** (Cài đặt › Model AI: "Viết bài và sửa bài", mặc định Claude Sonnet). Các việc khác vẫn dùng model rẻ.
- **Phỏng vấn trải nghiệm:** dàn ý kèm 3–5 câu hỏi cho anh về trải nghiệm thật; agent chỉ viết khi anh trả lời hoặc bấm Bỏ qua (tắt được ở Luật an toàn). Số liệu trong câu trả lời được coi là có nguồn.
- **Không có trải nghiệm thì tra Google:** bấm "Không có, tra Google giúp tôi" (hoặc agent tự tra trước khi viết nếu chưa có câu trả lời): agent Nghiên cứu đọc tối đa 5 trang top Google (bỏ site mình, site liên quan, blocklist), rút tối đa 15 dữ kiện kèm nguồn. Người viết chỉ dùng chúng kèm link nguồn trong câu, không viết như trải nghiệm của anh; số liệu trong dữ kiện được coi là có nguồn; link ngoài không phải nguồn bị bỏ.
- **Giọng văn site:** dán 1–5 bài hay nhất trên chính site (hoặc đoạn anh tự viết), agent rút xưng hô, nhịp câu, cách mở bài, điều tránh và vài đoạn mẫu; người viết và sửa bài đi theo giọng này.
- **Câu sáo AI** (de/en/vi, `src/style.ts`): gửi cho người viết để tránh; Gác cổng chặn khi có từ 3 câu, cảnh báo câu quá đều và đoạn quá dài.
- **Kiểm cấu trúc bằng code** cho từng định dạng (mở bài trả lời thẳng, đủ H2, FAQ, bảng chọn nhanh, mục riêng + nhược điểm + nút mua cho từng sản phẩm, các bước đánh số, ý chính…). Thiếu phần chính thì chặn và đưa vào vòng sửa của Người viết.
- **Anh tự viết bằng Claude:** mỗi bài chọn "Agent viết" hoặc "Tôi tự viết" (mặc định hỏi từng bài; đổi ở Luật an toàn › Ai viết bài mới). "Tôi tự viết": lấy gói yêu cầu (dàn ý, khung định dạng, token, sản phẩm, trải nghiệm, giọng văn, dữ kiện, luật) dán vào Claude, rồi dán bài Markdown/HTML vào app. Biên tập viên chấm theo khung; nếu anh cho phép thì Người viết sửa đúng chỗ chưa đạt. Với bài anh viết, số liệu chưa có nguồn chỉ cảnh báo.

### Đăng bài lên site Astro qua GitHub

Mỗi theme Astro có kiểu bài riêng, nên mỗi site có **hồ sơ đăng bài** (tab Bài mới › Đăng lên GitHub) do app tự đọc từ repo (`src/publish.ts`):

- content config (`src/content.config.ts` hoặc `src/content/config.ts`): thư mục bài, các trường frontmatter, kiểu (string, date, image(), enum, array, boolean), trường nào bắt buộc;
- bài mới nhất làm mẫu: `.md` hay `.mdx`, cách đặt tên file (`slug.md`, `slug/index.md`, `YYYY-MM-DD-slug.md`), chỗ để ảnh, component nút mua (ví dụ `<AffiliateButton href="{url}" label="{label}" />`).

Anh sửa được: tác giả thật, giá trị cố định cho trường bắt buộc (enum như category), trường nào app tự điền, mẫu nút mua. Theme bắt buộc ảnh đại diện thì bài có thêm chỗ ảnh "Ảnh đại diện".

Khi bài qua Gác cổng: bấm **Xem file sẽ đăng** hoặc **Tạo pull request**. App tạo nhánh `duyoi/…`, chuyển bài sang Markdown/MDX theo hồ sơ (frontmatter đúng schema, `draft: true` nếu theme có, nút mua theo component, ảnh đưa vào repo nếu theme dùng `image()`), rồi mở pull request vào nhánh chính, không đẩy thẳng. Cloudflare Workers Builds build thử; app đọc kết quả (cron 15 phút hoặc nút Kiểm tra lại), hiện link xem trước. Build lỗi do frontmatter thì app tự sửa (tối đa 2 lần); merge xong thì bài chuyển sang Đã đăng.

Cần **GitHub fine-grained token** chỉ cho các repo site, quyền Contents và Pull requests (Read and write), nhập ở Cài đặt › API key.

### Link affiliate cho bài đã đăng

Ca phục hồi của site › tab **Link affiliate**:

1. **Thư viện link**: mỗi sản phẩm một dòng (tên, tên gọi khác, link https, cửa hàng).
2. **Rà bài đã đăng**: WordPress đọc tối đa 40 trang đã quét; Astro đọc file `.md/.mdx` trong thư mục bài của hồ sơ đăng bài. Với mỗi sản phẩm, agent tìm lần nhắc đầu tiên chưa có link và chỉ **bọc đúng chữ đó** bằng `<a rel="sponsored nofollow noopener">`, không đổi câu. Bài chưa có câu công khai (Werbung, affiliate, Provision…) thì đề xuất thêm câu công khai ở đầu bài; tuỳ chọn thêm nút mua sau đoạn nhắc. Tôn trọng `maxLinksPerPage` và blocklist (bị chặn thì không duyệt được); link Amazon có cảnh báo.
3. Anh duyệt từng đề xuất hoặc **Duyệt tất cả**, rồi **Chèn vào site** (WordPress: thử trước, sao lưu, rồi ghi; **Hoàn tác** được) hoặc **Tạo pull request** (Astro, trên nhánh `duyoi/affiliate-…`, anh merge trên GitHub). Sửa hơn 3 trang một lần phải bấm xác nhận lần hai.
4. **Đổi link**: sửa URL trong thư viện, app giữ URL cũ; bấm Rà bài để đề xuất thay URL cũ ở mọi bài (WordPress chỉ thay trong `href`, Astro thay cả link Markdown).

Cần plugin Duy Ơi Connector **1.2.0** trở lên (thêm chế độ `wrap_link` và `swap_url`; plugin từ chối nếu chữ bị đổi, thiếu `rel="sponsored"`, có thẻ lạ hoặc URL không phải https). Anh tải lại `/duyoi-connector.zip` và cập nhật plugin trên từng site.

Tab **Đội agent** trong Agent HQ có thêm **Văn phòng 3D**: mỗi agent một bàn trong 4 phòng; đang làm thì chuyển động, có việc chờ hiện dấu "!", bị chặn hiện đỏ, rảnh thì mờ. Bấm bàn để xem chi tiết; nút **Dạng thẻ** quay lại kiểu cũ (điện thoại mặc định dạng thẻ).

### Team off-page (backlink, outreach, mạng xã hội, cộng đồng)

Menu **Off-page team** (và các lối tắt Prospects, Email outreach, Backlink, Citations, Entity & social). Agent HQ có khu **Off-page** với 7 agent. Cron chạy tự động cho mọi site đang chạy; Trưởng nhóm giao được các việc `find_prospects`, `draft_outreach`, `find_threads`, `social_sync`, `check_links`.

- **Prospector** (mỗi tuần): Google qua DataForSEO tìm trang "write for us", trang nhắc tên thương hiệu chưa link, trang tài nguyên (kiểm tra link chết → cơ hội broken link). Mở từng trang, tìm email (cả trang liên hệ), ước tính traffic; bỏ nơi bán link/nhận tiền đăng bài, traffic dưới mức đặt, mạng xã hội, diễn đàn.
- **Outreach Writer + Reviewer**: soạn email ngắn riêng cho từng trang kèm một follow-up; Reviewer (model khác) chấm và sửa; code chặn nhắc tiền/đổi link, link ngoài site, nhận đã test khi Hồ sơ site không có, từ cấm, và **mọi email lạnh cho site Đức hoặc người nhận .de/.at/.ch** (§ 7 UWG). Hệ thống tự thêm tên người gửi, thương hiệu, địa chỉ và dòng từ chối nhận thư. Một tên miền chỉ được liên hệ một lần trong 30 ngày (tính cả các site khác).
- **Anh duyệt từng thư** (tab Email). Thư đã duyệt gửi qua **Cloudflare Email Service** từ địa chỉ riêng của site, tối đa 2 thư/site mỗi lượt cron, cách nhau ít nhất 10 phút, theo trần mỗi ngày. Follow-up đã duyệt cùng thư đầu, gửi sau N ngày nếu chưa có trả lời.
- **Thư đến**: Email Routing chuyển thư gửi tới địa chỉ outreach về Worker `duyoi` (handler `email()`); app ghép với thư đã gửi, dừng follow-up, có thể chuyển tiếp về hộp thư của anh.
- **Community Scout** (mỗi tuần): tìm thread Reddit/Quora (site Đức: gutefrage), chấm rủi ro, soạn câu trả lời; link chỉ về trang phù hợp của site và kèm dòng công khai. **Agent không đăng**: anh chép, sửa, tự đăng rồi bấm "Đã đăng".
- **Social Entity** (2 giờ một lần): đọc sitemap, bài mới thì viết bài chia sẻ cho từng mạng đã kết nối, qua Gác cổng (giới hạn ký tự, số phải có trong bài, không nhận đã test, tối đa 3 hashtag, không giật tít) rồi tự đăng, tối đa N bài/mạng/ngày, cách nhau 2 giờ. Bài cũ lúc kết nối không đăng lại. Pinterest dùng ảnh đại diện có sẵn của bài (og:image), không tạo ảnh AI. Mạng: Pinterest, Facebook Page, LinkedIn Page, X (OAuth), Bluesky (App Password); YouTube/Instagram/TikTok/Crunchbase chỉ ghi profile vào sameAs. Tab Mạng xã hội có JSON-LD Organization + sameAs để dán vào layout.
- **Link Monitor** (mỗi tuần): mở trang nguồn của backlink đã có (từ "Có link" ở Prospects hoặc thêm tay), ghi còn/mất, dofollow/nofollow, anchor; báo khi mất link.
- **Citations**: chỉ cho site dịch vụ có NAP thật; danh bạ theo thị trường (AU, US, CA, GB, DE, NZ + Bing Places, Apple Business Connect, Foursquare), anh tự gửi, app theo dõi trạng thái.

- **IndexNow**: bài mới (phát hiện qua sitemap) và trang app vừa sửa (việc phục hồi, chèn link affiliate) được báo ngay cho Bing, Yandex, Seznam, Naver (Google không dùng IndexNow). Mỗi site một khoá; file khoá `https://ten-mien/<khoá>.txt` do Worker bộ đo phục vụ (tên miền trong Cloudflare, cron tự dựng lại Worker đời cũ) hoặc plugin Duy Ơi Connector **1.3.0** (WordPress). Mỗi URL tối đa 1 lần/24 giờ.
- **Pinterest Pin mới cho bài cũ** (bật mặc định): mỗi bài thêm tối đa 3 Pin, cách nhau ít nhất 7 ngày, mỗi Pin một ảnh thật khác trong bài và tiêu đề khác (không trùng Pin trước).
- **Postiz (tuỳ chọn)**: dán API key Postiz (Cloud hoặc tự cài) theo site, gắn kênh để đăng thêm Threads, Instagram, Mastodon, Google Business Profile (chỉ site dịch vụ) hoặc đăng Pinterest/LinkedIn/X qua app đã được duyệt của Postiz. Agent vẫn soạn, Gác cổng vẫn kiểm; Reddit, diễn đàn, kênh chat không gắn được.
- **Prospector** xoay bộ dấu hiệu tìm kiếm mỗi lượt: "write for us", "become a contributor", "submit a guest post", trang tài nguyên ("useful links", inurl:resources) và bài tổng hợp "best … blogs" (loại roundup).

- **Làm tay** (tab Làm tay, agent Link Builder): agent chuẩn bị sẵn, anh tự làm rồi đánh dấu; "Có link" tự vào Link Monitor.
  - Trả lời phóng viên: danh sách nền tảng thay HARO theo thị trường (Source of Sources, HARO/Featured, Qwoted, Help a B2B Writer, SourceBottle, #journorequest), bio ngắn/dài, và ô dán câu hỏi để agent soạn nháp trả lời (prompt `pr_answer`, chỉ dùng sự thật trong Hồ sơ site, nêu chỗ anh phải bổ sung).
  - Ảnh bị dùng không ghi nguồn: danh sách ảnh thật của anh kèm link tìm ngược Google Lens, Bing, TinEye, Yandex; dán trang đang dùng ảnh → app kiểm tra, tìm email, đưa vào Prospects (loại ghi nguồn ảnh) để soạn thư.
  - Testimonial cho công cụ anh dùng thật, hãng/nhà cung cấp (nơi bán, đối tác, chương trình review), podcast, bài tổng hợp chuyên gia, hiệp hội và phòng thương mại: agent tìm nơi (DataForSEO) và soạn sẵn đoạn văn (prompt `manual_kit`), luôn dưới tên thật của anh, không bịa khách hàng, số liệu, giải thưởng.
  - Trang 404 còn backlink: dán danh sách xuất từ Search Console, app tìm trang lỗi và gợi ý trang chuyển hướng 301; anh tự đặt redirect.

**Mỗi site một tài khoản riêng** cho email và từng mạng xã hội. Email gửi bắt buộc thuộc tên miền của site. App chặn khi một tài khoản, trang/board/công ty hoặc link profile đã gắn với site khác. Nên tạo app developer bằng tài khoản của chính site đó và nhập ở Off-page › Mạng xã hội › App developer riêng; app chung ở Cài đặt › API key chỉ là dự phòng. Trước khi bấm Kết nối, đăng nhập đúng tài khoản của site (một profile Chrome riêng cho mỗi site).

Cần làm một lần:
1. Từng site: app developer của Pinterest, Meta, LinkedIn, X (redirect URI: `https://duyoi.duy.digital/api/social/oauth/callback`), nhập ở Off-page › Mạng xã hội.
2. Từng site: Off-page › Team & cài đặt: tên người gửi, email gửi thuộc tên miền site, chủ đề.
3. Cloudflare › Email Service › Sending: bật tên miền gửi (cần gói Workers Paid); Email Routing: bật; bấm **Dựng hộp thư** (token cần thêm Zone › Email Routing Rules Edit), rồi **Gửi thư thử**.
4. Agent HQ › Quản lý prompt: duyệt 4 prompt mới (`outreach_draft`, `outreach_review`, `community_answer`, `social_caption`) và duyệt lại `lead_plan` (thêm việc off-page); thêm `manual_kit`, `pr_answer` cho phần Làm tay.
5. WordPress: cập nhật plugin Duy Ơi Connector lên 1.3.0 (file khoá IndexNow).

### Số liệu site (bộ đo riêng cho site Astro)

Menu **Số liệu site**. Site tĩnh không tự biết khách làm gì, nên app dựng một bộ đo nhỏ trên chính tên miền của site:

- Mỗi tên miền một đường dẫn ngẫu nhiên (`/_xxxxxxxx/`) và một Worker riêng `duyoi-st-…` gắn route trên tên miền đó. Không có tên miền đo dùng chung, nên các site không lộ liên hệ với nhau.
- Script khoảng 1,3 KB, không cookie, không lưu IP. Đo: lượt xem, nguồn khách (tên miền giới thiệu, `utm_source`), thời gian đọc thật (chỉ tính lúc tab đang mở), độ cuộn, LCP, click link affiliate (`rel="sponsored"` hoặc `data-dy-aff`), link ra ngoài, CTA (vùng `data-dy-cta`). Bot và Origin lạ bị bỏ.
- **Site chưa có vẫn làm trước được**: nhập tên miền, lấy dòng script dán vào `<head>` layout Astro (`<script is:inline defer src="/_xxxxxxxx/s.js"></script>`). Khi tên miền vào tài khoản Cloudflare, cron tự dựng Worker và route (thử lại mỗi giờ). Trước đó script chỉ báo 404, không ảnh hưởng site. Site đã thêm vào app thì tên miền tự có trong danh sách.
- Dữ liệu thô nằm ở Workers Analytics Engine (dataset `duyoi_events`, giữ 3 tháng); cron gộp theo ngày vào D1 mỗi giờ để giữ lâu. Báo cáo theo trang: lượt xem, đọc trung bình, cuộn, click affiliate và tỉ lệ, CTA, LCP, % mobile; trang có từ 50 lượt xem mà dưới 1% click affiliate được đánh dấu.
- Trưởng nhóm đọc số liệu 28 ngày của từng site (trang nhiều người đọc, tỉ lệ click affiliate) khi lập kế hoạch.
- Token Cloudflare cần thêm **Account › Account Analytics Read** (đọc số liệu) bên cạnh Workers Scripts Edit, Zone Read, Workers Routes Edit. Mỗi lượt xem tốn khoảng 2–3 request Worker; gói Workers Free có 100.000 request/ngày cho cả tài khoản.

### Topical & Semantic SEO

Menu **Topical & Semantic**. Khung kiểm tra dựa trên cách Koray Gübür mô tả Topical Authority (độ bao phủ chủ đề × dữ liệu lịch sử / chi phí truy xuất; mô hình của ông, không phải công thức Google công bố). Agent **Semantic SEO** chấm mỗi site 7 ngày một lần (tối đa 40 trang, ưu tiên trang có traffic), không tốn lệnh AI hay DataForSEO:

- Chi phí truy xuất: 4 câu đầu phải nói rõ chủ đề của H1, 2 mục đầu gắn với chủ đề, đúng một H1, heading không nhảy cấp, không có đoạn văn trên 120 từ, bài dài phải có bảng/danh sách, mục lục cho bài dài, giá trị cụ thể (số đo, thời gian, chi phí) và trích dẫn nguồn, bỏ câu sáo rỗng.
- Bản đồ Core (trang kiếm tiền) / Outer (trang kiến thức): Outer phải link về Core, Core cần bài Outer hỗ trợ, trang mồ côi.
- Truy vấn mở rộng (query fan-out) từ Search Console: truy vấn đã có hiển thị nhưng trang chưa có heading trả lời → gợi ý thêm heading, một đoạn, hay trang riêng.
- Source Context: loại site đang đứng top 3 các từ khoá theo dõi (diễn đàn, sàn, giáo dục, site đánh giá, doanh nghiệp…), lấy từ Rank Tracker; báo từ khoá mà top không có loại site như của anh.
- Thực thể web: schema Organization và sameAs trên trang chủ, kênh mạng xã hội còn đăng, citations.
- Bản nháp trong Content Studio: Gác cổng nhắc (không chặn) khi mở bài chưa nói rõ chủ đề, tường chữ, thiếu cấu trúc. Sửa trang đã đăng đi qua ca Phục hồi.

### Thứ hạng & cảnh báo (theo dõi và phản ứng khi tụt)

Menu **Thứ hạng & cảnh báo**, mỗi site một trang. Ba agent trong phòng "Theo dõi & cảnh báo" của Agent HQ:

- **Rank Tracker**: mỗi ngày đọc Search Console (click, hiển thị, vị trí 70 ngày; trang và truy vấn 7 ngày so với 4 tuần trước). Property mặc định `sc-domain:<tên miền>`, hoặc lấy từ ca Phục hồi; email service account cần quyền xem property. Từ khoá theo dõi tự chọn từ các truy vấn mang click nhiều nhất (hoặc bài đã đăng nếu chưa có Search Console), anh thêm tay được; vài ngày một lần kiểm vị trí qua DataForSEO SERP (top 30, kèm AI Overview, featured snippet và 3 site đứng đầu). Trần mặc định 20 từ khoá, 3 ngày một lần.
- **Backlink Watch**: mỗi tuần đo số domain trỏ về, backlink mới và mất (DataForSEO Backlinks, trả theo lượt dùng). Link dofollow mới tự vào Link Monitor; link mất mà trang đích trên site đã 404 thành việc chuyển hướng 301 ở Off-page › Làm tay.
- **Drop Doctor**: báo tụt khi click 7 ngày giảm từ 30% so với tuần trung bình 4 tuần trước (tối thiểu 35 click/tuần), từ khoá rơi khỏi top 10 hoặc tụt từ 5 bậc, hay từ 3 trang mất hết hiển thị. Không có Search Console thì dùng lượt xem từ bộ đo riêng. Khi tụt, tự kiểm robots.txt, noindex, canonical, chuyển hướng, lỗi HTTP của trang chủ và các trang tụt; đối chiếu bản cập nhật Google (đọc mỗi ngày từ Google Search Status Dashboard); xem backlink mất, truy vấn nhiều trang cùng tranh, AI Overview.
- Phương án theo nguyên nhân: lỗi kỹ thuật → báo khẩn, anh sửa (canonical/redirect cần anh duyệt), kiểm lại mỗi ngày, hết lỗi thì tự gửi IndexNow; Google đang rollout → chỉ theo dõi, đánh giá lại 7 ngày sau khi xong; còn lại → tự mở ca Phục hồi (quét, đề xuất, Gác cổng, anh duyệt từng sửa). Không tự sửa site, không tự disavow. Tín hiệu hết thì cảnh báo tự đóng.

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
npm test               # test API (node:sqlite, fake site/API ngoài) + test plugin WordPress (PHP)
```

Test chạy Worker ngay trong Node, dùng `node:sqlite` thay cho D1, nên cần Node 22.5 trở lên.

## Cấu trúc

```
src/
  index.ts       định tuyến /api/* và cron (3 lịch lệch 5 phút: A việc nội dung/phục hồi, B số liệu + off-page, C theo dõi + semantic; mỗi lịch một lần chạy riêng để giữ dưới hạn mức 1000 truy vấn D1)
  auth.ts        tạo admin, đăng nhập, phiên, đổi mật khẩu
  crypto.ts      PBKDF2 cho mật khẩu, AES-GCM cho API key
  sites.ts       quản lý site
  settings.ts    cài đặt và API key
  dashboard.ts   tổng quan, tạm dừng, cron
  activity.ts    nhật ký
  http.ts        JSON, cookie, chặn CSRF, kiểm tra dữ liệu
  offpage.ts     Prospector, Outreach (Email Service), thư đến, Community Scout, Link Monitor, Citations
  social.ts      tài khoản mạng xã hội (OAuth), tự đăng bài mới, sameAs
  web.ts         đọc trang, sitemap, email liên hệ, ảnh thật trong bài
  manual.ts      link building làm tay: chuẩn bị nơi, đoạn văn, tìm ảnh, 404 còn backlink
  indexnow.ts    báo IndexNow khi có bài mới hoặc trang vừa sửa
  stats.ts       bộ đo riêng cho site (Worker trên tên miền, Analytics Engine, gộp vào D1)
  semantic.ts    chấm semantic từng trang, Core/Outer, truy vấn mở rộng, Source Context, thực thể web
  monitor.ts     Search Console, vị trí từ khoá, backlink; phát hiện tụt, chẩn đoán, phương án
  affiliate.ts   thư viện link affiliate, rà bài đã đăng, chèn qua plugin hoặc pull request
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
