import type { APIRoute } from 'astro';
import { buildTagOgRoute } from '@/lib/page-builders/og-tag';

// EN tag-page OG cards. JA twin lives at `src/pages/og/tags/[tag].ts`.
const route = await buildTagOgRoute('en');
export const getStaticPaths = route.getStaticPaths;
export const GET: APIRoute = route.GET;
