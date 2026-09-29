import type { Lang } from '@/i18n/ui';

export interface SearchIndexItem {
  url: string;
  lang: Lang;
  title: string;
  description: string;
  date?: string;
  body: string;
}

const normalize = (value: string) => value.normalize('NFKC').toLocaleLowerCase();

interface SearchDocument {
  item: Omit<SearchIndexItem, 'body'>;
  title: string;
  description: string;
  searchable: string;
}

function itemScore({ title, description, searchable }: SearchDocument, terms: string[]): number {
  if (!terms.every((term) => searchable.includes(term))) return -1;

  return terms.reduce((score, term) => {
    if (title === term) return score + 12;
    if (title.startsWith(term)) return score + 8;
    if (title.includes(term)) return score + 6;
    if (description.includes(term)) return score + 2;
    return score + 1;
  }, 0);
}

export function createFallback(
  host: HTMLElement,
  dialog: HTMLDialogElement,
  items: SearchIndexItem[],
): HTMLInputElement {
  const documents: SearchDocument[] = items.map(({ body, ...item }) => {
    const title = normalize(item.title);
    const description = normalize(item.description);
    return { item, title, description, searchable: `${title} ${description} ${normalize(body)}` };
  });
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

    const matches = documents
      .map((document) => ({ item: document.item, score: itemScore(document, terms) }))
      .filter(({ score }) => score >= 0)
      .sort((a, b) => b.score - a.score || (b.item.date ?? '').localeCompare(a.item.date ?? ''));

    if (matches.length === 0) {
      status.textContent = dialog.dataset.noResults ?? 'No results.';
      return;
    }

    const resultLabel = dialog.dataset.resultsLabel ?? '{n} results';
    status.textContent = resultLabel.replace('{n}', String(matches.length));
    const fragment = document.createDocumentFragment();
    for (const { item } of matches.slice(0, 20)) {
      const listItem = document.createElement('li');
      listItem.className = 'search-fallback__result';

      const link = document.createElement('a');
      link.className = 'search-fallback__link';
      link.href = item.url;
      link.textContent = item.title;
      listItem.appendChild(link);

      if (item.description) {
        const description = document.createElement('p');
        description.className = 'search-fallback__description';
        description.textContent = item.description;
        listItem.appendChild(description);
      }

      if (item.date) {
        const meta = document.createElement('p');
        meta.className = 'search-fallback__meta';
        meta.textContent = item.date;
        listItem.appendChild(meta);
      }

      fragment.appendChild(listItem);
    }
    results.appendChild(fragment);
  };

  form.addEventListener('submit', (event) => event.preventDefault());
  input.addEventListener('input', render);
  form.append(label, input, status, results);
  host.replaceChildren(form);
  return input;
}
