// Site WordPress giả (tiếng Đức) để kiểm thử chức năng Phục hồi thứ hạng mà không cần mạng.

export function fakeSite(opts = {}) {
  const host = "caddemo.de";
  const filler = (topic, n) => Array.from({ length: n }, (_, i) => `<p>Im Bereich ${topic} ist die saubere Planung der erste Schritt für jedes Projekt und sie spart später viel Aufwand bei der Abstimmung mit allen Beteiligten im Team ${i}. Die Zeichnungen müssen klar und eindeutig sein, damit alle Gewerke die gleiche Grundlage haben und Fehler früh erkannt werden. Zum Schluss prüfen wir alle Details zu ${topic} noch einmal gründlich, bevor die Unterlagen an den Kunden gehen (Abschnitt ${i}).</p>`).join("");
  const render = (title, h1, body, extra = "") => `<!doctype html><html lang="de"><head><title>${title}</title><meta name="description" content="${h1} – Beschreibung."><link rel="canonical" href="https://${host}${extra}"></head><body class="elementor-default"><header><nav><a href="/">Start</a><a href="/cad-dienstleistung-tga/">TGA</a><a href="/kontakt/">Kontakt</a></nav></header><main><h1>${h1}</h1>${body}</main><footer><a href="/impressum/">Impressum</a></footer></body></html>`;
  const page = (title, h1, body, extra = "") => ({ title, h1, body, extra });
  const pages = {
    "/": page("CAD Demo", "CAD Dienstleistungen aus einer Hand", `<h2>Leistungen</h2>${filler("CAD", 4)}<p><a href="/cad-dienstleistung-tga/">TGA</a></p>`, "/"),
    "/cad-dienstleistung-tga/": page("CAD-Dienstleistung TGA | CAD Demo", "CAD-Dienstleistung TGA", `<h2>TGA Planung</h2>${filler("TGA", 4)}<p><a href="/kontakt/">Jetzt anfragen</a></p>`, "/cad-dienstleistung-tga/"),
    "/cad-outsourcing-kosten-sparen/": page("CAD Outsourcing Kosten sparen", "CAD Outsourcing: Kosten sparen", `<h2>Ersparnis</h2>${filler("Outsourcing", 4)}<p>Über 50% Kostenersparnis sind möglich.</p>`, "/cad-outsourcing-kosten-sparen/"),
    "/kontakt/": page("Kontakt", "Kontakt", `<h2>Schreiben Sie uns</h2>${filler("Kontakt", 1)}<form><input name="x"></form>`, "/kontakt/"),
    "/12-wichtige-cad-symbole-fur-architektur/": page("12 wichtige CAD Symbole", "12 wichtige CAD-Symbole für Architektur", `<h2>Symbole für TGA und Haustechnik</h2>${filler("TGA Symbole", 3)}<h2>Gewinde und Bohrungen</h2>${filler("Bohrungen", 3)}`, "/12-wichtige-cad-symbole-fur-architektur/"),
    "/cad-software-vergleich-beste-programme/": page("CAD Software Vergleich", "CAD-Software Vergleich", `<h2>Kosten der Programme</h2>${filler("Outsourcing Kosten", 3)}<h2>Fazit</h2>${filler("Software", 2)}`, "/cad-software-vergleich-beste-programme/"),
    "/inventor-vs-solidworks/": page("Inventor vs SolidWorks", "Inventor vs SolidWorks", `<h2>Kurz</h2><p>Beide Programme sind gut für den Maschinenbau geeignet und weit verbreitet in Deutschland.</p>`, "/inventor-vs-solidworks/"),
    "/cad-dienstleistungen-muenchen/": page("CAD Dienstleistungen München", "CAD Dienstleistungen München", filler("München", 3), "/cad-dienstleistungen-muenchen/"),
    "/cad-dienstleistungen-berlin/": page("CAD Dienstleistungen Berlin", "CAD Dienstleistungen Berlin", filler("Berlin", 3), "/cad-dienstleistungen-berlin/"),
    "/referenzen-alt/": page("Referenzen", "Referenzen", `<h2>Projekte</h2>${filler("Referenzen", 2)}<p>Gemeinsam mit 3DScan Solutions umgesetzt [LINK 1].</p><img src="/wp-content/uploads/3dscan.png">`, "/referenzen-alt/")
  };
  const urls = Object.keys(pages).concat(["/geloeschte-seite/"]);
  const sitemap = `<?xml version="1.0"?><urlset>${urls.map((u, i) => `<url><loc>https://${host}${u}</loc><lastmod>2025-0${(i % 3) + 6}-01</lastmod></url>`).join("")}</urlset>`;
  const index = `<?xml version="1.0"?><sitemapindex><sitemap><loc>https://${host}/page-sitemap.xml</loc></sitemap></sitemapindex>`;
  // Trạng thái WordPress giả: mỗi trang là một bài; bài CAD-Symbole dựng bằng Elementor
  const wp = opts.wp || {};
  const posts = Object.fromEntries(Object.keys(pages).map((path, i) => [path, { id: 100 + i, modified: "2026-11-01 10:00:00", meta: { rank_math_title: pages[path].title, rank_math_description: "" }, elementor: path.includes("symbole") }]));
  const elData = (path) => JSON.stringify([{ id: "s1", elType: "section", settings: {}, elements: [{ id: "w1", elType: "widget", widgetType: "text-editor", settings: { editor: pages[path].body }, elements: [] }] }]);
  const count = (hay, n) => (n ? hay.split(n).length - 1 : 0);
  const blockEnd = (h, end) => { const m = /<\/(p|h[1-6]|ul|ol|li)>/i.exec(h.slice(end)); return m ? end + m.index + m[0].length : h.length; };
  const blockStart = (h, start) => { const head = h.slice(0, start); const all = [...head.matchAll(/<(p|h[1-6]|ul|ol|li)\b[^>]*>/gi)]; return all.length ? all[all.length - 1].index : 0; };
  const jsonRes = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
  wp.calls = [];
  async function wpRoute(u, init) {
    const auth = (init?.headers?.Authorization || "");
    if (auth !== `Basic ${Buffer.from(`${wp.user}:${wp.pass}`).toString("base64")}`) return jsonRes({ code: "rest_not_logged_in", message: "Sorry, you are not allowed" }, 401);
    const route = u.pathname.replace("/wp-json/duyoi/v1", "");
    const body = init?.body ? JSON.parse(init.body) : {};
    wp.calls.push({ route, body });
    const byId = (id) => Object.entries(posts).find(([, p]) => p.id === Number(id));
    if (route === "/ping") return jsonRes({ ok: true, version: "1.0.0", elementor: true, rankmath: true, flyingpress: true, user: wp.user });
    if (route === "/post") {
      const path = new URL(u.searchParams.get("url")).pathname;
      const p = posts[path];
      if (!p) return jsonRes({ code: "not_found", message: "Không tìm thấy" }, 404);
      return jsonRes({ id: p.id, type: "page", status: "publish", slug: path, link: `https://${host}${path}`, modified_gmt: p.modified, content: p.elementor ? "" : pages[path].body, elementor: p.elementor, elementor_data: p.elementor ? elData(path) : null, meta: p.meta });
    }
    if (route === "/create") {
      const slug = body.slug;
      if (Object.keys(pages).some((p) => p.replace(/\//g, "") === slug) || (wp.created || []).some((c) => c.slug === slug)) return jsonRes({ code: "duplicate", message: `Đã có bài với slug "${slug}"` }, 409);
      wp.created = [...(wp.created || []), { ...body, status: "draft" }];
      const id = 900 + wp.created.length;
      return jsonRes({ ok: true, id, status: "draft", edit_link: `https://${host}/wp-admin/post.php?post=${id}&action=edit` });
    }
    if (route === "/apply" || route === "/restore") {
      const hit = byId(body.id);
      if (!hit) return jsonRes({ code: "not_found", message: "x" }, 404);
      const [path, p] = hit;
      if (route === "/restore") {
        if (body.elementor_data) pages[path].body = JSON.parse(body.elementor_data)[0].elements[0].settings.editor;
        else if (typeof body.content === "string") pages[path].body = body.content;
        Object.assign(p.meta, body.meta || {});
        p.modified = new Date().toISOString().slice(0, 19).replace("T", " ");
        return jsonRes({ ok: true, purged: ["flyingpress"] });
      }
      if (body.expected_modified && body.expected_modified !== p.modified) return jsonRes({ code: "conflict", message: "Bài vừa được sửa ở nơi khác" }, 409);
      let h = pages[path].body;
      for (const [i, e] of (body.edits || []).entries()) {
        const n = count(h, e.find);
        if (n !== 1) return jsonRes({ code: "no_match", message: `Sửa #${i + 1}: đoạn gốc khớp ${n} lần` }, 422);
        const at = h.indexOf(e.find);
        if (e.mode === "replace") { if (!e.replace.includes(e.find)) return jsonRes({ code: "no_match", message: "mất chữ gốc" }, 422); h = h.slice(0, at) + e.replace + h.slice(at + e.find.length); }
        else if (e.mode === "after_block") { const pos = blockEnd(h, at + e.find.length); h = h.slice(0, pos) + e.insert + h.slice(pos); }
        else { const pos = blockStart(h, at); h = h.slice(0, pos) + e.insert + h.slice(pos); }
      }
      if (body.dry_run) return jsonRes({ ok: true, dry_run: true, changes: (body.edits || []).length, meta: Object.keys(body.meta || {}), elementor: p.elementor });
      pages[path].body = h;
      Object.assign(p.meta, body.meta || {});
      p.modified = `2026-11-17 10:${String(10 + wp.calls.length).padStart(2, "0")}:00`;
      return jsonRes({ ok: true, changes: (body.edits || []).length, meta: Object.keys(body.meta || {}), elementor: p.elementor, purged: ["flyingpress"].concat(p.elementor ? ["elementor-css"] : []), modified_gmt: p.modified });
    }
    return jsonRes({ code: "rest_no_route", message: "No route" }, 404);
  }
  async function google(u, init) {
    if (u.hostname === "oauth2.googleapis.com") return jsonRes({ access_token: "tok", expires_in: 3600 });
    const body = init?.body ? JSON.parse(init.body) : {};
    if (u.hostname === "www.googleapis.com") {
      const rows = { "/12-wichtige-cad-symbole-fur-architektur/": 110, "/cad-software-vergleich-beste-programme/": 101, "/cad-dienstleistung-tga/": 4, "/": 20 };
      const before = body.startDate < "2025-10-01";
      return jsonRes({ rows: Object.entries(rows).map(([p, c]) => ({ keys: [`https://${host}${p}`], clicks: before && body.startDate.startsWith("2025") ? c * 3 : c, impressions: c * 40, ctr: 0.02, position: 12.3 })) });
    }
    if (u.hostname === "analyticsdata.googleapis.com") {
      const leads = body.dimensions?.[0]?.name === "pagePath";
      return jsonRes({ rows: leads ? [{ dimensionValues: [{ value: "/kontakt/" }], metricValues: [{ value: "3" }] }] : [{ dimensionValues: [{ value: "/12-wichtige-cad-symbole-fur-architektur/" }], metricValues: [{ value: "140" }] }] });
    }
    return null;
  }
  async function dataforseo(u, init) {
    const task = JSON.parse(init.body)[0];
    if (u.pathname.includes("keyword_ideas")) {
      const kw = [["cad zeichner tga", 320, 22, "commercial"], ["tga planung cad", 140, 30, "informational"], ["cad outsourcing kosten", 90, 18, "commercial"], ["12 wichtige cad symbole fur architektur", 900, 20, "informational"], ["3dscan alternative", 50, 10, "commercial"], ["haustechnik zeichnung erstellen lassen", 70, 15, "transactional"], ["autocad download", 5000, 60, "navigational"], ["tga symbole liste", 40, 12, "informational"]];
      return jsonRes({ status_code: 20000, cost: 0.0115, tasks: [{ status_code: 20000, cost: 0.0115, result: [{ items: kw.map(([k, v, d, i]) => ({ keyword: k, keyword_info: { search_volume: v, cpc: 2.1 }, keyword_properties: { keyword_difficulty: d }, search_intent_info: { main_intent: i } })) }] }] });
    }
    if (u.pathname.includes("serp/google/organic")) {
      return jsonRes({ status_code: 20000, cost: 0.002, tasks: [{ status_code: 20000, cost: 0.002, result: [{ items: [
        { type: "organic", title: `${task.keyword} – Ratgeber`, url: "https://example.de/a", description: "Ein Überblick." },
        { type: "people_also_ask", items: [{ title: "Was kostet eine TGA-Zeichnung?" }, { title: "Wer erstellt TGA-Pläne?" }] }
      ] }] }] });
    }
    return jsonRes({ status_code: 40400, status_message: "Not Found" }, 404);
  }
  async function openrouter(init) {
    const body = JSON.parse(init.body);
    const user = JSON.parse(body.messages[1].content);
    const sys = body.messages[0].content;
    let content;
    if (/planning ONE genuinely useful article/.test(sys)) {
      content = { title: `${user.keyword}: Leitfaden für Planer`, slug: user.keyword.replace(/\s+/g, "-"), angle: "Praxisnah", outline: [{ h2: "Worauf es ankommt", points: ["Grundlagen"], h3: [] }, { h2: "Ablauf", points: ["Schritte"], h3: [] }], faq: user.people_also_ask, expert_input: ["Eigenes Projektbeispiel"], meta_description: "Leitfaden für Planer.", internal_link_anchor: "CAD-Dienstleistung TGA" };
    } else if (/write ONE article draft/.test(sys)) {
      const bad = /planung/.test(user.keyword);
      const para = (i) => `<p>Bei der Planung der technischen Gebäudeausrüstung ist eine klare Abstimmung zwischen allen Beteiligten wichtig, damit die Zeichnungen später ohne Rückfragen umgesetzt werden können und keine Lücken entstehen (Abschnitt ${String.fromCharCode(65 + i)}).</p>`;
      const html = `<h2>Worauf es ankommt</h2>${Array.from({ length: 12 }, (_, i) => para(i)).join("")}<h2>Ablauf</h2>${Array.from({ length: 12 }, (_, i) => para(i + 12)).join("")}<p>Unterstützung bietet unsere <a href="${user.service_page}">CAD-Dienstleistung TGA</a>.</p>${bad ? "<p>Sie sparen damit 30% der Kosten.</p>" : ""}<script>alert(1)</script>`;
      content = { title: user.outline.title, html, meta_description: "Leitfaden zur TGA-Planung." };
    } else if (user.sections) {
      const bad = /Kosten/.test(user.page_title || "");
      content = { answers: user.sections.slice(0, 2).map((s) => ({ heading: s.heading, answer: bad ? "Mit uns arbeiten Sie 40% schneller und sparen Zeit bei jedem Projekt." : `Kurz gesagt: Bei ${s.heading} kommt es auf eine saubere und abgestimmte Planung an. Wir prüfen alle Unterlagen gründlich, bevor sie an Sie gehen.` })), faq_title: "Häufige Fragen", faq: [1, 2, 3].map((i) => ({ q: `Wie läuft die Zusammenarbeit ab (Frage ${String.fromCharCode(64 + i)})?`, a: "Sie senden uns Ihre Unterlagen, wir stimmen die Anforderungen ab und liefern geprüfte Zeichnungen." })) };
    } else if (user.target_page?.purpose === "contact") content = { sentence: "Haben Sie ein konkretes Vorhaben? Sprechen Sie mit unserem Team über Ihr Projekt.", anchor: "Sprechen Sie mit unserem Team" };
    else content = { sentence: `Für die Umsetzung unterstützen Sie unsere Experten für ${user.target_page.title.split("|")[0].trim()}.`, anchor: user.target_page.title.split("|")[0].trim() };
    return jsonRes({ choices: [{ message: { content: JSON.stringify(content) } }], usage: { prompt_tokens: 500, completion_tokens: 80, cost: 0.0012 } });
  }
  return async (input, init) => {
    const u = new URL(typeof input === "string" ? input : input.url);
    if (u.hostname === "openrouter.ai") return openrouter(init);
    if (u.hostname === "api.dataforseo.com") return dataforseo(u, init);
    const g = await google(u, init);
    if (g) return g;
    if (u.hostname !== host) return new Response("not found", { status: 404 });
    if (u.pathname.startsWith("/wp-json/duyoi/v1")) return wpRoute(u, init);
    const pg = pages[u.pathname];
    const body = u.pathname === "/robots.txt" ? `User-agent: *\nDisallow: /wp-admin/\nSitemap: https://${host}/sitemap_index.xml`
      : u.pathname === "/sitemap_index.xml" ? index : u.pathname === "/page-sitemap.xml" ? sitemap : pg ? render(pg.title, pg.h1, pg.body, pg.extra) : null;
    if (!body) return new Response("<html>404</html>", { status: 404, headers: { "content-type": "text/html" } });
    const type = u.pathname.endsWith(".xml") ? "application/xml" : u.pathname.endsWith(".txt") ? "text/plain" : "text/html; charset=utf-8";
    const res = new Response(body, { status: 200, headers: { "content-type": type } });
    Object.defineProperty(res, "url", { value: u.href });
    return res;
  };
}
