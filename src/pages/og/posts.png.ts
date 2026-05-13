import type { APIRoute } from 'astro';
import { renderSectionOg } from '@/lib/og-config';

// OG card for the Posts list page (`/posts`).
// Post detail pages get their own per-slug card via `[...slug].ts`.
export const GET: APIRoute = () =>
  renderSectionOg({ lang: 'ja', title: 'Posts', pageLabel: 'Posts' });
