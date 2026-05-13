import bibtexData from '@/data/bibtex.json';

export type BibtexEntry = { bibtex: string; fetchedAt: string };

export const allBibtex = bibtexData as Record<string, BibtexEntry>;
