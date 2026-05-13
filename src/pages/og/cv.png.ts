import type { APIRoute } from 'astro';
import { renderSectionOg } from '@/lib/og-config';

// OG card for the CV page.
export const GET: APIRoute = () =>
  renderSectionOg({ lang: 'ja', title: 'CV', pageLabel: 'CV' });
