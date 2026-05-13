#!/usr/bin/env node
// Refresh src/data/bibtex.json from CrossRef. BibTeX is fetched via CrossRef's
// content negotiation endpoint so the per-paper "BibTeX" button on /cv can
// paste a ready citation without a runtime round-trip. Per-DOI failures are
// logged but never abort the build; existing snapshot values are preserved.

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runDoiSync } from './lib/fetch-cache.mjs';

const ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const OUT = resolve(ROOT, 'src/data/bibtex.json');

// Map CrossRef's formal publisher names to the shorter form Google Scholar
// uses in its BibTeX export. Unmapped publishers fall through unchanged.
const PUBLISHER_NORMALIZE = {
  'American Chemical Society (ACS)': 'ACS Publications',
  'Springer Science and Business Media LLC': 'Springer Nature',
  'openRxiv': 'bioRxiv',
  'Cold Spring Harbor Laboratory': 'bioRxiv',
};

// Title-word stopwords for Scholar-style citation keys. Conservative list —
// Scholar skips leading articles but keeps most other words ("attention",
// "deep", "haplotype", etc.).
const KEY_STOPWORDS = new Set(['a', 'an', 'the']);

// First-author lastname (lowercased, ASCII-only) for the citation key.
// CrossRef formats author values as "Last, First and Last, First", so the
// first lastname is the substring before the first comma of the first
// "X and Y" segment.
function firstAuthorLastname(authorField) {
  if (!authorField) return '';
  const first = authorField.split(' and ')[0] ?? '';
  const lastname = (first.split(',')[0] ?? '').trim();
  return lastname.toLowerCase().replace(/[^a-z]/g, '');
}

// First significant word of the title (lowercased, ASCII-only). Splits on
// any non-letter run so that "Distance-Restraint-Guided" yields "distance"
// rather than the concatenated "distancerestraintguided".
function firstTitleWord(title) {
  if (!title) return '';
  for (const w of title.split(/[^A-Za-z]+/)) {
    const lc = w.toLowerCase();
    if (lc && !KEY_STOPWORDS.has(lc)) return lc;
  }
  return '';
}

function scholarKey(fields) {
  const a = firstAuthorLastname(fields.get('author'));
  const y = (fields.get('year') ?? '').replace(/[^0-9]/g, '');
  const t = firstTitleWord(fields.get('title'));
  return `${a}${y}${t}`;
}

// Reshape CrossRef's single-line BibTeX into Google Scholar's compact
// export style: minimal field set (title, author, journal/booktitle, year,
// publisher), one field per indented line, citation key built from
// firstauthor + year + first-title-word. Field values can themselves
// contain commas inside `{...}` (most often `author={Last, F. and Last, G.}`),
// so we split only on top-level commas tracked by brace depth.
const SCHOLAR_FIELDS = ['title', 'author', 'journal', 'booktitle', 'year', 'publisher', 'doi'];

function prettyBibtex(raw) {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('@')) return trimmed;
  const open = trimmed.indexOf('{');
  const close = trimmed.lastIndexOf('}');
  if (open < 0 || close <= open) return trimmed;
  const type = trimmed.slice(0, open);
  const inner = trimmed.slice(open + 1, close);

  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === ',' && depth === 0) {
      parts.push(inner.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(inner.slice(start).trim());
  const cleaned = parts.filter((p) => p.length > 0);
  if (cleaned.length === 0) return `${type}{}`;

  // Index field name → value, stripping the original citation key (parts[0])
  // and the outer `{...}` wrapper from each value.
  const fields = new Map();
  for (const f of cleaned.slice(1)) {
    const eq = f.indexOf('=');
    if (eq < 0) continue;
    const name = f.slice(0, eq).trim().toLowerCase();
    let value = f.slice(eq + 1).trim();
    if (value.startsWith('{') && value.endsWith('}')) {
      value = value.slice(1, -1);
    }
    fields.set(name, value);
  }

  const pub = fields.get('publisher');
  if (pub && PUBLISHER_NORMALIZE[pub]) fields.set('publisher', PUBLISHER_NORMALIZE[pub]);

  const key = scholarKey(fields);
  const rendered = SCHOLAR_FIELDS
    .filter((k) => fields.has(k))
    .map((k) => `  ${k}={${fields.get(k)}}`);
  if (rendered.length === 0) return `${type}{${key}}`;
  return `${type}{${key},\n${rendered.join(',\n')}\n}`;
}

async function fetchOne(doi, ua) {
  const url = `https://api.crossref.org/works/${encodeURIComponent(doi)}/transform/application/x-bibtex`;
  // 15s per-DOI cap; runDoiSync's catch preserves the existing snapshot.
  const res = await fetch(url, {
    headers: { 'User-Agent': ua, Accept: 'application/x-bibtex' },
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 404) return { status: 'not-found' };
  if (!res.ok) return { status: 'error', http: res.status };
  const text = (await res.text()).trim();
  if (!text.startsWith('@')) return { status: 'malformed' };
  return { status: 'ok', value: prettyBibtex(text) };
}

await runDoiSync({
  outPath: OUT,
  fetchOne,
  persist: (existing, doi, bibtex, now) => {
    existing[doi] = { bibtex, fetchedAt: now };
  },
  formatLog: (bibtex) => `ok (${bibtex.length} bytes)`,
});
