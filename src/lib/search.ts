import { hasOpenModal } from './modal-focus';
import { createFallback, type SearchIndexItem } from './search-fallback';
export type { SearchIndexItem } from './search-fallback';

interface PagefindUIOptions {
  element: string;
  bundlePath: string;
  showSubResults: boolean;
  showImages: boolean;
  showFilters: boolean;
  translations: { placeholder: string };
}

type PagefindUIConstructor = new (options: PagefindUIOptions) => unknown;

declare global {
  interface Window {
    PagefindUI?: PagefindUIConstructor;
  }
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`${src} failed to load`));
    document.head.appendChild(script);
  });
}

export function setupSearch(): void {
  const trigger = document.querySelector<HTMLButtonElement>('[data-search-open]');
  const dialog = document.querySelector<HTMLDialogElement>('[data-search-dialog]');
  const host = document.querySelector<HTMLElement>('#pagefind-search');
  if (!trigger || !dialog || !host || dialog.dataset.searchWired === '1') return;
  dialog.dataset.searchWired = '1';

  let pagefindReady = false;
  let pagefindLoading: Promise<void> | undefined;
  let fallbackInput: HTMLInputElement | undefined;
  let fallbackLoading: Promise<void> | undefined;
  let previouslyFocused: HTMLElement | null = null;

  const loadFallback = (): Promise<void> => {
    if (fallbackInput) return Promise.resolve();
    if (fallbackLoading) return fallbackLoading;

    fallbackLoading = (async () => {
      const response = await fetch(dialog.dataset.searchIndexUrl ?? '/search-index.json');
      if (!response.ok) throw new Error(`Search index request failed: ${response.status}`);
      const payload = await response.json() as { items?: SearchIndexItem[] };
      if (!Array.isArray(payload.items)) throw new Error('Search index response is invalid');
      const lang = dialog.dataset.searchLang ?? document.documentElement.lang;
      fallbackInput = createFallback(host, dialog, payload.items.filter((item) => item.lang === lang));
    })().catch((error) => {
      fallbackLoading = undefined;
      throw error;
    });
    return fallbackLoading;
  };

  const loadPagefind = (): Promise<void> => {
    if (pagefindReady) return Promise.resolve();
    if (pagefindLoading) return pagefindLoading;

    pagefindLoading = (async () => {
      const bundlePath = dialog.dataset.pagefindBase ?? '/pagefind/';
      if (!document.querySelector('link[data-pagefind-css]')) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = `${bundlePath}pagefind-ui.css`;
        link.dataset.pagefindCss = '';
        document.head.appendChild(link);
      }
      await loadScript(`${bundlePath}pagefind-ui.js`);
      if (!window.PagefindUI) throw new Error('PagefindUI is unavailable');

      new window.PagefindUI({
        element: '#pagefind-search',
        bundlePath,
        showSubResults: true,
        showImages: false,
        showFilters: true,
        translations: { placeholder: host.dataset.placeholder ?? 'Search...' },
      });
      pagefindReady = true;
    })().catch((error) => {
      pagefindLoading = undefined;
      throw error;
    });
    return pagefindLoading;
  };

  const prepareSearch = async () => {
    if (fallbackInput || fallbackLoading || dialog.hasAttribute('data-search-dev')) {
      await loadFallback();
      return;
    }
    try {
      await loadPagefind();
    } catch {
      await loadFallback();
    }
  };

  const focusInput = () => {
    if (!dialog.open) return;
    const input = fallbackInput
      ?? dialog.querySelector<HTMLInputElement>('input.pagefind-ui__search-input');
    input?.focus();
  };

  const open = () => {
    if (dialog.open) {
      focusInput();
      return;
    }
    if (hasOpenModal()) return;
    previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    dialog.showModal();

    const error = dialog.querySelector<HTMLElement>('[data-search-error]');
    error?.setAttribute('hidden', '');
    void prepareSearch()
      .then(focusInput)
      .catch(() => error?.removeAttribute('hidden'));
  };

  trigger.addEventListener('click', open);
  dialog.querySelector<HTMLElement>('[data-search-close]')?.addEventListener('click', () => {
    dialog.close();
  });
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
  dialog.addEventListener('close', () => {
    if (previouslyFocused && document.contains(previouslyFocused)) previouslyFocused.focus();
    previouslyFocused = null;
  });
  document.addEventListener('keydown', (event) => {
    if ((event.key === 'k' || event.key === 'K') && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      open();
      return;
    }
    if (event.key === 'Escape' && dialog.open) {
      event.preventDefault();
      dialog.close();
    }
  });
}
