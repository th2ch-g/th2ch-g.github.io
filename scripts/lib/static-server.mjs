// Tiny in-process HTTP file server pointing at `dist/`. Used by both
// `build-cv-pdf.mjs` (Playwright PDF capture) and `check-a11y.mjs` (axe-core
// audits) so they don't need to shell out to `astro preview`. Listens on a
// random port so multiple scripts can run in parallel without collision.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { existsSync } from 'node:fs';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
};

function makeResolver(distDir) {
  return async function resolvePath(urlPath) {
    // Strip query/hash, normalize, and resolve directory routes to index.html.
    const cleaned = urlPath.split('?')[0].split('#')[0];
    let p = join(distDir, cleaned);
    // Disallow escapes from distDir (defense in depth — server is local).
    if (!p.startsWith(distDir)) return null;
    try {
      const s = await stat(p);
      if (s.isDirectory()) p = join(p, 'index.html');
    } catch {
      // Fallback: directory-style URL without trailing slash.
      if (!extname(cleaned)) p = join(distDir, cleaned, 'index.html');
    }
    return p;
  };
}

// Start a static server rooted at `distDir`. Returns `{ url, close }`.
// `close` resolves once the server has fully shut down.
export async function startStaticServer(distDir) {
  const resolvePath = makeResolver(distDir);
  const server = createServer(async (req, res) => {
    const filePath = await resolvePath(req.url || '/');
    if (!filePath || !existsSync(filePath)) {
      res.statusCode = 404;
      res.end('Not found');
      return;
    }
    try {
      const data = await readFile(filePath);
      res.setHeader('content-type', MIME[extname(filePath)] ?? 'application/octet-stream');
      res.end(data);
    } catch (err) {
      res.statusCode = 500;
      res.end(String(err));
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((r) => server.close(r)),
  };
}
