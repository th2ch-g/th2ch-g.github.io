import { getRelativeLocaleUrl } from 'astro:i18n';
import type { Lang } from '@/i18n/ui';

// Astro formats locale URLs as directories. Static feed/image endpoints
// are files, so their public URLs must not end in a slash.
export function getLocaleFileUrl(lang: Lang, path: string): string {
  return getRelativeLocaleUrl(lang, path).replace(/\/$/, '');
}
