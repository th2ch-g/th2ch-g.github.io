import type { APIRoute } from 'astro';
import { renderSectionOg } from '@/lib/og-config';

export const GET: APIRoute = () =>
  renderSectionOg({ lang: 'en', title: 'CV', pageLabel: 'CV' });
