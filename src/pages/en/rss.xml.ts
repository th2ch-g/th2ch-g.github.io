import type { APIContext } from 'astro';
import { buildPostsRssHandler } from '@/lib/page-builders/rss-posts';

// EN posts feed. JA twin lives at `src/pages/rss.xml.ts`.
const handler = buildPostsRssHandler('en');
export const GET = (ctx: APIContext) => handler(ctx);
