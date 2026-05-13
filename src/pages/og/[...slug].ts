import type { APIRoute } from 'astro';
import { buildPostOgRoute } from '@/lib/page-builders/og-post';

// JA post OG cards. EN twin lives at `src/pages/en/og/[...slug].ts`.
const route = await buildPostOgRoute('ja');
export const getStaticPaths = route.getStaticPaths;
export const GET: APIRoute = route.GET;
