// Các bản cập nhật xếp hạng Google đã được xác nhận (Google Search Status Dashboard), dùng để đối chiếu thời điểm site tụt.
// Ngày kết thúc lấy theo thông báo "rollout complete". Khi Google có bản mới, thêm vào cuối danh sách.

export interface GoogleUpdate {
  name: string;
  kind: "core" | "spam" | "discover" | "measurement";
  start: string; // YYYY-MM-DD
  end: string | null; // YYYY-MM-DD; null = đang rollout
  note: string;
}

export const GOOGLE_UPDATES: GoogleUpdate[] = [
  { name: "November 2024 core update", kind: "core", start: "2024-11-11", end: "2024-12-05", note: "Cập nhật lõi: đánh giá lại chất lượng toàn site." },
  { name: "December 2024 core update", kind: "core", start: "2024-12-12", end: "2024-12-18", note: "Cập nhật lõi." },
  { name: "December 2024 spam update", kind: "spam", start: "2024-12-19", end: "2024-12-26", note: "Cập nhật chống spam." },
  { name: "March 2025 core update", kind: "core", start: "2025-03-13", end: "2025-03-27", note: "Cập nhật lõi." },
  { name: "June 2025 core update", kind: "core", start: "2025-06-30", end: "2025-07-17", note: "Cập nhật lõi." },
  { name: "August 2025 spam update", kind: "spam", start: "2025-08-26", end: "2025-09-22", note: "Chống spam kéo dài gần 4 tuần: nội dung hàng loạt (scaled content), link spam." },
  { name: "Google bỏ tham số &num=100", kind: "measurement", start: "2025-09-10", end: "2025-09-14", note: "Không phải tụt hạng: Search Console bỏ lượt hiển thị do bot, nên impressions giảm và vị trí trung bình tăng. So sánh bằng click và lead, đừng bằng impressions." },
  { name: "December 2025 core update", kind: "core", start: "2025-12-11", end: "2025-12-29", note: "Cập nhật lõi." },
  { name: "February 2026 Discover update", kind: "discover", start: "2026-02-05", end: "2026-02-27", note: "Chỉ ảnh hưởng Google Discover, không phải kết quả tìm kiếm thường." },
  { name: "March 2026 spam update", kind: "spam", start: "2026-03-24", end: "2026-03-25", note: "Chống spam (chưa tới 1 ngày)." },
  { name: "March 2026 core update", kind: "core", start: "2026-03-27", end: "2026-04-08", note: "Cập nhật lõi." },
  { name: "May 2026 core update", kind: "core", start: "2026-05-21", end: "2026-06-02", note: "Cập nhật lõi, biến động mạnh hơn bản tháng 3." },
  { name: "June 2026 spam update", kind: "spam", start: "2026-06-24", end: "2026-06-26", note: "Chống spam." },
  { name: "August 2026 spam update", kind: "spam", start: "2026-08-18", end: "2026-08-20", note: "Chống spam." },
  { name: "September 2026 spam update", kind: "spam", start: "2026-09-24", end: "2026-10-08", note: "Chống spam kéo dài 2 tuần, tác động mạnh; các đợt ảnh hưởng 25–27/9, 30/9 và 4–6/10." },
  { name: "November 2026 core update", kind: "core", start: "2026-11-10", end: null, note: "Cập nhật lõi, Google báo rollout tới 2 tuần." }
];

// Gộp danh sách tĩnh với các bản Monitor tự đọc từ Google Search Status Dashboard (bảng google_updates)
export function mergeUpdates(extra: GoogleUpdate[]): GoogleUpdate[] {
  const m = new Map(GOOGLE_UPDATES.map((u) => [u.name.toLowerCase(), u]));
  for (const u of extra) { const old = m.get(u.name.toLowerCase()); m.set(u.name.toLowerCase(), old ? { ...old, end: u.end ?? old.end } : u); }
  return [...m.values()].sort((a, b) => a.start.localeCompare(b.start));
}

export function kindOf(name: string): GoogleUpdate["kind"] {
  const n = name.toLowerCase();
  return n.includes("spam") ? "spam" : n.includes("discover") ? "discover" : "core";
}

// Bản cập nhật có khả năng liên quan tới tháng tụt: chạy trong tháng đó hoặc kết thúc trong vòng 6 tuần trước đó
// (hiệu ứng thường thấy rõ sau khi rollout xong).
export function updatesNear(dropMonth: string): GoogleUpdate[] {
  if (!/^\d{4}-\d{2}$/.test(dropMonth)) return [];
  const [y = 2000, m = 1] = dropMonth.split("-").map(Number);
  const monthStart = Date.UTC(y, m - 1, 1);
  const monthEnd = Date.UTC(y, m, 0, 23, 59, 59);
  const windowStart = monthStart - 42 * 86400000;
  return GOOGLE_UPDATES.filter((u) => {
    const s = Date.parse(u.start + "T00:00:00Z");
    const e = u.end ? Date.parse(u.end + "T23:59:59Z") : Date.now();
    return e >= windowStart && s <= monthEnd;
  });
}
