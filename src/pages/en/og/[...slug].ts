import type { APIRoute } from 'astro';
import { buildPostOgRoute } from '@/lib/page-builders/og-post';

// EN post OG cards. JA twin lives at `src/pages/og/[...slug].ts`.
const route = await buildPostOgRoute('en');
export const getStaticPaths = route.getStaticPaths;
export const GET: APIRoute = route.GET;
