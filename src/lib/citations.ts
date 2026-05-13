import citationsData from '@/data/citations.json';

export type CitationEntry = { count: number; fetchedAt: string };

export const allCitations = citationsData as Record<string, CitationEntry>;
