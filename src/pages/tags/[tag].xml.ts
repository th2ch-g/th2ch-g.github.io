import { buildTagRssHandlers } from '@/lib/page-builders/rss-tag';

// JA per-tag posts feed. EN twin lives at `src/pages/en/tags/[tag].xml.ts`.
const route = buildTagRssHandlers('ja');
export const getStaticPaths = route.getStaticPaths;
export const GET = route.GET;
