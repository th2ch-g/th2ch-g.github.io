import type { APIContext } from 'astro';
import { buildPostsRssHandler } from '@/lib/page-builders/rss-posts';

const handler = buildPostsRssHandler('en');
export const GET = (ctx: APIContext) => handler(ctx);
