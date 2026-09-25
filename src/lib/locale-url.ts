import type { Lang } from '@/i18n/ui';

export function getRelativeLocaleUrl(lang: Lang, path: string): string {
  const url = new URL(path, 'https://locale.invalid');
  url.pathname = url.pathname.replace(/^\/(en|ja)(?=\/|$)/, '') || '/';
  url.searchParams.set('lang', lang);
  return `${url.pathname}${url.search}${url.hash}`;
}

// Static binary assets keep distinct filenames for each language.
export function getLocaleFileUrl(lang: Lang, path: string): string {
  return `${lang === 'ja' ? '/ja' : ''}${path.replace(/\/$/, '')}`;
}
