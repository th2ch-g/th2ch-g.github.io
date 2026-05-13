import type { APIRoute } from 'astro';
import { getProfileMeta } from '@/lib/content';
import { renderSectionOg } from '@/lib/og-config';

// English mirror of `src/pages/og/default.png.ts`.
export const GET: APIRoute = async () => {
  const meta = await getProfileMeta('en');
  return renderSectionOg({
    lang: 'en',
    title: meta.name,
    description: meta.headline ?? '',
    pageLabel: 'Home',
  });
};
