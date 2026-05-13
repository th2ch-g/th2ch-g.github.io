import type { APIContext } from 'astro';
import { buildAtomFeedHandler } from '@/lib/page-builders/feed-atom';

const handler = buildAtomFeedHandler('en');
export const GET = (ctx: APIContext) => handler(ctx);
