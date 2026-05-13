import type { APIContext } from 'astro';
import { buildJsonFeedHandler } from '@/lib/page-builders/feed-json';

// JA posts JSON Feed (https://jsonfeed.org/). EN twin lives at
// `src/pages/en/feed.json.ts`. Drafts are excluded to match RSS/Atom.
const handler = buildJsonFeedHandler('ja');
export const GET = (ctx: APIContext) => handler(ctx);
