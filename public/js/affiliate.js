// Tab "Link affiliate" trong ca phục hồi: thư viện link → rà bài → duyệt → chèn (WordPress) hoặc pull request (Astro).

import { api } from "./api.js";
import { $, $$, esc, showMsg, busy, formData, ago } from "./ui.js";

const KIND = { link: "Gắn link", button: "Nút mua", disclosure: "Câu công khai", replace_url: "Đổi link cũ" };
const ST = { proposed: ["Chờ duyệt", "info"], approved: ["Đã duyệt", "ok"], failed: ["Không khớp", "err"] };
const tag = ([l, c]) => `<span class="tag ${c}">${esc(l)}</span>`;

function preview(e) {
  if (e.kind === "replace_url") return `<p class="aff-diff"><del>${esc(e.find)}</del><br><ins>${esc(e.replace)}</ins></p>`;
  if (e.kind === "disclosure" || e.kind === "button") return `<p class="aff-diff"><ins>${esc(e.replace.replace(/<[^>]+>/g, ""))}</ins>${e.find ? `<small>${e.kind === "button" ? "sau đoạn" : "trước đoạn"}: ${esc(e.find.slice(0, 90))}…</small>` : ""}</p>`;
  const m = e.replace.match(/<a [^>]*>([^<]*)<\/a>/);
  const word = m ? m[1] : "";
  const i = word ? e.find.indexOf(word) : -1;
  const html = i < 0 ? esc(e.find) : `${esc(e.find.slice(0, i))}<mark>${esc(word)}</mark>${esc(e.find.slice(i + word.length))}`;
  return `<p class="aff-diff">${html}</p>`;
}

function html(d, canEdit) {
  const byPage = new Map();
  for (const e of d.edits) byPage.set(e.page, [...(byPage.get(e.page) || []), e]);
  const approved = d.edits.filter((e) => e.status === "approved");
  const approvedPages = new Set(approved.map((e) => e.page)).size;
  const astro = d.platform === "astro";
  return `
  <div class="msg" id="aff-msg" hidden></div>
  <p class="note">Agent tìm lần nhắc đầu tiên của sản phẩm trong bài đã đăng và chỉ bọc chữ đó bằng link (<code>rel="sponsored nofollow"</code>), không đổi câu. Bài chưa có câu công khai thì thêm một câu đầu bài. ${astro ? "Site Astro: áp dụng bằng một pull request, anh merge trên GitHub." : "WordPress: thử trước, sao lưu, rồi mới sửa; hoàn tác được."}</p>
  <h3 class="sub">Thư viện link (${d.links.length})</h3>
  ${d.links.length ? `<div class="tablewrap boxed"><table><thead><tr><th>Sản phẩm</th><th>Tên gọi khác</th><th>Link</th><th></th></tr></thead><tbody>${d.links.map((l) => `<tr${l.active ? "" : ` class="muted"`}>
    <td><b>${esc(l.name)}</b>${l.merchant ? `<small>${esc(l.merchant)}</small>` : ""}</td>
    <td>${esc(l.aliases.join(", ")) || "—"}</td>
    <td class="aff-url">${esc(l.url)}${l.old_urls.length ? `<small>${l.old_urls.length} link cũ sẽ được thay khi rà</small>` : ""}</td>
    <td>${canEdit ? `<button type="button" data-aff-edit="${l.id}">Sửa</button> <button type="button" class="danger" data-aff-del="${l.id}">Xoá</button>` : ""}</td></tr>`).join("")}</tbody></table></div>` : `<p class="note">Chưa có link nào.</p>`}
  ${canEdit ? `<form id="aff-form" class="aff-form" novalidate>
    <input type="hidden" name="id" value="">
    <label>Tên sản phẩm<input name="name" required maxlength="120" placeholder="VD: Bosch PSR 18"></label>
    <label>Tên gọi khác (cách nhau dấu phẩy)<input name="aliases" maxlength="400" placeholder="PSR 18 LI-2"></label>
    <label>Link affiliate (https)<input name="url" type="url" required placeholder="https://amzn.to/…"></label>
    <label>Cửa hàng<input name="merchant" maxlength="40" placeholder="Amazon"></label>
    <div class="toolbar"><button type="submit" class="primary" id="aff-save">Lưu link</button><button type="button" id="aff-cancel" hidden>Huỷ sửa</button></div>
  </form>` : ""}
  <h3 class="sub">Đề xuất chèn (${d.edits.length})</h3>
  ${canEdit ? `<div class="toolbar">
    <button type="button" id="aff-scan"${d.links.length ? "" : " disabled"}>Rà bài đã đăng</button>
    <label class="check"><input type="checkbox" id="aff-buttons"> Thêm nút mua sau đoạn nhắc</label>
    ${d.edits.some((e) => e.status === "proposed" && e.gate?.ok !== false) ? `<button type="button" id="aff-approve-all">Duyệt tất cả</button>` : ""}
    ${approved.length ? `<button type="button" class="primary" id="aff-apply" data-pages="${approvedPages}">${astro ? "Tạo pull request" : "Chèn vào site"} (${approved.length} sửa, ${approvedPages} trang)</button>` : ""}
  </div>` : ""}
  ${byPage.size ? [...byPage].map(([page, eds]) => `<div class="aff-page">
    <h4>${esc(eds[0].page_title || page)}<small>${esc(page)}</small></h4>
    ${eds.map((e) => `<div class="aff-edit">
      <div class="aff-head">${tag([KIND[e.kind] || e.kind, "fmt"])} ${tag(ST[e.status] || [e.status, ""])}${(e.gate?.problems || []).map((p) => tag([p.message, p.level === "block" ? "err" : "warn"])).join(" ")}</div>
      ${preview(e)}
      ${e.error ? `<p class="note err">${esc(e.error)}</p>` : ""}
      ${canEdit ? `<div class="toolbar">${e.status !== "approved" && e.gate?.ok !== false ? `<button type="button" data-aff-ok="${e.id}">Duyệt</button>` : ""}${e.status === "approved" ? `<button type="button" data-aff-undo="${e.id}">Bỏ duyệt</button>` : ""}<button type="button" class="danger" data-aff-no="${e.id}">Bỏ</button></div>` : ""}
    </div>`).join("")}
  </div>`).join("") : `<p class="note">Chưa có đề xuất. Thêm link vào thư viện rồi bấm Rà bài đã đăng.</p>`}
  ${d.applies.length ? `<h3 class="sub">Đã áp dụng</h3><div class="tablewrap boxed"><table><thead><tr><th>Trang</th><th>Kết quả</th><th>Lúc</th><th></th></tr></thead><tbody>${d.applies.map((a) => `<tr>
    <td>${esc(a.page)}</td>
    <td>${a.pr ? `<a href="${esc(a.pr.url)}" target="_blank" rel="noopener">Pull request #${esc(a.pr.number)}</a>` : tag([a.status === "restored" ? "Đã hoàn tác" : "Đã chèn", a.status === "restored" ? "" : "ok"])}</td>
    <td>${esc(ago(a.at))}</td>
    <td>${canEdit && a.platform === "wordpress" && a.status === "applied" ? `<button type="button" data-aff-rb="${a.id}">Hoàn tác</button>` : ""}</td></tr>`).join("")}</tbody></table></div>` : ""}`;
}

export async function mountAffiliate(el, siteId, canEdit) {
  if (!el || !siteId) return;
  let d;
  try { d = await api(`/api/sites/${siteId}/affiliate`); } catch (e) { el.innerHTML = `<p class="msg err">${esc(e.message)}</p>`; return; }
  el.innerHTML = html(d, canEdit);
  const msg = (e, ok) => showMsg($("#aff-msg", el), ok || e.message, ok ? "ok" : "err");
  const reload = () => mountAffiliate(el, siteId, canEdit);
  const base = `/api/sites/${siteId}/affiliate`;
  const decide = async (ids, status) => { try { await api(`${base}/edits`, { method: "PUT", body: { ids, status } }); await reload(); } catch (e) { msg(e); } };
  const form = $("#aff-form", el);
  if (form) {
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const f = formData(form);
      await busy($("#aff-save", el), "Đang lưu…", async () => {
        try {
          const r = await api(f.id ? `${base}/links/${f.id}` : `${base}/links`, { method: f.id ? "PUT" : "POST", body: { name: f.name, aliases: f.aliases, url: f.url, merchant: f.merchant } });
          await reload();
          if (r.urlChanged) msg(null, "Đã đổi link. Bấm Rà bài đã đăng để thay link cũ ở các bài.");
        } catch (e) { msg(e); }
      });
    });
    $("#aff-cancel", el).addEventListener("click", () => { form.reset(); form.elements.id.value = ""; $("#aff-cancel", el).hidden = true; });
  }
  $$("[data-aff-edit]", el).forEach((b) => b.addEventListener("click", () => {
    const l = d.links.find((x) => x.id === Number(b.dataset.affEdit));
    form.elements.id.value = l.id; form.elements.name.value = l.name; form.elements.aliases.value = l.aliases.join(", "); form.elements.url.value = l.url; form.elements.merchant.value = l.merchant;
    $("#aff-cancel", el).hidden = false; form.elements.name.focus();
  }));
  $$("[data-aff-del]", el).forEach((b) => b.addEventListener("click", async () => { try { await api(`${base}/links/${b.dataset.affDel}`, { method: "DELETE" }); await reload(); } catch (e) { msg(e); } }));
  $("#aff-scan", el)?.addEventListener("click", (ev) => busy(ev.currentTarget, "Đang rà bài…", async () => {
    try { const r = await api(`${base}/scan`, { method: "POST", body: { buttons: $("#aff-buttons", el).checked } }); await reload(); msg(null, `Đã rà ${r.pages} bài: ${r.proposed} đề xuất.`); } catch (e) { msg(e); }
  }));
  $("#aff-approve-all", el)?.addEventListener("click", () => decide(d.edits.filter((e) => e.status === "proposed" && e.gate?.ok !== false).map((e) => e.id), "approved"));
  $$("[data-aff-ok]", el).forEach((b) => b.addEventListener("click", () => decide([Number(b.dataset.affOk)], "approved")));
  $$("[data-aff-undo]", el).forEach((b) => b.addEventListener("click", () => decide([Number(b.dataset.affUndo)], "proposed")));
  $$("[data-aff-no]", el).forEach((b) => b.addEventListener("click", () => decide([Number(b.dataset.affNo)], "rejected")));
  $("#aff-apply", el)?.addEventListener("click", (ev) => {
    const btn = ev.currentTarget;
    const pages = Number(btn.dataset.pages);
    if (pages > 3 && btn.dataset.confirm !== "1") {
      btn.dataset.confirm = "1";
      btn.textContent = `Xác nhận sửa ${pages} trang một lần`;
      btn.classList.add("danger");
      msg({ message: `Sắp sửa ${pages} trang. Bấm lại để xác nhận.` });
      return;
    }
    busy(btn, "Đang chèn…", async () => {
      try {
        const r = await api(`${base}/apply`, { method: "POST", body: { confirmBulk: pages > 3 } });
        await reload();
        msg(null, `Đã chèn ${r.applied} sửa trên ${r.pages} trang${r.failed ? `, ${r.failed} không khớp` : ""}.${r.prs.length ? " Pull request đã mở trên GitHub." : ""}`);
      } catch (e) { msg(e); }
    });
  });
  $$("[data-aff-rb]", el).forEach((b) => b.addEventListener("click", () => busy(b, "Đang hoàn tác…", async () => { try { await api(`${base}/applies/${b.dataset.affRb}/rollback`, { method: "POST" }); await reload(); msg(null, "Đã hoàn tác."); } catch (e) { msg(e); } })));
}
