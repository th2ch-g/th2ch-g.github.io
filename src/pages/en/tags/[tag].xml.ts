import { buildTagRssHandlers } from '@/lib/page-builders/rss-tag';

// EN per-tag posts feed. JA twin lives at `src/pages/tags/[tag].xml.ts`.
const route = buildTagRssHandlers('en');
export const getStaticPaths = route.getStaticPaths;
export const GET = route.GET;
