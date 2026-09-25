import type { Lang } from '@/i18n/ui';
import { getRelativeLocaleUrl } from './locale-url';

export function setupLocaleLinks(): void {
  const lang: Lang = document.documentElement.lang === 'ja' ? 'ja' : 'en';
  document.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((link) => {
    const href = link.getAttribute('href') ?? '';
    if (href.startsWith('#') || link.hasAttribute('download')) return;
    const url = new URL(link.href);
    if (url.origin !== location.origin || /\.[a-z\d]+$/i.test(url.pathname)) return;
    if (link.closest('.lang-switch')) {
      const target = link.hreflang as Lang;
      link.href = getRelativeLocaleUrl(target, `${location.pathname}${location.search}${location.hash}`);
      link.classList.toggle('active', target === lang);
      if (target === lang) link.setAttribute('aria-current', 'true');
      else link.removeAttribute('aria-current');
    } else if (!link.hreflang) {
      link.href = getRelativeLocaleUrl(lang, `${url.pathname}${url.search}${url.hash}`);
    }
  });
  const canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href;
  if (canonical) {
    document.querySelectorAll<HTMLElement>('[data-share-base]').forEach((share) => {
      const original = share.dataset.shareBase!;
      share.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((link) => {
        const url = new URL(link.href);
        for (const [key, value] of url.searchParams) {
          if (value.includes(original)) url.searchParams.set(key, value.replace(original, canonical));
        }
        link.href = url.href;
      });
      const copy = share.querySelector<HTMLElement>('[data-share-url]');
      if (copy) copy.dataset.shareUrl = canonical;
    });
  }
}
