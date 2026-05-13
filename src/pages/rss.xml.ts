import type { APIContext } from 'astro';
import { buildPostsRssHandler } from '@/lib/page-builders/rss-posts';

// JA posts feed. EN twin lives at `src/pages/en/rss.xml.ts`. Drafts are
// excluded to match the build-time filter in `PostsListPage.astro`.
const handler = buildPostsRssHandler('ja');
export const GET = (ctx: APIContext) => handler(ctx);
