// Ảnh thật do người tải lên: chỉ nhận JPEG/PNG/WebP, tối đa 8 MB, xoá metadata EXIF/XMP của JPEG (vị trí GPS, máy chụp) trước khi gửi lên WordPress.

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export function sniffImage(b: Uint8Array): { type: string; ext: string } | null {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { type: "image/jpeg", ext: "jpg" };
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { type: "image/png", ext: "png" };
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return { type: "image/webp", ext: "webp" };
  return null;
}

// Bỏ các đoạn APP1 (EXIF/XMP), APP13 (IPTC) và COM của JPEG; giữ nguyên dữ liệu ảnh
export function stripJpegMeta(b: Uint8Array): Uint8Array {
  if (b[0] !== 0xff || b[1] !== 0xd8) return b;
  const parts: Uint8Array[] = [b.subarray(0, 2)];
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return b; // cấu trúc lạ: giữ nguyên file
    const marker = b[i + 1]!;
    if (marker === 0xda) { parts.push(b.subarray(i)); break; } // bắt đầu dữ liệu ảnh
    const len = (b[i + 2]! << 8) | b[i + 3]!;
    if (len < 2 || i + 2 + len > b.length) return b;
    const drop = marker === 0xe1 || marker === 0xed || marker === 0xfe;
    if (!drop) parts.push(b.subarray(i, i + 2 + len));
    i += 2 + len;
  }
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

// Kích thước ảnh (để thẻ img có width/height, tránh nhảy bố cục)
export function imageSize(b: Uint8Array, type: string): { width: number; height: number } | null {
  if (type === "image/png" && b.length > 24) return { width: (b[16]! << 24 | b[17]! << 16 | b[18]! << 8 | b[19]!) >>> 0, height: (b[20]! << 24 | b[21]! << 16 | b[22]! << 8 | b[23]!) >>> 0 };
  if (type === "image/jpeg") {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return null;
      const m = b[i + 1]!;
      const len = (b[i + 2]! << 8) | b[i + 3]!;
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { height: (b[i + 5]! << 8) | b[i + 6]!, width: (b[i + 7]! << 8) | b[i + 8]! };
      i += 2 + len;
    }
  }
  return null;
}
