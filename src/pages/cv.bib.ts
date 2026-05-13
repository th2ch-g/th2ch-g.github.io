import type { APIRoute } from 'astro';
import { allBibtex } from '@/lib/bibtex';

// One-shot `.bib` export of every BibTeX entry in src/data/bibtex.json.
// The JSON is sorted by DOI in `scripts/sync-bibtex.mjs` so the on-disk
// order matches the export order here. The file is served verbatim to
// `<a download>` callers; BibTeX/Biber tooling ignores any non-entry text
// outside `@type{…}` blocks, so no wrapper formatting is needed.
export const GET: APIRoute = () => {
  const body = Object.values(allBibtex)
    .map((e) => e.bibtex)
    .filter(Boolean)
    .join('\n\n');
  return new Response(body + '\n', {
    headers: {
      'content-type': 'application/x-bibtex; charset=utf-8',
      'content-disposition': 'attachment; filename="cv.bib"',
    },
  });
};
