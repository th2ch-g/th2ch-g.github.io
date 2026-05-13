import type { APIContext } from 'astro';
import { buildJsonFeedHandler } from '@/lib/page-builders/feed-json';

const handler = buildJsonFeedHandler('en');
export const GET = (ctx: APIContext) => handler(ctx);
