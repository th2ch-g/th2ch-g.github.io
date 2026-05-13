// `cv.bib` is locale-agnostic (the same DOIs map to the same BibTeX
// entries regardless of which CV language a reader is viewing), but
// serving a `/en/cv.bib` sibling keeps the URL pattern aligned with
// `/en/cv.pdf` and friends.
export { GET } from '@/pages/cv.bib';
