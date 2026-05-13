<?xml version="1.0" encoding="UTF-8"?>
<!--
  Browser-side stylesheet for sitemap*.xml.
  Crawlers ignore xml-stylesheet PIs, so this only affects human viewers.
  Theme tokens mirror src/styles/tokens.css; theming follows the OS via
  prefers-color-scheme since we can't read the site's localStorage toggle
  from inside an XSL-rendered document.
-->
<xsl:stylesheet version="1.0"
  xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
  xmlns:sm="http://www.sitemaps.org/schemas/sitemap/0.9"
  xmlns:xhtml="http://www.w3.org/1999/xhtml">

  <xsl:output method="html" version="5.0" encoding="UTF-8" indent="yes"
              omit-xml-declaration="yes"
              doctype-system="about:legacy-compat"/>

  <xsl:template match="/">
    <html lang="en">
      <head>
        <meta charset="utf-8"/>
        <meta name="viewport" content="width=device-width,initial-scale=1"/>
        <meta name="robots" content="noindex"/>
        <title>XML Sitemap</title>
        <style><![CDATA[
:root {
  color-scheme: light dark;
  --bg: #ebe8e0;
  --fg: #1f1f1f;
  --muted: #5a5a5a;
  --border: #d2cfc4;
  --card: #f5f3ec;
  --accent: #2b6cb0;
  --font-sans: system-ui, -apple-system, "Segoe UI", "Hiragino Sans", "Yu Gothic UI", sans-serif;
  --font-mono: "JetBrains Mono", "Menlo", "Consolas", monospace;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #272a32;
    --fg: #ececec;
    --muted: #b2b6bd;
    --border: #454a55;
    --card: #333740;
    --accent: #79b8ff;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--fg);
  font-family: var(--font-sans);
  line-height: 1.55;
}
main {
  max-width: 64rem;
  margin: 0 auto;
  padding: 2rem 1.25rem 4rem;
}
h1 {
  font-size: 1.6rem;
  margin: 0 0 0.4rem;
  font-family: var(--font-mono);
  font-weight: 700;
  letter-spacing: -0.01em;
}
.muted { color: var(--muted); font-size: 0.9rem; margin: 0; }
.meta-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin: 0 0 1.25rem;
}
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }
table {
  width: 100%;
  border-collapse: collapse;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
  font-size: 0.92rem;
}
th, td {
  text-align: left;
  padding: 0.55rem 0.9rem;
  border-bottom: 1px solid var(--border);
  vertical-align: top;
}
th {
  font-weight: 600;
  color: var(--muted);
  font-size: 0.78rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  background: var(--bg);
}
tbody tr:last-child td { border-bottom: none; }
tbody tr:hover td { background: rgba(127, 127, 127, 0.06); }
td.url a {
  font-family: var(--font-mono);
  font-size: 0.88rem;
  word-break: break-all;
}
td.date, td.priority, td.freq, td.langs {
  white-space: nowrap;
  color: var(--muted);
  font-family: var(--font-mono);
  font-size: 0.85rem;
}
@media (max-width: 720px) {
  td.freq, th.freq, td.priority, th.priority, td.langs, th.langs {
    display: none;
  }
}
        ]]></style>
      </head>
      <body>
        <main>
          <h1>XML Sitemap</h1>
          <div class="meta-row">
            <p class="muted">
              <xsl:choose>
                <xsl:when test="sm:sitemapindex">
                  Sitemap index — <xsl:value-of select="count(sm:sitemapindex/sm:sitemap)"/> sitemap(s)
                </xsl:when>
                <xsl:otherwise>
                  <xsl:value-of select="count(sm:urlset/sm:url)"/> URLs
                </xsl:otherwise>
              </xsl:choose>
            </p>
            <p class="muted"><a href="/">← Back to site</a></p>
          </div>
          <xsl:apply-templates select="sm:sitemapindex"/>
          <xsl:apply-templates select="sm:urlset"/>
        </main>
      </body>
    </html>
  </xsl:template>

  <xsl:template match="sm:sitemapindex">
    <table>
      <thead>
        <tr>
          <th>Sitemap</th>
          <th class="date">Last modified</th>
        </tr>
      </thead>
      <tbody>
        <xsl:for-each select="sm:sitemap">
          <xsl:sort select="sm:loc"/>
          <tr>
            <td class="url"><a href="{sm:loc}"><xsl:value-of select="sm:loc"/></a></td>
            <td class="date"><xsl:value-of select="sm:lastmod"/></td>
          </tr>
        </xsl:for-each>
      </tbody>
    </table>
  </xsl:template>

  <xsl:template match="sm:urlset">
    <table>
      <thead>
        <tr>
          <th>URL</th>
          <th class="date">Last modified</th>
          <th class="langs">Langs</th>
          <th class="freq">Change freq</th>
          <th class="priority">Priority</th>
        </tr>
      </thead>
      <tbody>
        <xsl:for-each select="sm:url">
          <xsl:sort select="sm:loc"/>
          <tr>
            <td class="url"><a href="{sm:loc}"><xsl:value-of select="sm:loc"/></a></td>
            <td class="date"><xsl:value-of select="sm:lastmod"/></td>
            <td class="langs"><xsl:value-of select="count(xhtml:link[@rel='alternate'])"/></td>
            <td class="freq"><xsl:value-of select="sm:changefreq"/></td>
            <td class="priority"><xsl:value-of select="sm:priority"/></td>
          </tr>
        </xsl:for-each>
      </tbody>
    </table>
  </xsl:template>

</xsl:stylesheet>
