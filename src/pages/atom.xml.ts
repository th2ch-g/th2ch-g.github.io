import type { APIContext } from 'astro';
import { buildAtomFeedHandler } from '@/lib/page-builders/feed-atom';

// JA posts Atom feed. EN twin lives at `src/pages/en/atom.xml.ts`.
const handler = buildAtomFeedHandler('ja');
export const GET = (ctx: APIContext) => handler(ctx);
