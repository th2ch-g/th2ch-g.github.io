import type { APIRoute } from 'astro';
import { renderSectionOg } from '@/lib/og-config';

// OG card for the Photo gallery (list page + photo-detail fallback).
export const GET: APIRoute = () =>
  renderSectionOg({ lang: 'ja', title: 'Gallery', pageLabel: 'Gallery' });
