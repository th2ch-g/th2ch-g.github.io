// Shared scaffolding for the two CrossRef sync scripts
// (sync-citation-counts.mjs, sync-bibtex.mjs). Both scripts walk the same
// DOI list extracted from the bilingual CV markdown, fetch one resource per
// DOI from CrossRef under a polite-pool User-Agent, fail-soft on per-DOI
// errors (keep the previous snapshot value), and write a sorted JSON file
// under src/data/. This module centralises every step except the per-DOI
// fetch itself.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { siteHost, readProfileShallow } from '../../src/lib/profile-yaml.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const CV_FILES = [
  resolve(ROOT, 'src/content/cv/ja.md'),
  resolve(ROOT, 'src/content/cv/en.md'),
];

const DOI_URL = /https?:\/\/(?:dx\.)?doi\.org\/(10\.[0-9]{4,9}\/[^\s)>"']+)/gi;

// Collect every DOI referenced in the CV markdown. Trailing punctuation
// (`,`, `;`, `.`) that survives the regex is stripped; case is normalised
// because CrossRef treats DOIs as case-insensitive.
export async function extractDoisFromCv() {
  const set = new Set();
  for (const file of CV_FILES) {
    const text = await readFile(file, 'utf8');
    for (const m of text.matchAll(DOI_URL)) {
      set.add(m[1].replace(/[.,;]+$/, '').toLowerCase());
    }
  }
  return [...set];
}

// A reachable mailto in the User-Agent puts requests into CrossRef's
// "polite pool" with looser shared rate limits. Both the host and the
// email are sourced from profile.yaml so site identity stays single-sourced.
export async function politeUserAgent() {
  const host = await siteHost();
  const { email } = await readProfileShallow();
  return email ? `${host} (mailto:${email})` : host;
}

export async function loadSnapshot(outPath) {
  try {
    return JSON.parse(await readFile(outPath, 'utf8'));
  } catch {
    return {};
  }
}

// Sort by DOI to keep the on-disk shape stable across runs (otherwise
// JSON.stringify's insertion-order output would churn diffs whenever
// CrossRef returns DOIs in a different order).
export async function writeSnapshot(outPath, data) {
  await mkdir(dirname(outPath), { recursive: true });
  const sorted = Object.fromEntries(
    Object.entries(data).sort(([a], [b]) => a.localeCompare(b)),
  );
  await writeFile(outPath, JSON.stringify(sorted, null, 2) + '\n', 'utf8');
  return Object.keys(sorted).length;
}

// Orchestrate the DOI fetch loop. The caller supplies:
//   - outPath: destination JSON path
//   - fetchOne(doi, ua) -> { status: 'ok', value } | { status, http? }
//   - persist(snapshot, doi, value, now): mutate snapshot in place
//   - formatLog(value) -> string: per-DOI success log suffix
//
// All other behaviour (fail-soft on errors, sorted write, summary line)
// is fixed so the two scripts stay byte-identical for unchanged DOI sets.
export async function runDoiSync({ outPath, fetchOne, persist, formatLog }) {
  const ua = await politeUserAgent();
  const dois = await extractDoisFromCv();
  const existing = await loadSnapshot(outPath);
  console.log(`Found ${dois.length} unique DOI(s) in CV.`);

  let ok = 0;
  let skipped = 0;
  const now = new Date().toISOString();
  for (const doi of dois) {
    process.stdout.write(`  ${doi} ... `);
    try {
      const r = await fetchOne(doi, ua);
      if (r.status === 'ok') {
        persist(existing, doi, r.value, now);
        console.log(formatLog(r.value));
        ok += 1;
      } else {
        console.log(`(skipped: ${r.status}${r.http ? ' ' + r.http : ''})`);
        skipped += 1;
      }
    } catch (err) {
      console.log(`(network error: ${err.message})`);
      skipped += 1;
    }
  }

  const total = await writeSnapshot(outPath, existing);
  console.log(
    `\nWrote ${outPath} (${total} entries; ${ok} updated, ${skipped} skipped).`,
  );
}
