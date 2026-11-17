// Site WordPress giả (tiếng Đức) để kiểm thử chức năng Phục hồi thứ hạng mà không cần mạng.

export function fakeSite() {
  const host = "caddemo.de";
  const filler = (topic, n) => Array.from({ length: n }, (_, i) => `<p>Im Bereich ${topic} ist die saubere Planung der erste Schritt für jedes Projekt und sie spart später viel Aufwand bei der Abstimmung mit allen Beteiligten im Team ${i}. Die Zeichnungen müssen klar und eindeutig sein, damit alle Gewerke die gleiche Grundlage haben und Fehler früh erkannt werden. Zum Schluss prüfen wir alle Details zu ${topic} noch einmal gründlich, bevor die Unterlagen an den Kunden gehen (Abschnitt ${i}).</p>`).join("");
  const page = (title, h1, body, extra = "") => `<!doctype html><html lang="de"><head><title>${title}</title><meta name="description" content="${h1} – Beschreibung."><link rel="canonical" href="https://${host}${extra}"></head><body class="elementor-default"><header><nav><a href="/">Start</a><a href="/cad-dienstleistung-tga/">TGA</a><a href="/kontakt/">Kontakt</a></nav></header><main><h1>${h1}</h1>${body}</main><footer><a href="/impressum/">Impressum</a></footer></body></html>`;
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
  return async (input) => {
    const u = new URL(typeof input === "string" ? input : input.url);
    if (u.hostname !== host) return new Response("not found", { status: 404 });
    const body = u.pathname === "/robots.txt" ? `User-agent: *\nDisallow: /wp-admin/\nSitemap: https://${host}/sitemap_index.xml`
      : u.pathname === "/sitemap_index.xml" ? index : u.pathname === "/page-sitemap.xml" ? sitemap : pages[u.pathname];
    if (!body) return new Response("<html>404</html>", { status: 404, headers: { "content-type": "text/html" } });
    const type = u.pathname.endsWith(".xml") ? "application/xml" : u.pathname.endsWith(".txt") ? "text/plain" : "text/html; charset=utf-8";
    const res = new Response(body, { status: 200, headers: { "content-type": type } });
    Object.defineProperty(res, "url", { value: u.href });
    return res;
  };
}
