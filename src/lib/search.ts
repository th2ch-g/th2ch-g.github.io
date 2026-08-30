export interface SearchIndexItem {
  slug: string;
  title: string;
  description: string;
  tags: string[];
  date: string;
  body: string;
}

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

const normalize = (value: string) => value.normalize('NFKC').toLocaleLowerCase();

function itemScore(item: SearchIndexItem, terms: string[]): number {
  const title = normalize(item.title);
  const description = normalize(item.description);
  const tags = normalize(item.tags.join(' '));
  const body = normalize(item.body);
  const searchable = `${title} ${description} ${tags} ${body}`;

  if (!terms.every((term) => searchable.includes(term))) return -1;

  return terms.reduce((score, term) => {
    if (title === term) return score + 12;
    if (title.startsWith(term)) return score + 8;
    if (title.includes(term)) return score + 6;
    if (tags.includes(term)) return score + 4;
    if (description.includes(term)) return score + 2;
    return score + 1;
  }, 0);
}

function resultUrl(postsBase: string, slug: string): string {
  const base = postsBase.endsWith('/') ? postsBase.slice(0, -1) : postsBase;
  const encodedSlug = slug.split('/').map(encodeURIComponent).join('/');
  return `${base}/${encodedSlug}`;
}

function createFallback(
  host: HTMLElement,
  dialog: HTMLDialogElement,
  items: SearchIndexItem[],
): HTMLInputElement {
  const form = document.createElement('form');
  form.className = 'search-fallback';
  form.setAttribute('role', 'search');

  const label = document.createElement('label');
  label.className = 'sr-only';
  label.htmlFor = 'search-fallback-input';
  label.textContent = dialog.getAttribute('aria-label') ?? 'Search';

  const input = document.createElement('input');
  input.id = 'search-fallback-input';
  input.className = 'search-fallback__input';
  input.type = 'search';
  input.autocomplete = 'off';
  input.placeholder = host.dataset.placeholder ?? 'Search...';

  const status = document.createElement('p');
  status.className = 'search-fallback__status';
  status.setAttribute('aria-live', 'polite');

  const results = document.createElement('ol');
  results.className = 'search-fallback__results';

  const render = () => {
    const terms = normalize(input.value).split(/\s+/).filter(Boolean);
    results.replaceChildren();
    if (terms.length === 0) {
      status.textContent = '';
      return;
    }

    const matches = items
      .map((item) => ({ item, score: itemScore(item, terms) }))
      .filter(({ score }) => score >= 0)
      .sort((a, b) => b.score - a.score || b.item.date.localeCompare(a.item.date));

    if (matches.length === 0) {
      status.textContent = dialog.dataset.noResults ?? 'No results.';
      return;
    }

    const resultLabel = dialog.dataset.resultsLabel ?? '{n} results';
    status.textContent = resultLabel.replace('{n}', String(matches.length));
    const postsBase = dialog.dataset.postsBase ?? '/posts';

    for (const { item } of matches.slice(0, 20)) {
      const listItem = document.createElement('li');
      listItem.className = 'search-fallback__result';

      const link = document.createElement('a');
      link.className = 'search-fallback__link';
      link.href = resultUrl(postsBase, item.slug);
      link.textContent = item.title;
      listItem.appendChild(link);

      if (item.description) {
        const description = document.createElement('p');
        description.className = 'search-fallback__description';
        description.textContent = item.description;
        listItem.appendChild(description);
      }

      const metaParts = [item.date, ...item.tags.map((tag) => `#${tag}`)];
      if (metaParts.length > 0) {
        const meta = document.createElement('p');
        meta.className = 'search-fallback__meta';
        meta.textContent = metaParts.join(' · ');
        listItem.appendChild(meta);
      }

      results.appendChild(listItem);
    }
  };

  form.addEventListener('submit', (event) => event.preventDefault());
  input.addEventListener('input', render);
  form.append(label, input, status, results);
  host.replaceChildren(form);
  return input;
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
      fallbackInput = createFallback(host, dialog, payload.items);
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
    if (dialog.hasAttribute('data-search-dev')) {
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
    const input = fallbackInput
      ?? dialog.querySelector<HTMLInputElement>('input.pagefind-ui__search-input');
    input?.focus();
  };

  const open = () => {
    previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    if (!dialog.open) dialog.showModal();

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
