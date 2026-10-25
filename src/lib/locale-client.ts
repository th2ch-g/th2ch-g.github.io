import type { Lang } from '@/i18n/ui';
import { getRelativeLocaleUrl } from './locale-url';

export function updateLanguageSwitcher(): void {
  const lang = document.documentElement.lang;
  document.querySelectorAll<HTMLAnchorElement>('.lang-switch a[hreflang]').forEach((link) => {
    const target = link.hreflang as Lang;
    const path = link.dataset.localePath;
    link.href = getRelativeLocaleUrl(target, path
      ? `${path}${location.search}` : `${location.pathname}${location.search}${location.hash}`);
    if (target === lang) link.setAttribute('aria-current', 'true');
    else link.removeAttribute('aria-current');
  });
}

export function setupLocaleLinks(): void {
  updateLanguageSwitcher();
  const lang: Lang = document.documentElement.lang === 'ja' ? 'ja' : 'en';
  document.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((link) => {
    const href = link.getAttribute('href') ?? '';
    if (href.startsWith('#') || link.hasAttribute('download')) return;
    const url = new URL(link.href);
    if (url.origin !== location.origin || /\.[a-z\d]+$/i.test(url.pathname)) return;
    if (!link.hreflang) {
      const localized = getRelativeLocaleUrl(lang, `${url.pathname}${url.search}${url.hash}`);
      if (href !== localized) link.href = localized;
    }
  });
  const canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href;
  if (canonical) {
    document.querySelectorAll<HTMLElement>('[data-share-url]').forEach((copy) => {
      copy.dataset.shareUrl = canonical;
    });
  }
}
