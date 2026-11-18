// Site WordPress giả (tiếng Đức) để kiểm thử chức năng Phục hồi thứ hạng mà không cần mạng.

export function fakeSite(opts = {}) {
  const host = opts.host || "caddemo.de";
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
  const extra = opts.extra || {};
  const sitemapNow = () => `<?xml version="1.0"?><urlset>${urls.concat(Object.keys(extra)).map((u, i) => `<url><loc>https://${host}${u}</loc></url>`).join("")}</urlset>`;
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
        if (e.mode === "swap_url") { if (!h.includes(`href="${e.find}"`)) return jsonRes({ code: "no_match", message: "không còn link cũ" }, 422); h = h.split(`href="${e.find}"`).join(`href="${e.replace}"`); continue; }
        const n = count(h, e.find);
        if (n !== 1) return jsonRes({ code: "no_match", message: `Sửa #${i + 1}: đoạn gốc khớp ${n} lần` }, 422);
        const at = h.indexOf(e.find);
        if (e.mode === "wrap_link") { if (e.replace.replace(/<[^>]+>/g, "") !== e.find.replace(/<[^>]+>/g, "") || !e.replace.includes('rel="sponsored')) return jsonRes({ code: "no_match", message: "đổi chữ" }, 422); h = h.slice(0, at) + e.replace + h.slice(at + e.find.length); }
        else if (e.mode === "replace") { if (!e.replace.includes(e.find)) return jsonRes({ code: "no_match", message: "mất chữ gốc" }, 422); h = h.slice(0, at) + e.replace + h.slice(at + e.find.length); }
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
    if (u.pathname.includes("bulk_traffic_estimation")) {
      const etv = { "partnerblog.example": 5000, "resources.example": 2000, "mentioner.example": 800, "paidposts.example": 9000, "tinyblog.example": 10 };
      return jsonRes({ status_code: 20000, cost: 0.011, tasks: [{ status_code: 20000, cost: 0.011, result: [{ items: task.targets.map((t) => ({ target: t, metrics: { organic: { etv: etv[t] ?? 300 } } })) }] }] });
    }
    if (u.pathname.includes("serp/google/organic") && /write for us|intitle:resources|site:reddit|site:quora|site:gutefrage|^"/.test(task.keyword)) {
      const k = task.keyword;
      const o = (url, title, description = "") => ({ type: "organic", url, domain: new URL(url).hostname, title, description });
      const items = /write for us/.test(k) ? [o("https://partnerblog.example/write-for-us/", "Write for us – Golf Simulator Blog"), o("https://paidposts.example/write-for-us/", "Write for us: sponsored posts"), o("https://www.reddit.com/r/golf/x", "reddit"), o("https://tinyblog.example/write-for-us/", "Write for us")]
        : /intitle:resources/.test(k) ? [o("https://resources.example/golf-resources/", "Golf Simulator Resources")]
        : /site:reddit/.test(k) ? [o("https://www.reddit.com/r/Golfsimulator/comments/abc/is_9_ft_ceiling_enough/", "Is 9 ft ceiling enough for a garage golf simulator?", "My garage has a 9 ft ceiling…")]
        : /site:quora/.test(k) ? [o("https://www.quora.com/What-is-the-cheapest-way-to-build-a-golf-simulator", "What is the cheapest way to build a golf simulator?")]
        : /^"/.test(k) ? [o("https://mentioner.example/best-tools/", "Best golf tools 2026")] : [];
      return jsonRes({ status_code: 20000, cost: 0.002, tasks: [{ status_code: 20000, cost: 0.002, result: [{ items }] }] });
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
    const m1 = body.messages[1].content;
    const user = JSON.parse(Array.isArray(m1) ? m1[0].text : m1);
    const sys = body.messages[0].content;
    seen.push({ template: sys.slice(0, 60), body });
    let content;
    if (/read ONE document supplied by the website owner/.test(sys)) {
      content = { doc_type: "company_profile", title: "Firmenprofil", summary_vi: "Hồ sơ công ty CAD tại Đức.", audience: "TGA-Planer", tone: "sachlich", services: ["CAD-Dienstleistung TGA", "BIM-Modellierung"], products: [{ name: "Revit-Vorlagenpaket", specs: "Revit 2025", notes: "" }], facts: [{ text: "Seit 2009 über 1200 Projekte abgeschlossen", page: 2 }, { text: "Team aus 18 Zeichnern", page: 3 }], banned: ["Billiganbieter"], ideas: [{ title: "CAD Layer Vorlagen anlegen", keyword: "cad layer vorlagen", format: "how_to", why_vi: "Tài liệu mô tả quy trình." }] };
    } else if (/extract facts for ONE article from the texts of pages/.test(sys)) {
      content = { facts: [{ text: "Die HOAI gliedert die Planung in die Leistungsphasen 1 bis 9.", source_url: user.sources[0].url, source_title: "TGA-Ratgeber" }, { text: "Erfundene Quelle", source_url: "https://fake.example/x", source_title: "x" }] };
    } else if (/analyse the writing style/.test(sys)) {
      content = { person: "Sie, wir", formality: "sachlich, freundlich", sentence_style: "kurze Sätze, aktive Verben", paragraphing: "2-3 Sätze", opening_style: "direkte Antwort", vocabulary: ["Planungsbüro", "Abstimmung"], avoid: ["Superlative"], summary_vi: "Giọng thẳng, ngắn gọn.", excerpts: [user.samples[0].split(" ").slice(0, 20).join(" ")] };
    } else if (/strict senior editor/.test(sys)) {
      const good = /Verbessert/.test(user.draft_html);
      content = good ? { score: 86, criteria: [{ name: "intent", score: 88, note: "Ổn" }], issues: [], verdict: "Đạt" } : { score: 62, criteria: [{ name: "usefulness", score: 55, note: "Còn chung chung" }], issues: [{ where: "Kaufberatung", problem: "Chung chung", fix: "Thêm ví dụ cụ thể" }], verdict: "Cần sửa" };
    } else if (/revise ONE article draft/.test(sys)) {
      content = { html: `${user.draft_html}<p>Verbessert: Ein konkretes Beispiel aus einem Planungsbüro zeigt, wie die Auswahl im Alltag abläuft.</p>` };
    } else if (/team lead of an SEO agent team/.test(sys)) {
      const s0 = user.state.sites[0];
      const approved = s0.ideas.find((i) => i.status === "approved");
      if (/từ nay/i.test(user.owner_message)) { content = { reply: `Em ghi nhận. Sổ tay hiện: ${user.playbook}`, plan: [], needs_from_owner: [], playbook_add: ["Ưu tiên caddemo.de, mỗi tháng 3 bài how-to"] }; return jsonRes({ choices: [{ message: { content: JSON.stringify(content) } }], usage: { prompt_tokens: 100, completion_tokens: 50, cost: 0.001 } }); }
      content = { reply: `Em thấy ${s0.domain} có ${s0.profile.ideas_from_documents.length} gợi ý từ tài liệu.`, plan: [
        { action: "create_article", site_id: s0.site_id, keyword: "cad layer vorlagen", format: "how_to", why: "Từ tài liệu" },
        ...(approved ? [{ action: "write_brief", site_id: s0.site_id, idea_id: approved.idea_id, why: "Đã duyệt" }] : []),
        { action: "delete_site", site_id: s0.site_id, why: "x" },
        { action: "write_draft", site_id: s0.site_id, idea_id: 99999, why: "x" }
      ], needs_from_owner: ["Ảnh thật cho bài how-to"] };
    } else if (/planning ONE genuinely useful article/.test(sys)) {
      content = { interview: /ablauf/.test(user.keyword) ? ["Dự án gần nhất anh làm theo quy trình này mất bao lâu?", "Khách hay thiếu tài liệu gì?"] : [], title: `${user.keyword}: Leitfaden für Planer`, slug: user.keyword.replace(/\s+/g, "-"), angle: "Praxisnah", outline: [{ h2: "Worauf es ankommt", points: ["Grundlagen"], h3: [] }, { h2: "Ablauf", points: ["Schritte"], h3: [] }], faq: user.people_also_ask, expert_input: ["Eigenes Projektbeispiel"], meta_description: "Leitfaden für Planer.", internal_link_anchor: "CAD-Dienstleistung TGA" };
    } else if (/write ONE article draft/.test(sys) && user.format !== "article") {
      const para = (n, i) => `<p>Bei der Auswahl für ${n} zählt vor allem, wie gut das Werkzeug zum eigenen Arbeitsablauf passt, wie verständlich die Bedienung ist und wie zuverlässig der Hersteller Aktualisierungen bereitstellt (Teil ${String.fromCharCode(65 + i)}).</p>`;
      const prods = user.products.map((p) => `<h2>${p.n}. ${p.name}: ${p.best_for}</h2>[[IMG:p${p.n}]]${[0, 1, 2, 3, 4, 5, 6, 7].map((i) => para(p.name, i)).join("")}<h3>Nachteile</h3><p>Die Einarbeitung braucht etwas Geduld.</p><ul><li>${p.specs}</li></ul>[[BUY:${p.n}]]`).join("");
      const claim = /test/.test(user.keyword) ? "<p>Wir haben alle Programme getestet.</p>" : "";
      const html = `<p>Diese Übersicht richtet sich an Planer, die ein passendes Programm für Grundrisse, Schnitte und die Abstimmung mit dem Team suchen.</p>[[DISCLOSURE]]${claim}<h2>Schnellauswahl</h2><table><tr><th>Programm</th><th>Geeignet für</th></tr>${user.products.map((p) => `<tr><td>${p.name}</td><td>${p.best_for}</td></tr>`).join("")}</table>${prods}<h2>Kaufberatung</h2>${[5, 6, 7, 8].map((i) => para("Planer", i)).join("")}<p>Mehr dazu <a href="https://evil.example/x">hier</a>.</p><h2>Häufige Fragen</h2><h3>Welches Programm passt für Einsteiger?</h3><p>Für den Einstieg zählt eine verständliche Oberfläche mehr als jede Zusatzfunktion.</p><h2>Fazit</h2><p>Wer neu startet, nimmt das erste Programm; Teams fahren mit dem zweiten besser.</p>`;
      content = { title: user.outline.title, html, meta_description: "Übersicht für Planer." };
    } else if (/write ONE article draft/.test(sys)) {
      const bad = /planung/.test(user.keyword);
      const para = (i) => `<p>Bei der Planung der technischen Gebäudeausrüstung ist eine klare Abstimmung zwischen allen Beteiligten wichtig, damit die Zeichnungen später ohne Rückfragen umgesetzt werden können und keine Lücken entstehen (Abschnitt ${String.fromCharCode(65 + i)}).</p>`;
      const cite = user.web_facts?.length ? `<p>Laut <a href="${user.web_facts[0].source_url}">${user.web_facts[0].source_title}</a> gliedert die HOAI die Planung in die Leistungsphasen 1 bis 9, siehe auch <a href="https://evil.example/z">hier</a>.</p>` : "";
      const html = `${cite}<p>Wer eine TGA-Planung vergibt, möchte vor allem wissen, wie der Ablauf aussieht, welche Unterlagen nötig sind und wie Rückfragen vermieden werden.</p><h2>Worauf es ankommt</h2>${Array.from({ length: 8 }, (_, i) => para(i)).join("")}<h2>Ablauf</h2>${Array.from({ length: 8 }, (_, i) => para(i + 8)).join("")}<h2>Unterlagen und Abstimmung</h2>${Array.from({ length: 8 }, (_, i) => para(i + 16)).join("")}<p>Unterstützung bietet unsere <a href="${user.service_page}">CAD-Dienstleistung TGA</a>.</p>${bad ? "<p>Sie sparen damit 30% der Kosten.</p>" : ""}<script>alert(1)</script>`;
      content = { title: user.outline.title, html, meta_description: "Leitfaden zur TGA-Planung." };
    } else if (/personal outreach email/.test(sys)) {
      const paid = /Resources/.test(user.recipient_page.title || "");
      content = { subject: `A note about ${String(user.recipient_page.title).slice(0, 30)}`, body: `Hi, I read your page "${user.recipient_page.title}" and found it clear. ${paid ? "I can pay a small fee for a link. " : ""}We wrote a guide that fits: ${user.target_page.url}. Would it help your readers?`, followup_body: "Just checking whether you saw my note. No worries if not.", pitch_title: "" };
    } else if (/review ONE outreach email/.test(sys)) {
      content = { score: 81, issues: ["Thư ngắn gọn, đúng trang người nhận."], fixed_subject: "", fixed_body: "", fixed_followup: "" };
    } else if (/helpful answer that the owner will review/.test(sys)) {
      content = { answer: `A 9 ft ceiling works for most golfers if you swing carefully. See also https://evil.example/spam for more.`, include_link: true, why: "Câu hỏi đúng bài." };
    } else if (/social posts that share ONE article/.test(sys)) {
      const v = user.avoid_titles?.length || 0;
      content = { posts: user.networks.map((n) => ({ network: n, text: n === "x" ? "We tested it: 40% faster setup for your garage sim." : `${v ? "Another angle" : "New guide"}: ${user.title}. What to check before you buy.`, title: v ? `${user.title}: checklist ${String.fromCharCode(65 + v)}` : user.title, alt_text: user.title })) };
    } else if (user.sections) {
      const bad = /Kosten/.test(user.page_title || "");
      content = { answers: user.sections.slice(0, 2).map((s) => ({ heading: s.heading, answer: bad ? "Mit uns arbeiten Sie 40% schneller und sparen Zeit bei jedem Projekt." : `Kurz gesagt: Bei ${s.heading} kommt es auf eine saubere und abgestimmte Planung an. Wir prüfen alle Unterlagen gründlich, bevor sie an Sie gehen.` })), faq_title: "Häufige Fragen", faq: [1, 2, 3].map((i) => ({ q: `Wie läuft die Zusammenarbeit ab (Frage ${String.fromCharCode(64 + i)})?`, a: "Sie senden uns Ihre Unterlagen, wir stimmen die Anforderungen ab und liefern geprüfte Zeichnungen." })) };
    } else if (user.target_page?.purpose === "contact") content = { sentence: "Haben Sie ein konkretes Vorhaben? Sprechen Sie mit unserem Team über Ihr Projekt.", anchor: "Sprechen Sie mit unserem Team" };
    else content = { sentence: `Für die Umsetzung unterstützen Sie unsere Experten für ${user.target_page.title.split("|")[0].trim()}.`, anchor: user.target_page.title.split("|")[0].trim() };
    return jsonRes({ choices: [{ message: { content: JSON.stringify(content) } }], usage: { prompt_tokens: 500, completion_tokens: 80, cost: 0.0012 } });
  }
  const seen = opts.seen || [];
  const cfs = opts.cf || { token: "cf-token", buckets: {}, workers: {}, routes: [] };
  async function cloudflare(u, init) {
    if ((init?.headers?.Authorization || "") !== `Bearer ${cfs.token}`) return jsonRes({ success: false, errors: [{ code: 10000, message: "Authentication error" }] }, 403);
    const p = u.pathname.replace("/client/v4", "");
    const m = init?.method || "GET";
    let r;
    if ((r = p.match(/^\/accounts\/[a-f0-9]{32}\/r2\/buckets\/([a-z0-9-]+)$/)) && m === "GET") return cfs.buckets[r[1]] ? jsonRes({ success: true, result: { name: r[1] } }) : jsonRes({ success: false, errors: [{ code: 10006, message: "bucket not found" }] }, 404);
    if (/^\/accounts\/[a-f0-9]{32}\/r2\/buckets$/.test(p) && m === "POST") { const name = JSON.parse(init.body).name; cfs.buckets[name] = {}; return jsonRes({ success: true, result: { name } }); }
    if ((r = p.match(/^\/accounts\/[a-f0-9]{32}\/r2\/buckets\/([a-z0-9-]+)\/objects\/(.+)$/)) && m === "PUT") {
      if (!cfs.buckets[r[1]]) return jsonRes({ success: false, errors: [{ message: "bucket not found" }] }, 404);
      cfs.buckets[r[1]][decodeURIComponent(r[2])] = { bytes: new Uint8Array(init.body), type: init.headers["Content-Type"] };
      return jsonRes({ success: true, result: {} });
    }
    if ((r = p.match(/^\/accounts\/[a-f0-9]{32}\/workers\/scripts\/([a-z0-9-]+)$/)) && m === "PUT") {
      const meta = JSON.parse(await init.body.get("metadata").text());
      const code = await init.body.get("worker.js").text();
      cfs.workers[r[1]] = { bucket: meta.bindings.find((x) => x.type === "r2_bucket")?.bucket_name, ae: meta.bindings.find((x) => x.type === "analytics_engine")?.dataset, code };
      return jsonRes({ success: true, result: { id: r[1] } });
    }
    if (/^\/accounts\/[a-f0-9]{32}\/analytics_engine\/sql$/.test(p) && m === "POST") {
      // Gộp như câu SQL của app (mỗi điểm _sample_interval = 1)
      const g = new Map();
      for (const pt of cfs.ae || []) {
        const d = Math.floor(pt.ts / 86400000), [t, path, u, x, dev] = pt.blobs, [d1, d2, d3, d4] = pt.doubles;
        const k = [pt.indexes[0], d, t, path, u, x].join("\t");
        const a = g.get(k) || { domain: pt.indexes[0], d, t, p: path, u, x, n: 0, s: 0, sc: 0, l: 0, ln: 0, mo: 0 };
        a.n += d1; a.s += d2; a.sc += d3 * d1; a.l += d4 * d1; a.ln += d4 > 0 ? d1 : 0; a.mo += dev === "m" ? d1 : 0;
        g.set(k, a);
      }
      cfs.aeQueries = (cfs.aeQueries || 0) + 1;
      return jsonRes({ meta: [], data: [...g.values()], rows: g.size });
    }
    if (p === "/zones" && m === "GET") return jsonRes({ success: true, result: u.searchParams.get("name") === host ? [{ id: "zone1", name: host }] : [] });
    if (p === "/zones/zone1/workers/routes" && m === "GET") return jsonRes({ success: true, result: cfs.routes });
    if (p === "/zones/zone1/workers/routes" && m === "POST") { const b = JSON.parse(init.body); cfs.routes.push(b); return jsonRes({ success: true, result: { id: String(cfs.routes.length), ...b } }); }
    return jsonRes({ success: false, errors: [{ message: `no route ${m} ${p}` }] }, 404);
  }
  const gh = opts.gh || { token: "gh-token", repo: "duycan2000/caddemo", prs: [], commits: 0, checks: () => [{ name: "Workers Builds: caddemo", status: "completed", conclusion: "success", details_url: "https://dash.cloudflare.com/x", output: { summary: "Preview: https://abc-caddemo.duycan.workers.dev" } }], branches: { main: {
    "src/content.config.ts": 'import { defineCollection, z } from "astro:content";\nimport { glob } from "astro/loaders";\nconst blog = defineCollection({ loader: glob({ base: "./src/content/blog", pattern: "**/*.md" }), schema: ({ image }) => z.object({ title: z.string(), description: z.string(), pubDate: z.coerce.date(), heroImage: image().optional(), author: z.string(), category: z.enum(["guides", "reviews"]) }) });\nexport const collections = { blog };',
    "src/content/blog/hello.md": "---\ntitle: Hallo\ndescription: Test\npubDate: 2024-01-01\nauthor: Duy Can\ncategory: guides\n---\nText\n"
  } } };
  async function github(u, init) {
    if ((init?.headers?.Authorization || "") !== `Bearer ${gh.token}`) return jsonRes({ message: "Bad credentials" }, 401);
    const m = init?.method || "GET";
    const R = `/repos/${gh.repo}`;
    const p = decodeURIComponent(u.pathname);
    const ref = u.searchParams.get("ref") || "main";
    if (p === R && m === "GET") return jsonRes({ default_branch: "main", full_name: gh.repo });
    let r;
    if ((r = p.match(new RegExp(`^${R}/git/trees/(.+)$`)))) return jsonRes({ tree: Object.keys(gh.branches[r[1]] || {}).map((path) => ({ path, type: "blob" })) });
    if ((r = p.match(new RegExp(`^${R}/git/ref/heads/(.+)$`)))) return gh.branches[r[1]] ? jsonRes({ object: { sha: `sha-${r[1]}` } }) : jsonRes({ message: "Not Found" }, 404);
    if (p === `${R}/git/refs` && m === "POST") { const b = JSON.parse(init.body); gh.branches[b.ref.replace("refs/heads/", "")] = { ...gh.branches.main }; return jsonRes({ ref: b.ref }, 201); }
    if ((r = p.match(new RegExp(`^${R}/contents/(.+)$`)))) {
      if (m === "GET") { const f = gh.branches[ref]?.[r[1]]; return f !== undefined ? jsonRes({ content: Buffer.from(f.bin || f).toString("base64"), sha: `f-${r[1]}`, encoding: "base64" }) : jsonRes({ message: "Not Found" }, 404); }
      const b = JSON.parse(init.body);
      const buf = Buffer.from(b.content, "base64");
      gh.branches[b.branch][r[1]] = /\.(md|mdx)$/.test(r[1]) ? buf.toString("utf8") : { bin: buf };
      gh.commits++; gh.head = gh.head || {}; gh.head[b.branch] = `c${gh.commits}`;
      return jsonRes({ commit: { sha: `c${gh.commits}` } }, 201);
    }
    if (p === `${R}/pulls` && m === "POST") { const b = JSON.parse(init.body); gh.prs.push({ ...b, number: gh.prs.length + 1, merged: false, state: "open" }); return jsonRes({ number: gh.prs.length, html_url: `https://github.com/${gh.repo}/pull/${gh.prs.length}` }, 201); }
    if ((r = p.match(new RegExp(`^${R}/pulls/(\\d+)$`)))) { const pr = gh.prs[Number(r[1]) - 1]; return jsonRes({ state: pr.state, merged: pr.merged, head: { sha: gh.head[pr.head] } }); }
    if ((r = p.match(new RegExp(`^${R}/commits/([^/]+)/check-runs$`)))) return jsonRes({ check_runs: gh.checks(r[1]) });
    if ((r = p.match(new RegExp(`^${R}/commits/([^/]+)/status$`)))) return jsonRes({ statuses: [] });
    return jsonRes({ message: `no route ${m} ${p}` }, 404);
  }
  return async (input, init) => {
    const u = new URL(typeof input === "string" ? input : input.url);
    if (u.hostname === host && u.pathname === "/wp-json/wp/v2/media" && init?.method === "POST") {
      if ((init.headers?.Authorization || "") !== `Basic ${Buffer.from(`${wp.user}:${wp.pass}`).toString("base64")}`) return jsonRes({ code: "rest_not_logged_in", message: "Sorry" }, 401);
      const filename = /filename="([^"]+)"/.exec(init.headers["Content-Disposition"])[1];
      const bytes = new Uint8Array(init.body);
      wp.media = wp.media || [];
      wp.media.push({ filename, type: init.headers["Content-Type"], alt: u.searchParams.get("alt_text"), bytes });
      return jsonRes({ id: 900 + wp.media.length, source_url: `https://${host}/wp-content/uploads/${filename}`, media_details: { width: 800, height: 600 } }, 201);
    }
    if (u.hostname === "api.github.com") return github(u, init);
    if (u.hostname === "api.cloudflare.com") return cloudflare(u, init);
    if (opts.web && u.href in opts.web) { const w = opts.web[u.href]; const r = typeof w === "number" ? new Response("gone", { status: w }) : new Response(w, { status: 200, headers: { "content-type": "text/html" } }); Object.defineProperty(r, "url", { value: u.href }); return r; }
    if (u.hostname === "api.indexnow.org") { const so = opts.social || (opts.social = { posts: [] }); (so.indexnow ||= []).push(JSON.parse(init.body)); return new Response(null, { status: 200 }); }
    if (u.hostname === "api.postiz.com") {
      const so = opts.social || (opts.social = { posts: [] });
      if (new Headers(init?.headers).get("Authorization") !== "pz-key") return jsonRes({ message: "Unauthorized" }, 401);
      if (u.pathname === "/public/v1/integrations") return jsonRes([{ id: "pz-pin", name: "Golfdemo Pins", identifier: "pinterest" }, { id: "pz-threads", name: "golfdemo", identifier: "threads" }, { id: "pz-reddit", name: "u/golfdemo", identifier: "reddit" }]);
      if (u.pathname === "/public/v1/upload-from-url") { const b = JSON.parse(init.body); return jsonRes({ id: `up-${b.url.split("/").pop()}`, path: `https://uploads.postiz.com/${b.url.split("/").pop()}` }); }
      if (u.pathname === "/public/v1/posts") { const b = JSON.parse(init.body); so.posts.push({ net: `postiz:${b.posts[0].settings.__type}`, ...b }); return jsonRes([{ postId: `pp${so.posts.length}`, integration: b.posts[0].integration.id }]); }
    }
    if (u.hostname === "bsky.social") {
      const b = init?.body ? JSON.parse(init.body) : {};
      const so = opts.social || (opts.social = { posts: [] });
      if (u.pathname.endsWith("createSession")) return b.password === "app-pass-1234" ? jsonRes({ did: "did:plc:golf", accessJwt: "jwt1", handle: b.identifier }) : jsonRes({ error: "AuthenticationRequired", message: "Invalid identifier or password" }, 401);
      if (u.pathname.endsWith("createRecord")) { if (new Headers(init.headers).get("Authorization") !== "Bearer jwt1") return jsonRes({ error: "auth" }, 401); so.posts.push({ net: "bluesky", ...b }); return jsonRes({ uri: `at://did:plc:golf/app.bsky.feed.post/r${so.posts.length}`, cid: "c" }); }
    }
    if (u.hostname === "api.x.com") {
      const so = opts.social || (opts.social = { posts: [] });
      if (u.pathname === "/2/oauth2/token") { const f = new URLSearchParams(init.body); return f.get("code") === "x-code" && f.get("code_verifier") && new Headers(init.headers).get("Authorization")?.startsWith("Basic ") ? jsonRes({ access_token: "x-tok", refresh_token: "x-ref", expires_in: 7200 }) : jsonRes({ error: "invalid_request" }, 400); }
      if (u.pathname === "/2/users/me") return jsonRes({ data: { id: "1", username: "golfdemo" } });
      if (u.pathname === "/2/tweets") { so.posts.push({ net: "x", ...JSON.parse(init.body) }); return jsonRes({ data: { id: `t${so.posts.length}` } }, 201); }
    }
    const stRoute = u.hostname.replace(/^www\./, "") === host && cfs.routes.find((r) => /\/_[0-9a-f]{8}\/\*$/.test(r.pattern) && u.pathname.startsWith(r.pattern.slice(r.pattern.indexOf("/"), -1)));
    if (stRoute) {
      const w = cfs.workers[stRoute.script];
      w.mod = w.mod || (await import(`data:text/javascript,${encodeURIComponent(w.code)}`)).default;
      cfs.ae = cfs.ae || [];
      const env = { AE: { writeDataPoint: (pt) => cfs.ae.push({ ...pt, ts: Date.now() }) } };
      const req = new Request(u.href, { method: init?.method || "GET", headers: init?.headers || {}, body: init?.body });
      return w.mod.fetch(req, env, {});
    }
    if (u.hostname === host && u.pathname.startsWith("/images/") && cfs.routes.some((r) => r.pattern === `${host}/images/*`)) {
      const w = cfs.workers[cfs.routes.find((r) => r.pattern === `${host}/images/*`).script];
      const o = cfs.buckets[w.bucket]?.[decodeURIComponent(u.pathname.slice(8))];
      return o ? new Response(o.bytes, { status: 200, headers: { "content-type": o.type } }) : new Response("Not found", { status: 404 });
    }
    if (u.hostname === "openrouter.ai") return openrouter(init);
    if (u.hostname === "api.dataforseo.com") return dataforseo(u, init);
    const g = await google(u, init);
    if (g) return g;
    if (u.hostname === "example.de" && u.pathname === "/a") return new Response(`<html><body><nav>Menü</nav><article><h1>TGA-Ratgeber</h1>${Array.from({ length: 20 }, (_, k) => `<p>Nach DIN 1356 werden Bauzeichnungen einheitlich dargestellt; die Leistungsphasen der HOAI reichen von 1 bis 9 und gliedern die Planung (Absatz ${k}).</p>`).join("")}</article></body></html>`, { status: 200, headers: { "content-type": "text/html" } });
    if (u.hostname !== host) return new Response("not found", { status: 404 });
    if (u.pathname.startsWith("/wp-json/duyoi/v1")) return wpRoute(u, init);
    const pg = pages[u.pathname];
    const body = u.pathname === "/robots.txt" ? `User-agent: *\nDisallow: /wp-admin/\nSitemap: https://${host}/sitemap_index.xml`
      : u.pathname === "/sitemap_index.xml" ? index : u.pathname === "/page-sitemap.xml" ? (Object.keys(extra).length ? sitemapNow() : sitemap) : pg ? render(pg.title, pg.h1, pg.body, pg.extra) : extra[u.pathname] || null;
    if (!body) return new Response("<html>404</html>", { status: 404, headers: { "content-type": "text/html" } });
    const type = u.pathname.endsWith(".xml") ? "application/xml" : u.pathname.endsWith(".txt") ? "text/plain" : "text/html; charset=utf-8";
    const res = new Response(body, { status: 200, headers: { "content-type": type } });
    Object.defineProperty(res, "url", { value: u.href });
    return res;
  };
}
