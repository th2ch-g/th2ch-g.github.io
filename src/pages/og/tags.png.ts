import type { APIRoute } from 'astro';
import { renderSectionOg } from '@/lib/og-config';

// OG card for the tags index page (`/tags`).
// Per-tag landing pages get their own cards under `og/tags/`.
export const GET: APIRoute = () =>
  renderSectionOg({ lang: 'ja', title: 'Tags', pageLabel: 'Tags' });
