import { wireChipCollapse } from './chip-collapse';

// Facet matcher mode.
//   'json-array' — card[data-${cardAttr}] holds a JSON-encoded string[];
//                  matches when the chip value is in the array.
//                  (Multi-word tags round-trip safely through dataset
//                  serialization without being split on whitespace.)
//   'string'     — card[data-${cardAttr}] holds the single value;
//                  matches on equality.
export type FacetMatch = 'json-array' | 'string';

export interface FacetConfig {
  // Logical name. Used as the URL query parameter and as the value of the
  // chip's `data-facet` attribute. Examples: 'tag', 'location', 'camera'.
  key: string;
  // Card attribute name to read from `card.dataset[cardAttr]`. Defaults to
  // `${key}s` for json-array facets and `${key}` for string facets.
  cardAttr?: string;
  match: FacetMatch;
}

export interface SortConfig {
  // The default direction the server-rendered HTML is in. The asc/desc flip
  // is achieved purely via CSS `flex-direction: column-reverse` (no DOM
  // reorder), so the list element's `data-sort` attribute is the toggle.
  defaultDir: 'asc' | 'desc';
  labelAsc: string;
  labelDesc: string;
}

export interface ListFilterConfig {
  rootSelector: string;
  listSelector: string;
  // CSS selector for individual cards inside `list`. Defaults to
  // direct children with `[data-tags]`, matching the existing markup.
  cardSelector?: string;
  emptyMsgSelector?: string;
  facets: FacetConfig[];
  sort?: SortConfig;
  // When true, every `[data-collapsible]` chip group inside the page will
  // be wrapped with the "+N / less" toggle.
  collapsible?: boolean;
  // Default labels for the chip-collapse toggle (read from data-* attrs
  // on the chip group when present, falling back to these).
  collapseDefaults?: { moreTemplate: string; lessLabel: string };
}

function defaultCardAttr(facet: FacetConfig): string {
  return facet.cardAttr ?? (facet.match === 'json-array' ? `${facet.key}s` : facet.key);
}

function readFacetValueFromCard(card: HTMLElement, facet: FacetConfig): string[] {
  const raw = card.dataset[defaultCardAttr(facet)] ?? '';
  if (facet.match === 'json-array') {
    try {
      const parsed = JSON.parse(raw || '[]');
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }
  return raw ? [raw] : [];
}

// Wire a list page's filter chips, optional sort toggle, URL state, and
// chip-collapse all at once. State persists in the URL query (?tag=...,
// ?location=..., ?camera=..., ?sort=asc) so reloads and shares survive.
export function setupListFilter(config: ListFilterConfig): void {
  const root = document.querySelector<HTMLElement>(config.rootSelector);
  const list = document.querySelector<HTMLElement>(config.listSelector);
  if (!root || !list) return;

  const cardSelector = config.cardSelector ?? '[data-tags]';
  const cards = list.querySelectorAll<HTMLElement>(cardSelector);
  const emptyMsg = config.emptyMsgSelector
    ? document.querySelector<HTMLElement>(config.emptyMsgSelector)
    : null;

  // Group chips by facet key for O(1) active-class updates.
  const chipsByFacet = new Map<string, HTMLButtonElement[]>();
  config.facets.forEach((f) => {
    const list = Array.from(
      root.querySelectorAll<HTMLButtonElement>(`[data-facet="${f.key}"]`),
    );
    chipsByFacet.set(f.key, list);
  });

  const state: Record<string, string> = {};
  const url = new URL(location.href);
  config.facets.forEach((f) => {
    state[f.key] = url.searchParams.get(f.key) ?? '';
  });

  // Drop stale state values so the URL doesn't lock onto a deleted facet.
  config.facets.forEach((f) => {
    const known = (chipsByFacet.get(f.key) ?? []).map((c) => c.dataset.value ?? '');
    if (state[f.key] && !known.includes(state[f.key])) state[f.key] = '';
  });

  function applyFilters() {
    let visible = 0;
    cards.forEach((card) => {
      const match = config.facets.every((f) => {
        const want = state[f.key];
        if (!want) return true;
        const have = readFacetValueFromCard(card, f);
        return have.includes(want);
      });
      card.style.display = match ? '' : 'none';
      if (match) visible += 1;
    });
    if (emptyMsg) emptyMsg.hidden = visible !== 0;
    chipsByFacet.forEach((chips, key) => {
      const active = state[key];
      chips.forEach((chip) => {
        chip.classList.toggle('is-active', (chip.dataset.value ?? '') === active);
      });
    });
  }

  function syncUrl() {
    const u = new URL(location.href);
    config.facets.forEach((f) => {
      if (state[f.key]) u.searchParams.set(f.key, state[f.key]);
      else u.searchParams.delete(f.key);
    });
    if (config.sort) {
      const cur = list!.dataset.sort as 'asc' | 'desc' | undefined;
      if (cur && cur !== config.sort.defaultDir) u.searchParams.set('sort', cur);
      else u.searchParams.delete('sort');
    }
    history.replaceState(null, '', `${u.pathname}${u.search}`);
  }

  // Sort wiring (optional).
  if (config.sort) {
    const sortBtn = root.querySelector<HTMLButtonElement>('[data-sort-toggle]');
    const initialDir =
      url.searchParams.get('sort') === (config.sort.defaultDir === 'desc' ? 'asc' : 'desc')
        ? (config.sort.defaultDir === 'desc' ? 'asc' : 'desc')
        : config.sort.defaultDir;

    function applySort(dir: 'asc' | 'desc') {
      list!.dataset.sort = dir;
      if (!sortBtn || !config.sort) return;
      const label = dir === 'desc' ? config.sort.labelDesc : config.sort.labelAsc;
      sortBtn.setAttribute('aria-label', label);
      const labelSpan = sortBtn.querySelector('.sort-label');
      const arrowSpan = sortBtn.querySelector('.sort-arrow');
      if (labelSpan) labelSpan.textContent = label;
      if (arrowSpan) arrowSpan.textContent = dir === 'desc' ? '↓' : '↑';
    }

    applySort(initialDir);
    sortBtn?.addEventListener('click', () => {
      const cur = list.dataset.sort as 'asc' | 'desc' | undefined;
      const next: 'asc' | 'desc' = cur === 'desc' ? 'asc' : 'desc';
      applySort(next);
      syncUrl();
    });
  }

  applyFilters();

  chipsByFacet.forEach((chips, key) => {
    chips.forEach((chip) => {
      chip.addEventListener('click', () => {
        state[key] = chip.dataset.value ?? '';
        applyFilters();
        syncUrl();
      });
    });
  });

  if (config.collapsible) {
    const fallback = config.collapseDefaults ?? { moreTemplate: '+ {n}', lessLabel: '− less' };
    document.querySelectorAll<HTMLElement>('[data-collapsible]').forEach((group) => {
      wireChipCollapse(group, {
        moreTemplate: group.dataset.moreLabel || fallback.moreTemplate,
        lessLabel: group.dataset.lessLabel || fallback.lessLabel,
      });
    });
  }
}
