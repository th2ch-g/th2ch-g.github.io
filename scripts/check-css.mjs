#!/usr/bin/env node
// Detect CSS class selectors that are defined in src/styles/ but never
// referenced anywhere under src/. Pure heuristic — does not parse CSS or
// understand `:is()`/`:where()`/scoped Astro styles, but reliably surfaces
// orphans from deleted components without false-deleting anything.
//
// Run: `npm run check:css` (detection only — exits 0 even with findings).

import { readFile, readdir } from 'node:fs/promises';
import { join, resolve, extname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const SRC = join(ROOT, 'src');
const CSS_DIR = join(SRC, 'styles');

// Match `.foo-bar_baz` but stop on `:`, `[`, whitespace, etc. Skips
// numeric leading segments which are invalid identifiers anyway.
const CLASS_RE = /\.([a-zA-Z][a-zA-Z0-9_-]*)/g;

// Selectors that are emitted by libraries / browsers, not by this site's
// own components. Keeping them out of the unused report avoids noise.
const WHITELIST = new Set([
  // Pagefind UI bundle (loaded at runtime, classes never appear in src/)
  'pagefind-ui',
  // KaTeX renders these dynamically
  'katex',
  'katex-display',
  'katex-html',
  'katex-mathml',
  // Twitter widget upgrade target
  'twitter-tweet',
  // Mermaid renders these dynamically
  'mermaid',
]);

async function safeRead(path) {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return '';
  }
}

async function walk(dir, exts) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walk(p, exts)));
    } else if (exts.includes(extname(entry.name))) {
      out.push(p);
    }
  }
  return out;
}

const cssFiles = await walk(CSS_DIR, ['.css']);
const srcFiles = await walk(SRC, ['.astro', '.ts', '.tsx', '.js', '.mjs']);
const srcBlob = (await Promise.all(srcFiles.map(safeRead))).join('\n');

let total = 0;
for (const cssPath of cssFiles) {
  const text = await safeRead(cssPath);
  const found = new Set();
  for (const m of text.matchAll(CLASS_RE)) found.add(m[1]);

  const unused = [];
  for (const cls of found) {
    if (WHITELIST.has(cls) || [...WHITELIST].some((w) => cls.startsWith(`${w}__`) || cls.startsWith(`${w}-`))) {
      continue;
    }
    // Use lookaround-free boundaries: a class reference is preceded and
    // followed by something other than `[a-zA-Z0-9_-]`. Word-boundary
    // `\b` would split mid-hyphen and break long identifier matches.
    const escaped = cls.replace(/[-_]/g, '\\$&');
    const re = new RegExp(`(?:^|[^a-zA-Z0-9_-])${escaped}(?:[^a-zA-Z0-9_-]|$)`);
    if (!re.test(srcBlob)) unused.push(cls);
  }

  const rel = relative(ROOT, cssPath);
  if (unused.length === 0) {
    console.log(`✓ ${rel}: all ${found.size} class(es) referenced`);
  } else {
    console.warn(`⚠ ${rel}: ${unused.length} of ${found.size} class(es) appear unused`);
    for (const cls of unused) console.warn(`    .${cls}`);
    total += unused.length;
  }
}

if (total > 0) {
  console.warn(`\nTotal unreferenced classes: ${total} (heuristic; verify before deleting).`);
}
