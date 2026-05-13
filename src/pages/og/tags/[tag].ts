import type { APIRoute } from 'astro';
import { buildTagOgRoute } from '@/lib/page-builders/og-tag';

// JA tag-page OG cards. EN twin lives at `src/pages/en/og/tags/[tag].ts`.
const route = await buildTagOgRoute('ja');
export const getStaticPaths = route.getStaticPaths;
export const GET: APIRoute = route.GET;
