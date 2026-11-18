// Menu theo bản demo đã duyệt. live: true là màn đã chạy thật. Mục chưa làm (có phase) không hiện ở menu, chỉ ở trang Lộ trình.
// hidden: true là đường dẫn phụ trỏ vào một màn khác (ví dụ các tab của Off-page), vẫn mở được nhưng không chiếm chỗ trên menu.

export const PHASES = {
  1: "Giai đoạn 1 · Nền tảng",
  2: "Giai đoạn 2 · Dữ liệu SEO",
  3: "Giai đoạn 3 · Nội dung",
  4: "Giai đoạn 4 · Off-page",
  5: "Giai đoạn 5 · AI, phân tích, tối ưu"
};

export const MENU = [
  { group: "Điều hành", key: "ops", items: [
    { id: "overview", label: "Tổng quan", live: true },
    { id: "hq", label: "Agent HQ", live: true },
    { id: "rankings", label: "Thứ hạng & cảnh báo", live: true },
    { id: "analytics", label: "Số liệu site", live: true }
  ]},
  { group: "Phục hồi", key: "rec", items: [
    { id: "recovery", label: "Phục hồi thứ hạng", live: true }
  ]},
  { group: "Site", key: "site", items: [
    { id: "sites", label: "Site", live: true },
    { id: "context", label: "Project context", phase: 3, plan: ["Giọng văn, tác giả, đối tượng đọc của từng site", "Luật riêng: site Đức không email lạnh, bài review cần ảnh test thật"] },
    { id: "topical", label: "Topical & Semantic", live: true },
    { id: "entity", label: "Entity & social", live: true, hidden: true }
  ]},
  { group: "Nội dung", key: "content", items: [
    { id: "keywords", label: "Keyword Hub", phase: 2, plan: ["Từ khoá theo cụm, intent, volume, KD", "Câu hỏi thật: PAA (mở 4 lớp), autocomplete, diễn đàn"] },
    { id: "content", label: "Content Studio", live: true },
    { id: "wins", label: "Quick wins", phase: 3, plan: ["Trang vị trí 8–20, CTR thấp, bài tụt hạng", "Đề xuất title/meta, làm mới bài"] },
    { id: "pages", label: "So sánh & free tool", phase: 3, plan: ["Trang so sánh, alternative, công cụ tính miễn phí để lấy link"] }
  ]},
  { group: "Kỹ thuật & an toàn", key: "tech", items: [
    { id: "audit", label: "Site audit", phase: 2, plan: ["DataForSEO On-Page: lỗi theo mức Critical / Warning / Notice, URL bị ảnh hưởng", "Sửa theo nền tảng: agent tự sửa nội dung, WordPress qua plugin, Astro gom thành prompt"] },
    { id: "tech", label: "Kiểm tra kỹ thuật", phase: 2, plan: ["Core Web Vitals (CrUX), index, sitemap, robots, schema"] },
  ]},
  { group: "Off-page", key: "off", items: [
    { id: "offpage", label: "Off-page", live: true },
    { id: "prospects", label: "Prospects", live: true, hidden: true },
    { id: "mail", label: "Email outreach", live: true, hidden: true },
    { id: "backlinks", label: "Backlink", live: true, hidden: true },
    { id: "citations", label: "Citations", live: true, hidden: true }
  ]},
  { group: "AI & tăng trưởng", key: "ai", items: [
    { id: "aivis", label: "AI visibility", phase: 5, plan: ["Theo dõi site có được ChatGPT, AI Overview, AI Mode, Perplexity nhắc tới không"] },
    { id: "acquire", label: "Chấm điểm site/domain", phase: 5, plan: ["Đánh giá domain trước khi mua: traffic, backlink, lịch sử, spam"] }
  ]},
  { group: "Hệ thống", key: "sys", items: [
    { id: "schedule", label: "Lịch chạy", phase: 2, plan: ["Mỗi site lệch phút cố định, hàng đợi theo loại việc, hạn mức từng nhà cung cấp"] },
    { id: "prompts", label: "Prompt & token", phase: 5, plan: ["Prompt Optimizer: cache phần tĩnh, rút ngữ cảnh, gom lô; thử A/B trước khi áp dụng"] },
    { id: "members", label: "Thành viên", live: true, admin: true },
    { id: "roadmap", label: "Lộ trình", live: true },
    { id: "activity", label: "Nhật ký", live: true },
    { id: "settings", label: "Cài đặt", live: true },
    { id: "account", label: "Tài khoản", live: true }
  ]}
];

export const ITEMS = Object.fromEntries(MENU.flatMap((g) => g.items.map((i) => [i.id, { ...i, group: g.key }])));
