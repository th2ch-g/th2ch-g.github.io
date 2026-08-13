// `cv.bib` is locale-agnostic (the same DOIs map to the same BibTeX
// entries regardless of which CV language a reader is viewing), but serving
// a `/en/cv.bib` sibling keeps downloads on the current locale route.
export { GET } from '@/pages/cv.bib';
