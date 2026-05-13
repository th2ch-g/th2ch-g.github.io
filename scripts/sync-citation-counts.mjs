#!/usr/bin/env node
// Refresh src/data/citations.json from CrossRef. Wired into `prebuild` so
// every `npm run build` (and the GitHub Actions deploy) reflects the latest
// cited-by counts. Per-DOI failures (404, network) are logged but never
// abort the build — existing snapshot values are preserved.

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runDoiSync } from './lib/fetch-cache.mjs';

const ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const OUT = resolve(ROOT, 'src/data/citations.json');

async function fetchOne(doi, ua) {
  const url = `https://api.crossref.org/works/${encodeURIComponent(doi)}`;
  // 15s per-DOI cap; runDoiSync's catch logs and preserves the snapshot.
  const res = await fetch(url, {
    headers: { 'User-Agent': ua, Accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 404) return { status: 'not-found' };
  if (!res.ok) return { status: 'error', http: res.status };
  const json = await res.json();
  const count = json?.message?.['is-referenced-by-count'];
  if (typeof count !== 'number') return { status: 'malformed' };
  return { status: 'ok', value: count };
}

await runDoiSync({
  outPath: OUT,
  fetchOne,
  persist: (existing, doi, count, now) => {
    existing[doi] = { count, fetchedAt: now };
  },
  formatLog: (count) => `${count}`,
});
