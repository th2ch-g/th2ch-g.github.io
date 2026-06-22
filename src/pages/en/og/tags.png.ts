import type { APIRoute } from 'astro';
import { renderSectionOg } from '@/lib/og-config';

// OG card for the English tags index page (`/en/tags`).
// Per-tag landing pages get their own cards under `en/og/tags/`.
export const GET: APIRoute = () =>
  renderSectionOg({ lang: 'en', title: 'Tags', pageLabel: 'Tags' });
